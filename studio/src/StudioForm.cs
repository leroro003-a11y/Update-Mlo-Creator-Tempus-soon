// MLO Studio: the main window. MLO Creator is the first tab; CodeWalker and any other program are added next to it.
// A program's window is taken out of its own frame and put inside a panel of ours (SetParent); "Pop out" gives it back.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace MloStudio
{
    class StudioForm : Form
    {
        readonly StudioSettings settings;
        readonly Bridge bridge;
        readonly List<AppTab> tabs = new List<AppTab>();
        readonly string[] startArgs;
        readonly string mloExe;
        AppTab active, lastOther;
        bool split, closing, reallyClose;
        List<AppTab> toClose = new List<AppTab>();
        DateTime closeDeadline, lastFollowScan = DateTime.MinValue;
        // "Share your project": asked here, opened by MLO Creator's editor (it asks for it on the bridge, path "inbox")
        bool shareQueued;
        DateTime shareAskedAt = DateTime.MinValue;
        // "Modification live": the small window that follows CodeWalker's selection, and the building it asked MLO Creator to open (path "inbox")
        LiveForm live;
        Dictionary<string, object> liveQueued;

        Panel top;
        FlowLayoutPanel chips, tools;
        Label brand, status;
        SplitContainer body;
        InfoCard empty;
        Button bAdd, bMap, bSplit, bLive;
        readonly Timer watch = new Timer(), closeTimer = new Timer();
        readonly Font brandFont = Theme.UI(11f, FontStyle.Bold);

        static int S(int v) { return Theme.S(v); }
        static string T(string fr, string en) { return L.T(fr, en); }

        public StudioForm(string[] args)
        {
            startArgs = args ?? new string[0];
            settings = StudioSettings.Load();
            L.Code = settings.Lang;
            try { using (var g = Graphics.FromHwnd(IntPtr.Zero)) Theme.Scale = g.DpiX / 96f; } catch { }
            mloExe = Path.Combine(Program.AppDir, "MloCreator.exe");

            Text = "MLO Studio";
            BackColor = Theme.Bg;
            ForeColor = Theme.Text;
            Font = Theme.UI(9f);
            MinimumSize = new Size(S(900), S(560));
            Size = new Size(S(1500), S(920));
            StartPosition = FormStartPosition.CenterScreen;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            BuildUi();
            LoadBounds();

            watch.Interval = 400;
            watch.Tick += (s, e) => Watch();
            closeTimer.Interval = 200;
            closeTimer.Tick += (s, e) => CloseTick();
            bridge = new Bridge(HandleApiThreaded);
        }

        // ---------- the window ----------

        void BuildUi()
        {
            top = new Panel();
            top.Dock = DockStyle.Top;
            top.Height = S(46);
            top.BackColor = Theme.Bar;
            top.Padding = new Padding(S(10), 0, S(10), 0);
            top.Paint += (s, e) => { using (var p = new Pen(Theme.Line)) e.Graphics.DrawLine(p, 0, top.Height - 1, top.Width, top.Height - 1); };

            brand = new Label();
            brand.Dock = DockStyle.Left;
            brand.Width = S(150);
            brand.BackColor = Theme.Bar;
            brand.Paint += PaintBrand;

            tools = new FlowLayoutPanel();
            tools.Dock = DockStyle.Right;
            tools.AutoSize = true;
            tools.AutoSizeMode = AutoSizeMode.GrowAndShrink;
            tools.WrapContents = false;
            tools.BackColor = Theme.Bar;
            bLive = Theme.Btn("", false, (s, e) => ShowLive());
            bLive.FlatAppearance.BorderColor = Theme.Cyan;
            bMap = Theme.Btn("", false, (s, e) => OpenCodeWalker("world"));
            bSplit = Theme.Btn("", false, (s, e) => SetSplit(!split));
            bAdd = Theme.Btn("", true, (s, e) => ShowAddDialog());
            tools.Controls.Add(bLive);
            tools.Controls.Add(bMap);
            tools.Controls.Add(bSplit);
            tools.Controls.Add(bAdd);

            chips = new FlowLayoutPanel();
            chips.Dock = DockStyle.Fill;
            chips.WrapContents = false;
            chips.AutoScroll = false;
            chips.BackColor = Theme.Bar;
            chips.Padding = new Padding(S(6), 0, 0, 0);

            top.Controls.Add(chips);
            top.Controls.Add(tools);
            top.Controls.Add(brand);
            chips.BringToFront();

            status = new Label();
            status.Dock = DockStyle.Bottom;
            status.Height = S(24);
            status.BackColor = Theme.Bar;
            status.ForeColor = Theme.Muted;
            status.Font = Theme.UI(8.5f);
            status.TextAlign = ContentAlignment.MiddleLeft;
            status.Padding = new Padding(S(12), 0, 0, 0);

            body = new SplitContainer();
            body.Dock = DockStyle.Fill;
            body.BackColor = Theme.Line;
            body.SplitterWidth = Math.Max(4, S(6));
            body.Panel1.BackColor = Theme.Bg;
            body.Panel2.BackColor = Theme.Bg;
            body.Panel2Collapsed = true;
            body.SplitterMoved += (s, e) =>
            {
                if (!body.Panel2Collapsed && body.Width > 0) settings.SplitPercent = Math.Max(15, Math.Min(85, body.SplitterDistance * 100 / body.Width));
            };

            empty = new InfoCard();
            body.Panel1.Controls.Add(empty);

            Controls.Add(body);
            Controls.Add(status);
            Controls.Add(top);
            body.BringToFront();
            ApplyTexts();
        }

        void PaintBrand(object sender, PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            int sz = S(24);
            var r = new Rectangle(S(2), (brand.Height - sz) / 2, sz, sz);
            using (var p = Theme.Round(r, S(7)))
            using (var b = new LinearGradientBrush(r, Theme.Accent, Theme.Cyan, 45f))
                g.FillPath(b, p);
            TextRenderer.DrawText(g, "M", brandFont, r, Color.White, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            int x = r.Right + S(9);
            var w1 = TextRenderer.MeasureText(g, "MLO", brandFont, Size.Empty, TextFormatFlags.NoPadding).Width;
            var tr = new Rectangle(x, 0, brand.Width - x, brand.Height);
            TextRenderer.DrawText(g, "MLO", brandFont, tr, Theme.Text, TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "Studio", brandFont, new Rectangle(x + w1 + S(4), 0, brand.Width - x - w1, brand.Height), Theme.Accent,
                TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.NoPadding);
        }

        void ApplyTexts()
        {
            bAdd.Text = T("+  Ajouter une application", "+  Add an application");
            bMap.Text = T("Carte CodeWalker", "CodeWalker map");
            bLive.Text = T("Modification live", "Live edit");
            bSplit.Text = split ? T("Côte à côte : oui", "Side by side: on") : T("Côte à côte", "Side by side");
            bSplit.FlatAppearance.BorderColor = split ? Theme.Accent : Theme.Line;
            if (tabs.Count == 0)
                empty.Set(T("Rien à afficher pour l'instant", "Nothing to show yet"),
                    File.Exists(mloExe) ? T("MLO Creator n'est pas ouvert ici.", "MLO Creator is not open here.")
                        : T("MloCreator.exe n'est pas à côté de MloStudio.exe. Mets MloStudio.exe dans le dossier de MLO Creator.", "MloCreator.exe is not next to MloStudio.exe. Put MloStudio.exe in MLO Creator's folder."),
                    File.Exists(mloExe) ? Theme.Btn(T("Ouvrir MLO Creator", "Open MLO Creator"), true, (s, e) => StartMlo()) : null,
                    Theme.Btn(T("Carte CodeWalker", "CodeWalker map"), false, (s, e) => OpenCodeWalker("world")),
                    Theme.Btn(T("Modification live", "Live edit"), false, (s, e) => ShowLive()),
                    Theme.Btn(T("+ Ajouter une application", "+ Add an application"), false, (s, e) => ShowAddDialog()));
            UpdateStatus();
        }

        void LoadBounds()
        {
            var b = settings.Bounds;
            if (b == null || b.Length != 4 || b[2] < 400 || b[3] < 300) return;
            var rect = new Rectangle(b[0], b[1], b[2], b[3]);
            if (!Screen.AllScreens.Any(sc => sc.WorkingArea.IntersectsWith(rect))) return;
            StartPosition = FormStartPosition.Manual;
            Bounds = rect;
            if (settings.Maximized) WindowState = FormWindowState.Maximized;
        }

        void SaveBounds()
        {
            settings.Maximized = WindowState == FormWindowState.Maximized;
            var r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            settings.Bounds = new[] { r.X, r.Y, r.Width, r.Height };
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            if (bridge.Start()) WriteConfig(true);
            else Log.Info("bridge: no free port");

            bool embedMlo = settings.EmbedMlo != false && !startArgs.Contains("--no-mlo");
            if (embedMlo && File.Exists(mloExe)) StartMlo();
            foreach (var en in settings.Apps.Where(a => a.Kind != "mlo").ToList())
            {
                var t = CreateTab(en);
                if (en.Open) Launch(t); else ShowStopped(t);
            }
            if (startArgs.Contains("--codewalker")) OpenCodeWalker("world");
            split = settings.Split;
            var act = tabs.FirstOrDefault(x => x.Entry.Id == settings.ActiveId) ?? tabs.FirstOrDefault();
            if (act != null) Activate(act); else DoLayout();
            ApplyTexts();
            watch.Start();
        }

        void StartMlo()
        {
            var t = tabs.FirstOrDefault(x => x.IsMlo);
            if (t == null)
            {
                var en = settings.Apps.FirstOrDefault(a => a.Kind == "mlo");
                if (en == null)
                {
                    en = new AppEntry { Id = "mlo", Kind = "mlo", Name = "MLO Creator", Args = settings.MloArgs ?? "" };
                    settings.Apps.Insert(0, en);
                }
                en.Path = mloExe;
                t = CreateTab(en);
                chips.Controls.SetChildIndex(t.Chip, 0);
            }
            // an MLO Creator that is already open is taken in, rather than a second one
            foreach (var p in Process.GetProcessesByName("MloCreator"))
            {
                try
                {
                    p.Refresh();
                    if (p.MainWindowHandle != IntPtr.Zero && Win.IsWindowVisible(p.MainWindowHandle))
                    {
                        Track(t, p);
                        t.LaunchedAt = t.SearchSince = DateTime.Now;
                        t.ExeDir = Program.AppDir;
                        if (Embed(t, p.MainWindowHandle)) { Activate(t); return; }
                    }
                }
                catch (Exception ex) { Log.Error(ex); }
            }
            if (!t.Alive) Launch(t);
            Activate(t);
        }

        // ---------- tabs ----------

        AppTab CreateTab(AppEntry en)
        {
            var t = new AppTab();
            t.Entry = en;
            t.Host = new Panel();
            t.Host.Dock = DockStyle.Fill;
            t.Host.BackColor = Theme.Bg;
            t.Host.Visible = false;
            t.Info = new InfoCard();
            t.Host.Controls.Add(t.Info);
            t.Host.Resize += (s, e) => Fit(t);
            // if WinForms ever destroys the panel, give the program its window back instead of letting it go down with ours
            t.Host.HandleDestroyed += (s, e) =>
            {
                IntPtr h = t.Hwnd;
                if (h == IntPtr.Zero || !Win.IsWindow(h)) return;
                try
                {
                    Win.SetParent(h, IntPtr.Zero);
                    Win.SetLong(h, Win.GWL_STYLE, t.OrigStyle);
                    Win.SetLong(h, Win.GWL_EXSTYLE, t.OrigExStyle);
                    Win.ShowWindow(h, Win.SW_SHOW);
                }
                catch { }
            };
            t.Chip = new TabChip(t);
            t.Chip.MouseUp += (s, e) =>
            {
                if (e.Button == MouseButtons.Left) Activate(t);
                else if (e.Button == MouseButtons.Right) ShowTabMenu(t, e.Location);
            };
            chips.Controls.Add(t.Chip);
            body.Panel1.Controls.Add(t.Host);
            var created = t.Host.Handle;   // the panel's window must exist before a program's window goes into it
            tabs.Add(t);
            if (!settings.Apps.Contains(en)) settings.Apps.Add(en);
            empty.Visible = false;
            return t;
        }

        void Activate(AppTab t)
        {
            if (t == null) return;
            active = t;
            if (!t.IsMlo) lastOther = t;
            settings.ActiveId = t.Entry.Id;
            DoLayout();
            FocusApp(t);
            Text = "MLO Studio · " + t.Entry.Name;
            UpdateStatus();
        }

        void DoLayout()
        {
            AppTab left = null, right = null;
            var mlo = tabs.FirstOrDefault(x => x.IsMlo);
            if (split && mlo != null)
            {
                var other = (active != null && active != mlo) ? active
                    : (lastOther != null && tabs.Contains(lastOther) ? lastOther : tabs.FirstOrDefault(x => !x.IsMlo));
                if (other != null) { left = mlo; right = other; }
            }
            body.SuspendLayout();
            if (right != null)
            {
                Place(left, body.Panel1);
                Place(right, body.Panel2);
                body.Panel2Collapsed = false;
                foreach (var t in tabs) t.Host.Visible = t == left || t == right;
                ApplySplitDistance();
            }
            else
            {
                foreach (var t in tabs) if (t.Host.Visible && t != active) t.Host.Visible = false;
                if (active != null) { Place(active, body.Panel1); active.Host.Visible = true; }
                body.Panel2Collapsed = true;
            }
            body.ResumeLayout();
            empty.Visible = tabs.Count == 0;
            if (empty.Visible) { empty.BringToFront(); ApplyTexts(); }
            foreach (var t in tabs)
            {
                t.Chip.Active = t == active;
                t.Chip.Shown = t != active && t.Host.Visible;
                t.Chip.Invalidate();
                if (t.Host.Visible) Fit(t);
            }
        }

        static void Place(AppTab t, Control parent)
        {
            if (t != null && t.Host.Parent != parent) parent.Controls.Add(t.Host);
        }

        void ApplySplitDistance()
        {
            int w = body.Width;
            if (w <= 0) return;
            int d = w * settings.SplitPercent / 100;
            d = Math.Max(body.Panel1MinSize, Math.Min(w - body.Panel2MinSize - body.SplitterWidth, d));
            try { body.SplitterDistance = d; } catch { }
        }

        void SetSplit(bool on)
        {
            split = on;
            settings.Split = on;
            if (on && !tabs.Any(x => !x.IsMlo))
                SetStatusHint(T("Côte à côte : ouvre d'abord CodeWalker ou une autre application.", "Side by side: open CodeWalker or another program first."));
            DoLayout();
            ApplyTexts();
            settings.Save();
        }

        void Fit(AppTab t)
        {
            if (t.State != TabState.Embedded || t.Hwnd == IntPtr.Zero || !Win.IsWindow(t.Hwnd)) return;
            var cs = t.Host.ClientSize;
            Win.SetWindowPos(t.Hwnd, IntPtr.Zero, 0, 0, Math.Max(1, cs.Width), Math.Max(1, cs.Height),
                Win.SWP_NOZORDER | Win.SWP_NOACTIVATE | Win.SWP_ASYNCWINDOWPOS);
        }

        void FocusApp(AppTab t)
        {
            if (t.State != TabState.Embedded) return;
            IntPtr h = t.Hwnd;
            BeginInvoke(new Action(() => { try { Win.FocusCross(h); } catch { } }));
        }

        void SetState(AppTab t, TabState s)
        {
            t.State = s;
            t.Chip.Invalidate();
            UpdateStatus();
        }

        string StateText(TabState s)
        {
            switch (s)
            {
                case TabState.Embedded: return T("affichée ici", "shown here");
                case TabState.Searching: return T("ouverture…", "opening…");
                case TabState.Detached: return T("dans sa propre fenêtre", "in its own window");
                case TabState.Exited: return T("fermée", "closed");
                default: return T("pas lancée", "not started");
            }
        }

        static string StateKey(TabState s)
        {
            switch (s)
            {
                case TabState.Embedded: return "embedded";
                case TabState.Searching: return "searching";
                case TabState.Detached: return "detached";
                case TabState.Exited: return "closed";
                default: return "idle";
            }
        }

        string hint;
        DateTime hintUntil = DateTime.MinValue;
        void SetStatusHint(string h) { hint = h; hintUntil = DateTime.Now.AddSeconds(6); UpdateStatus(); }

        void UpdateStatus()
        {
            if (status == null || closing) return;
            if (hint != null && DateTime.Now < hintUntil) { status.Text = hint; return; }
            string a = active != null ? active.Entry.Name + " · " + StateText(active.State) + "      " : "";
            status.Text = a + T("Clic droit sur un onglet : détacher, renommer, fermer.", "Right-click a tab: pop out, rename, close.");
        }

        void ShowStopped(AppTab t)
        {
            var buttons = new List<Button>();
            buttons.Add(Theme.Btn(T("Lancer", "Start"), true, (s, e) => { Launch(t); Activate(t); }));
            if (!t.IsMlo) buttons.Add(Theme.Btn(T("Retirer de la liste", "Remove from the list"), false, (s, e) => Remove(t)));
            t.Info.Set(string.Format(T("{0} est fermé", "{0} is closed"), t.Entry.Name), t.Entry.Path, buttons.ToArray());
            t.Info.Visible = true;
            t.Info.BringToFront();
        }

        void ShowInfo(AppTab t, string title, string text, params Button[] buttons)
        {
            t.Info.Set(title, text, buttons);
            t.Info.Visible = true;
            t.Info.BringToFront();
        }

        // ---------- starting programs and taking their windows in ----------

        void Track(AppTab t, Process p)
        {
            t.Proc = p;
            try
            {
                p.EnableRaisingEvents = true;
                p.Exited += (s, e) =>
                {
                    try { if (IsHandleCreated && !IsDisposed) BeginInvoke(new Action(() => OnExited(t, p))); } catch { }
                };
            }
            catch (Exception ex) { Log.Error(ex); }
        }

        void Launch(AppTab t)
        {
            string path = t.Entry.Path;
            if (string.IsNullOrEmpty(path) || !File.Exists(path))
            {
                SetState(t, TabState.Exited);
                ShowInfo(t, T("Programme introuvable", "Program not found"), path ?? "",
                    Theme.Btn(T("Choisir le programme…", "Pick the program…"), true, (s, e) => RepickExe(t)));
                return;
            }
            if (t.Alive) { Activate(t); return; }
            try
            {
                var psi = new ProcessStartInfo(path, t.Entry.Args ?? "");
                psi.UseShellExecute = false;
                psi.WorkingDirectory = Path.GetDirectoryName(path);
                t.LaunchedAt = t.SearchSince = DateTime.Now;
                t.EmbeddedOnce = t.SlowHintShown = false;
                t.ExeDir = psi.WorkingDirectory;
                t.Hwnd = t.DetachedHwnd = IntPtr.Zero;
                var p = Process.Start(psi);
                Track(t, p);
                t.Entry.Open = true;
                SetState(t, TabState.Searching);
                ShowInfo(t, string.Format(T("Ouverture de {0}…", "Opening {0}…"), t.Entry.Name),
                    t.Entry.Kind == "codewalker"
                        ? T("CodeWalker charge les fichiers de GTA V, ça peut prendre un moment. Sa fenêtre s'affichera ici.", "CodeWalker is loading GTA V's files, this can take a moment. Its window will show here.")
                        : T("Sa fenêtre s'affichera ici dès qu'elle apparaît.", "Its window will show here as soon as it appears."));
                Log.Info("start " + path + (string.IsNullOrWhiteSpace(t.Entry.Args) ? "" : " [arguments supplied]"));
            }
            catch (Exception ex)
            {
                Log.Error(ex);
                SetState(t, TabState.Exited);
                ShowInfo(t, T("Lancement impossible", "Could not start it"), ex.Message,
                    Theme.Btn(T("Réessayer", "Try again"), true, (s, e) => Launch(t)));
            }
            settings.Save();
        }

        void OnExited(AppTab t, Process p)
        {
            if (t.Proc != p || closing) return;
            // a launcher that starts the real program and quits: keep looking for a little while (Watch -> Follow)
            if (t.State == TabState.Searching && !t.EmbeddedOnce && (DateTime.Now - t.LaunchedAt).TotalSeconds < 20) return;
            t.Hwnd = IntPtr.Zero;
            SetState(t, TabState.Exited);
            if (t.PendingRemove) { RemoveNow(t); return; }
            ShowStopped(t);
        }

        void Watch()
        {
            if (closing) return;
            foreach (var t in tabs.ToList())
            {
                if (t.State == TabState.Embedded)
                {
                    if (!Win.IsWindow(t.Hwnd))
                    {
                        t.Hwnd = IntPtr.Zero;
                        if (t.Alive)
                        {
                            // its window closed but the program runs on (a first-start dialog, a splash): wait for the next one
                            t.SearchSince = DateTime.Now;
                            SetState(t, TabState.Searching);
                            ShowInfo(t, string.Format(T("En attente de {0}…", "Waiting for {0}…"), t.Entry.Name), T("Sa prochaine fenêtre s'affichera ici.", "Its next window will show here."));
                        }
                        else { SetState(t, TabState.Exited); if (t.PendingRemove) RemoveNow(t); else ShowStopped(t); }
                    }
                    else if (Win.GetParent(t.Hwnd) != t.Host.Handle)
                    {
                        Embed(t, t.Hwnd);   // the window got out (the panel was rebuilt): put it back
                    }
                }
                else if (t.State == TabState.Searching)
                {
                    t.Chip.Pulse = !t.Chip.Pulse;
                    t.Chip.Invalidate();
                    IntPtr h = FindAppWindow(t);
                    if (h != IntPtr.Zero) { Embed(t, h); continue; }
                    if (!t.Alive)
                    {
                        if (!t.EmbeddedOnce && (DateTime.Now - t.LaunchedAt).TotalSeconds < 20)
                        {
                            if ((DateTime.Now - lastFollowScan).TotalMilliseconds > 1200) { lastFollowScan = DateTime.Now; Follow(t); }
                        }
                        else { SetState(t, TabState.Exited); if (t.PendingRemove) RemoveNow(t); else ShowStopped(t); }
                    }
                    else if (!t.SlowHintShown && (DateTime.Now - t.SearchSince).TotalSeconds > 45)
                    {
                        t.SlowHintShown = true;
                        ShowInfo(t, string.Format(T("{0} n'a pas encore de fenêtre", "{0} has no window yet"), t.Entry.Name),
                            T("Si elle est déjà ouverte à part, prends-la avec « Fenêtre déjà ouverte ».", "If it opened on its own, take it with \"A window already open\"."),
                            Theme.Btn(T("Fenêtre déjà ouverte…", "A window already open…"), true, (s, e) => ShowAddDialog()));
                    }
                }
                else if (t.State == TabState.Detached)
                {
                    if (!Win.IsWindow(t.DetachedHwnd) && !t.Alive) { SetState(t, TabState.Exited); ShowStopped(t); }
                }
            }
            if (shareQueued && (DateTime.Now - shareAskedAt).TotalSeconds > 90)
            {
                shareQueued = false;
                SetStatusHint(T("MLO Creator n'a pas ouvert le partage : clique sur « Partager un projet » dans son écran d'accueil.",
                    "MLO Creator did not open sharing: click \"Share a project\" on its start screen."));
            }
            if (hint != null && DateTime.Now >= hintUntil) { hint = null; UpdateStatus(); }
        }

        // the main window of the tab's program: visible, not owned (dialogs), big enough
        IntPtr FindAppWindow(AppTab t)
        {
            int pid = t.Pid;
            if (pid <= 0) return IntPtr.Zero;
            IntPtr main = IntPtr.Zero;
            try { t.Proc.Refresh(); main = t.Proc.MainWindowHandle; } catch { }
            int own = Process.GetCurrentProcess().Id;
            IntPtr best = IntPtr.Zero;
            long bestArea = 0;
            foreach (var w in Win.TopWindows())
            {
                if (w.Pid != pid || w.Pid == own || !w.Visible || w.Owned) continue;
                if (w.Class == "#32770" || (w.ExStyle & Win.WS_EX_TOOLWINDOW) != 0) continue;
                if (w.Rect.Width < 260 || w.Rect.Height < 160) continue;
                if (w.Handle == main) return main;
                long area = (long)w.Rect.Width * w.Rect.Height;
                if (area > bestArea) { bestArea = area; best = w.Handle; }
            }
            return best;
        }

        // the launched program quit at once: look for one started from the same folder just after it
        bool Follow(AppTab t)
        {
            if (string.IsNullOrEmpty(t.ExeDir)) return false;
            foreach (var p in Process.GetProcesses())
            {
                try
                {
                    if (p.StartTime < t.LaunchedAt.AddSeconds(-1)) continue;
                    string f = p.MainModule.FileName;
                    if (!string.Equals(Path.GetDirectoryName(f), t.ExeDir, StringComparison.OrdinalIgnoreCase)) continue;
                    if (tabs.Any(o => o != t && o.Pid == p.Id)) continue;
                    Track(t, p);
                    return true;
                }
                catch { }
            }
            return false;
        }

        bool Embed(AppTab t, IntPtr h)
        {
            try
            {
                if (Win.IsIconic(h) || Win.IsZoomed(h)) Win.ShowWindow(h, Win.SW_RESTORE);
                Win.RECT r;
                Win.GetWindowRect(h, out r);
                long style = Win.GetLong(h, Win.GWL_STYLE);
                if ((style & Win.WS_CHILD) == 0)   // a real top-level window: remember how it was
                {
                    t.OrigRect = r;
                    t.OrigStyle = style;
                    t.OrigExStyle = Win.GetLong(h, Win.GWL_EXSTYLE);
                }
                long st = (t.OrigStyle & ~(Win.WS_CAPTION | Win.WS_THICKFRAME | Win.WS_POPUP | Win.WS_SYSMENU | Win.WS_MINIMIZEBOX | Win.WS_MAXIMIZEBOX)) | Win.WS_CHILD | Win.WS_VISIBLE;
                long ex = t.OrigExStyle & ~(Win.WS_EX_APPWINDOW | Win.WS_EX_WINDOWEDGE | Win.WS_EX_CLIENTEDGE | Win.WS_EX_DLGMODALFRAME | Win.WS_EX_STATICEDGE);
                Win.SetLong(h, Win.GWL_STYLE, st);
                Win.SetLong(h, Win.GWL_EXSTYLE, ex);
                Win.SetParent(h, t.Host.Handle);
                if (Win.GetParent(h) != t.Host.Handle)
                {
                    // Windows refused (usually: the program runs as administrator and MLO Studio does not)
                    Win.SetLong(h, Win.GWL_STYLE, t.OrigStyle);
                    Win.SetLong(h, Win.GWL_EXSTYLE, t.OrigExStyle);
                    Win.SetWindowPos(h, IntPtr.Zero, 0, 0, 0, 0, Win.SWP_NOMOVE | Win.SWP_NOSIZE | Win.SWP_NOZORDER | Win.SWP_FRAMECHANGED);
                    t.DetachedHwnd = h;
                    SetState(t, TabState.Detached);
                    ShowInfo(t, string.Format(T("Impossible d'afficher {0} ici", "{0} cannot be shown here"), t.Entry.Name),
                        T("Windows refuse de déplacer sa fenêtre. S'il tourne en administrateur, lance MLO Studio en administrateur aussi.", "Windows will not move its window. If it runs as administrator, run MLO Studio as administrator too."),
                        Theme.Btn(T("Réessayer", "Try again"), true, (s, e) => Reattach(t)));
                    return false;
                }
                t.Hwnd = h;
                t.DetachedHwnd = IntPtr.Zero;
                t.EmbeddedOnce = true;
                t.Info.Visible = false;
                SetState(t, TabState.Embedded);
                var cs = t.Host.ClientSize;
                Win.SetWindowPos(h, IntPtr.Zero, 0, 0, Math.Max(1, cs.Width), Math.Max(1, cs.Height),
                    Win.SWP_NOZORDER | Win.SWP_FRAMECHANGED | Win.SWP_SHOWWINDOW | Win.SWP_NOACTIVATE);
                if (t == active) FocusApp(t);
                Log.Info("embedded " + t.Entry.Name);
                return true;
            }
            catch (Exception e) { Log.Error(e); return false; }
        }

        // give the program its own window back
        void Release(AppTab t)
        {
            IntPtr h = t.Hwnd;
            t.Hwnd = IntPtr.Zero;
            if (h == IntPtr.Zero || !Win.IsWindow(h)) return;
            Win.SetParent(h, IntPtr.Zero);
            Win.SetLong(h, Win.GWL_STYLE, t.OrigStyle);
            Win.SetLong(h, Win.GWL_EXSTYLE, t.OrigExStyle);
            var r = t.OrigRect;
            if (r.Width < 300 || r.Height < 200 || r.Left < -10000)
            {
                var b = Bounds;
                r.Left = b.Left + S(60); r.Top = b.Top + S(60); r.Right = r.Left + Math.Max(S(900), b.Width * 2 / 3); r.Bottom = r.Top + Math.Max(S(600), b.Height * 2 / 3);
            }
            Win.SetWindowPos(h, IntPtr.Zero, r.Left, r.Top, r.Width, r.Height, Win.SWP_NOZORDER | Win.SWP_FRAMECHANGED | Win.SWP_SHOWWINDOW);
            t.DetachedHwnd = h;
            if (closing) return;
            Win.SetForegroundWindow(h);
            SetState(t, TabState.Detached);
            ShowInfo(t, string.Format(T("{0} est dans sa propre fenêtre", "{0} is in its own window"), t.Entry.Name), null,
                Theme.Btn(T("Remettre ici", "Put it back here"), true, (s, e) => Reattach(t)));
        }

        void Reattach(AppTab t)
        {
            if (t.DetachedHwnd != IntPtr.Zero && Win.IsWindow(t.DetachedHwnd)) Embed(t, t.DetachedHwnd);
            else if (t.Alive) { t.SearchSince = DateTime.Now; SetState(t, TabState.Searching); }
            else Launch(t);
            Activate(t);
        }

        void CloseApp(AppTab t)
        {
            t.Entry.Open = false;
            IntPtr h = t.Hwnd != IntPtr.Zero ? t.Hwnd : t.DetachedHwnd;
            if (h != IntPtr.Zero && Win.IsWindow(h)) Win.PostMessage(h, Win.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
            else { try { if (t.Proc != null) t.Proc.CloseMainWindow(); } catch { } }
        }

        void Remove(AppTab t)
        {
            if (t.IsMlo) return;
            if (t.Alive) { t.PendingRemove = true; CloseApp(t); return; }
            RemoveNow(t);
        }

        void RemoveNow(AppTab t)
        {
            if (t.Hwnd != IntPtr.Zero && Win.IsWindow(t.Hwnd)) Release(t);
            tabs.Remove(t);
            settings.Apps.Remove(t.Entry);
            chips.Controls.Remove(t.Chip);
            t.Chip.Dispose();
            if (t.Host.Parent != null) t.Host.Parent.Controls.Remove(t.Host);
            t.Host.Dispose();
            if (lastOther == t) lastOther = null;
            if (active == t) active = null;
            settings.Save();
            if (active == null && tabs.Count > 0) Activate(tabs[0]); else DoLayout();
        }

        void RepickExe(AppTab t)
        {
            using (var d = new OpenFileDialog())
            {
                d.Title = T("Choisir le programme", "Pick the program");
                d.Filter = T("Programmes (*.exe)|*.exe", "Programs (*.exe)|*.exe");
                if (!string.IsNullOrEmpty(t.Entry.Path)) d.FileName = Path.GetFileName(t.Entry.Path);
                if (d.ShowDialog(this) != DialogResult.OK) return;
                t.Entry.Path = d.FileName;
                if (t.Entry.Kind == "codewalker") settings.CodeWalkerPath = d.FileName;
                Launch(t);
            }
        }

        // ---------- the tab menu ----------

        void ShowTabMenu(AppTab t, Point at)
        {
            var m = new ContextMenuStrip();
            m.Items.Add(T("Afficher", "Show"), null, (s, e) => Activate(t));
            if (!t.IsMlo)
            {
                bool inSplit = split && (active == t || lastOther == t);
                m.Items.Add(inSplit ? T("Arrêter le côte à côte", "Stop side by side") : T("Côte à côte avec MLO Creator", "Side by side with MLO Creator"), null, (s, e) =>
                {
                    if (inSplit) SetSplit(false);
                    else { lastOther = t; Activate(t); SetSplit(true); }
                });
            }
            m.Items.Add(new ToolStripSeparator());
            if (t.State == TabState.Embedded) m.Items.Add(T("Détacher dans sa propre fenêtre", "Pop out to its own window"), null, (s, e) => Release(t));
            if (t.State == TabState.Detached) m.Items.Add(T("Remettre dans MLO Studio", "Put back into MLO Studio"), null, (s, e) => Reattach(t));
            if (t.Alive) m.Items.Add(T("Fermer l'application", "Close the program"), null, (s, e) => CloseApp(t));
            else m.Items.Add(T("Lancer", "Start"), null, (s, e) => { Launch(t); Activate(t); });
            if (!t.IsMlo)
            {
                m.Items.Add(new ToolStripSeparator());
                m.Items.Add(T("Renommer…", "Rename…"), null, (s, e) =>
                {
                    string n = Prompt.Ask(this, T("Renommer", "Rename"), T("Nom de l'onglet", "Tab name"), t.Entry.Name);
                    if (string.IsNullOrWhiteSpace(n)) return;
                    t.Entry.Name = n.Trim();
                    t.Chip.Relayout();
                    settings.Save();
                    UpdateStatus();
                });
                m.Items.Add(T("Arguments de lancement…", "Launch arguments…"), null, (s, e) =>
                {
                    string a = Prompt.Ask(this, T("Arguments", "Arguments"), T("Arguments passés au programme (au prochain lancement)", "Arguments given to the program (next start)"), t.Entry.Args);
                    if (a == null) return;
                    t.Entry.Args = a.Trim();
                    settings.Save();
                });
                m.Items.Add(t.Alive ? T("Fermer et retirer de la liste", "Close and remove from the list") : T("Retirer de la liste", "Remove from the list"), null, (s, e) => Remove(t));
            }
            m.Show(t.Chip, at);
        }

        // ---------- adding programs ----------

        void ShowAddDialog()
        {
            if (closing) return;
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Activate();
            AddResult r;
            using (var f = new AddAppForm(FindCodeWalker(false) != null))
            {
                if (f.ShowDialog(this) != DialogResult.OK || f.Result == null) return;
                r = f.Result;
            }
            if (r.Choice == "share") RequestShare();
            else if (r.Choice == "live") ShowLive();
            else if (r.Choice == "world" || r.Choice == "explorer") OpenCodeWalker(r.Choice);
            else if (r.Choice == "exe") AddExe(r.Path);
            else if (r.Choice == "capture") Capture(r.Hwnd);
        }

        // ---------- "Share your project" ----------
        // The same system as MLO Creator's "Upload Mlo Site" (ui/js/siteupload.js): pick the mapping's folder, every file is
        // checked, the folder is zipped with a report, sent to the TEMPUS website, and waits there until a staff member accepts it.
        // MLO Studio shows MLO Creator and queues the request; the editor picks it up within about a second and opens the dialog.
        void RequestShare()
        {
            if (closing) return;
            if (!File.Exists(mloExe))
            {
                MessageBox.Show(this, T("MloCreator.exe n'est pas à côté de MloStudio.exe : le partage passe par MLO Creator.",
                    "MloCreator.exe is not next to MloStudio.exe: sharing goes through MLO Creator."), "Share your project", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            shareQueued = true;
            shareAskedAt = DateTime.Now;
            var mlo = tabs.FirstOrDefault(x => x.IsMlo);
            if (mlo == null || !mlo.Alive) StartMlo();
            else
            {
                if (mlo.State == TabState.Detached) Reattach(mlo);
                if (split) SetSplit(false);   // the dialog needs room
                Activate(mlo);
            }
            SetStatusHint(T("Share your project : ouverture dans MLO Creator…", "Share your project: opening in MLO Creator…"));
        }

        // ---------- "Modification live" ----------
        // The window follows what is selected in CodeWalker (CodeWalkerLink.cs). "Edit this building" shows MLO Creator on the left and
        // CodeWalker on the right and queues the building; MLO Creator's editor picks it up (path "inbox") and opens it as a project of
        // the kind "Building of the game": every change shows at once in its 3D view.
        void ShowLive()
        {
            if (closing) return;
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            if (live == null || live.IsDisposed)
            {
                live = new LiveForm(CodeWalkerWindow, LiveEdit, () => OpenCodeWalker("world"));
                live.Owner = this;
            }
            if (!live.Visible) { live.PlaceOver(this); live.Show(this); }
            live.Activate();
            // CodeWalker is what you pick in: open it when it is not there yet
            if (CodeWalkerWindow() == IntPtr.Zero && FindCodeWalker(false) != null) OpenCodeWalker("world");
        }

        // CodeWalker's World View: its tab in MLO Studio, or a CodeWalker opened on its own (not the RPF Explorer)
        IntPtr CodeWalkerWindow()
        {
            var explorerPids = new HashSet<int>();
            foreach (var t in tabs.Where(x => x.Entry.Kind == "codewalker"))
            {
                if (!t.Alive) continue;
                if (!string.IsNullOrEmpty(t.Entry.Args)) { explorerPids.Add(t.Pid); continue; }
                IntPtr h = t.State == TabState.Detached ? t.DetachedHwnd : t.Hwnd;
                if (h != IntPtr.Zero && Win.IsWindow(h)) return h;
            }
            foreach (var p in Process.GetProcessesByName("CodeWalker"))
            {
                try
                {
                    if (explorerPids.Contains(p.Id)) continue;
                    if (p.MainWindowHandle != IntPtr.Zero && Win.IsWindow(p.MainWindowHandle)) return p.MainWindowHandle;
                }
                catch { }
            }
            return IntPtr.Zero;
        }

        void LiveEdit(CwSelection sel)
        {
            if (closing || sel == null || sel.Empty) return;
            if (!File.Exists(mloExe))
            {
                MessageBox.Show(this, T("MloCreator.exe n'est pas à côté de MloStudio.exe : l'édition passe par MLO Creator.",
                    "MloCreator.exe is not next to MloStudio.exe: editing goes through MLO Creator."), T("Modification live", "Live edit"), MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            var q = new Dictionary<string, object>();
            q["name"] = sel.Name ?? "";
            q["raw"] = sel.Raw ?? "";
            q["source"] = sel.Source ?? "";
            q["hasPos"] = sel.HasPos;
            q["x"] = sel.X;
            q["y"] = sel.Y;
            q["z"] = sel.Z;
            liveQueued = q;
            var mlo = tabs.FirstOrDefault(x => x.IsMlo);
            if (mlo == null || !mlo.Alive) StartMlo();
            else if (mlo.State == TabState.Detached) Reattach(mlo);
            // MLO Creator on the left, CodeWalker on the right: the same place in both, the edits live on the left
            var cw = tabs.FirstOrDefault(x => x.Entry.Kind == "codewalker" && string.IsNullOrEmpty(x.Entry.Args) && x.Alive && x.State != TabState.Detached);
            if (cw != null)
            {
                if (!split) SetSplit(true);
                Activate(cw);
            }
            else
            {
                mlo = tabs.FirstOrDefault(x => x.IsMlo);
                if (mlo != null) Activate(mlo);
            }
            SetStatusHint(string.Format(T("Modification live : ouverture de « {0} » dans MLO Creator…", "Live edit: opening \"{0}\" in MLO Creator…"),
                !string.IsNullOrEmpty(sel.Name) ? sel.Name : sel.PosText));
        }

        static bool IsCodeWalker(string path)
        {
            return !string.IsNullOrEmpty(path) && Path.GetFileName(path).IndexOf("codewalker", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        static string NewId() { return Guid.NewGuid().ToString("N").Substring(0, 8); }

        void AddExe(string path)
        {
            if (string.IsNullOrEmpty(path)) return;
            if (string.Equals(path, mloExe, StringComparison.OrdinalIgnoreCase)) { StartMlo(); return; }
            var same = tabs.FirstOrDefault(x => string.Equals(x.Entry.Path, path, StringComparison.OrdinalIgnoreCase) && string.IsNullOrEmpty(x.Entry.Args));
            if (same != null) { if (!same.Alive) Launch(same); Activate(same); return; }
            bool cw = IsCodeWalker(path);
            if (cw) settings.CodeWalkerPath = path;
            string name = cw ? "CodeWalker" : Path.GetFileNameWithoutExtension(path);
            try
            {
                var vi = FileVersionInfo.GetVersionInfo(path);
                if (!cw && !string.IsNullOrWhiteSpace(vi.ProductName) && vi.ProductName.Length <= 28) name = vi.ProductName.Trim();
            }
            catch { }
            var t = CreateTab(new AppEntry { Id = NewId(), Kind = cw ? "codewalker" : "app", Name = name, Path = path, Args = "" });
            Launch(t);
            Activate(t);
            settings.Save();
        }

        void Capture(IntPtr h)
        {
            if (h == IntPtr.Zero || !Win.IsWindow(h)) { SetStatusHint(T("Cette fenêtre n'existe plus.", "That window is gone.")); return; }
            int pid = Win.PidOf(h);
            var mlo = tabs.FirstOrDefault(x => x.IsMlo);
            Process p = null;
            try { p = Process.GetProcessById(pid); } catch { }
            string path = null;
            try { if (p != null) path = p.MainModule.FileName; } catch { }
            AppTab t = tabs.FirstOrDefault(x => x.Pid == pid && x.State != TabState.Embedded);
            if (t == null && mlo != null && mlo.State != TabState.Embedded && path != null && string.Equals(path, mloExe, StringComparison.OrdinalIgnoreCase)) t = mlo;
            if (t == null)
            {
                bool cw = IsCodeWalker(path);
                string name = cw ? "CodeWalker" : Win.TextOf(h);
                if (string.IsNullOrWhiteSpace(name) && p != null) name = p.ProcessName;
                if (string.IsNullOrWhiteSpace(name)) name = "Application";
                if (name.Length > 28) name = name.Substring(0, 27) + "…";
                t = CreateTab(new AppEntry { Id = NewId(), Kind = cw ? "codewalker" : "app", Name = name, Path = path ?? "", Args = "", Open = true });
                if (cw && path != null) settings.CodeWalkerPath = path;
            }
            if (p != null && t.Proc == null) Track(t, p);
            t.LaunchedAt = t.SearchSince = DateTime.Now;
            t.ExeDir = path != null ? Path.GetDirectoryName(path) : null;
            Embed(t, h);
            Activate(t);
            settings.Save();
        }

        // CodeWalker's world view ("world") or its RPF Explorer ("explorer", CodeWalker.exe started with "explorer")
        void OpenCodeWalker(string mode)
        {
            if (closing) return;
            string args = mode == "explorer" ? "explorer" : "";
            var t = tabs.FirstOrDefault(x => x.Entry.Kind == "codewalker" && (x.Entry.Args ?? "") == args);
            if (t != null)
            {
                if (t.State == TabState.Detached) Reattach(t);
                else if (!t.Alive) Launch(t);
                Activate(t);
                return;
            }
            Cursor = Cursors.WaitCursor;
            string exe = FindCodeWalker(true);
            Cursor = Cursors.Default;
            if (exe == null)
            {
                using (var d = new OpenFileDialog())
                {
                    d.Title = T("Où est CodeWalker.exe ?", "Where is CodeWalker.exe?");
                    d.Filter = "CodeWalker.exe|CodeWalker.exe|" + T("Programmes (*.exe)|*.exe", "Programs (*.exe)|*.exe");
                    d.FileName = "CodeWalker.exe";
                    if (d.ShowDialog(this) != DialogResult.OK)
                    {
                        SetStatusHint(T("CodeWalker n'est pas trouvé. Télécharge-le sur github.com/dexyfex/CodeWalker, puis réessaie.", "CodeWalker was not found. Get it from github.com/dexyfex/CodeWalker, then try again."));
                        return;
                    }
                    exe = d.FileName;
                }
            }
            settings.CodeWalkerPath = exe;
            t = CreateTab(new AppEntry { Id = NewId(), Kind = "codewalker", Name = mode == "explorer" ? "RPF Explorer" : "CodeWalker", Path = exe, Args = args });
            Launch(t);
            Activate(t);
            settings.Save();
        }

        string FindCodeWalker(bool searchDisk)
        {
            var known = new List<string>();
            if (!string.IsNullOrEmpty(settings.CodeWalkerPath)) known.Add(settings.CodeWalkerPath);
            foreach (var a in settings.Apps) if (a.Kind == "codewalker" && !string.IsNullOrEmpty(a.Path)) known.Add(a.Path);
            string env = Environment.GetEnvironmentVariable("CODEWALKER_DIR");
            if (!string.IsNullOrEmpty(env)) known.Add(Path.Combine(env, "CodeWalker.exe"));
            foreach (var k in known) { try { if (File.Exists(k)) return k; } catch { } }
            if (!searchDisk) return null;
            string profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            var mine = new[] {
                Program.AppDir, Path.GetDirectoryName(Program.AppDir),
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                Path.Combine(profile, "Downloads"), Path.Combine(profile, "OneDrive", "Desktop"), Path.Combine(profile, "OneDrive", "Bureau"),
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments) };
            foreach (var r in mine) { var f = Search(r, 2, false); if (f != null) return f; }
            var wide = new[] {
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"C:\", @"D:\", @"E:\" };
            foreach (var r in wide) { var f = Search(r, 1, true); if (f != null) return f; }
            return null;
        }

        // CodeWalker.exe in dir or a few folders down (onlyNamed: only folders whose name says CodeWalker)
        static string Search(string dir, int depth, bool onlyNamed)
        {
            try
            {
                if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return null;
                string f = Path.Combine(dir, "CodeWalker.exe");
                if (File.Exists(f)) return f;
                if (depth <= 0) return null;
                foreach (var sub in Directory.GetDirectories(dir))
                {
                    string n = Path.GetFileName(sub);
                    if (n.StartsWith("$") || n.StartsWith(".") || n.Equals("Windows", StringComparison.OrdinalIgnoreCase) || n.Equals("node_modules", StringComparison.OrdinalIgnoreCase)) continue;
                    bool named = n.IndexOf("codewalker", StringComparison.OrdinalIgnoreCase) >= 0;
                    if (onlyNamed && !named) continue;
                    var r = Search(sub, named ? 2 : depth - 1, onlyNamed && !named);
                    if (r != null) return r;
                }
            }
            catch { }
            return null;
        }

        // ---------- the bridge with MLO Creator's editor ----------

        void WriteConfig(bool on)
        {
            try
            {
                string dir = Path.Combine(Program.AppDir, "ui", "js");
                if (!Directory.Exists(dir)) return;
                string js = on
                    ? "// Written by MloStudio.exe while it runs (its local port and key). Do not share.\nwindow.MLO_STUDIO = {\"port\":" + bridge.Port + ",\"token\":\"" + bridge.Token + "\",\"pid\":" + Process.GetCurrentProcess().Id + "};\n"
                    : "// MLO Studio is not running.\nwindow.MLO_STUDIO = null;\n";
                File.WriteAllText(Path.Combine(dir, "studio-config.js"), js);
            }
            catch (Exception e) { Log.Error(e); }
        }

        string HandleApiThreaded(string path, Dictionary<string, string> a)
        {
            if (IsDisposed || !IsHandleCreated || closing) return "{\"ok\":false,\"closing\":true}";
            try { return (string)Invoke(new Func<string>(() => HandleApi(path, a))); }
            catch (Exception e) { Log.Error(e); return "{\"ok\":false}"; }
        }

        static string Get(Dictionary<string, string> a, string k)
        {
            string v;
            return a.TryGetValue(k, out v) ? v : "";
        }

        string HandleApi(string path, Dictionary<string, string> a)
        {
            string lang = Get(a, "lang");
            if (lang.Length > 0)
            {
                if (lang.Length <= 8 && lang != L.Code) { L.Code = lang; settings.Lang = lang; ApplyTexts(); settings.Save(); }
            }
            switch (path)
            {
                case "status":
                    break;
                case "inbox":
                    {
                        // asked about once a second by MLO Creator's editor: hands over a queued "Share your project" once
                        bool share = shareQueued;
                        shareQueued = false;
                        // and a building of "Modification live" once
                        var lv = liveQueued;
                        liveQueued = null;
                        return new JavaScriptSerializer().Serialize(new { ok = true, share = share, live = lv });
                    }
                case "share":
                    BeginInvoke(new Action(RequestShare));
                    break;
                case "live":
                    BeginInvoke(new Action(ShowLive));
                    break;
                case "show":
                    {
                        var t = tabs.FirstOrDefault(x => x.Entry.Id == Get(a, "id"));
                        if (t != null)
                        {
                            if (t.State == TabState.Detached) Reattach(t);
                            else if (!t.Alive) Launch(t);
                            Activate(t);
                        }
                        break;
                    }
                case "codewalker":
                    {
                        string mode = Get(a, "mode") == "explorer" ? "explorer" : "world";
                        BeginInvoke(new Action(() => OpenCodeWalker(mode)));   // may ask where CodeWalker is: not inside the request
                        break;
                    }
                case "add":
                    BeginInvoke(new Action(ShowAddDialog));
                    break;
                case "split":
                    {
                        string on = Get(a, "on");
                        SetSplit(on == "toggle" ? !split : on == "1");
                        break;
                    }
                default:
                    return "{\"ok\":false,\"error\":\"unknown\"}";
            }
            return StatusJson();
        }

        string StatusJson()
        {
            var apps = tabs.Select(t => new
            {
                id = t.Entry.Id,
                name = t.Entry.Name,
                kind = t.Entry.Kind,
                state = StateKey(t.State),
                active = t == active,
                shown = t.Host.Visible
            }).ToList();
            return new JavaScriptSerializer().Serialize(new
            {
                ok = true,
                version = 1,
                split = split,
                active = active != null ? active.Entry.Id : null,
                codewalker = FindCodeWalker(false) != null,
                apps = apps
            });
        }

        // ---------- closing ----------

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (reallyClose) { base.OnFormClosing(e); return; }
            e.Cancel = true;
            if (closing) return;
            var others = tabs.Where(t => !t.IsMlo && t.Alive && (t.State == TabState.Embedded || t.State == TabState.Searching)).ToList();
            bool closeOthers = true;
            if (others.Count > 0)
            {
                var r = MessageBox.Show(this,
                    string.Format(T("Fermer aussi {0} ?\n\nOui : tout fermer.\nNon : les laisser ouvertes dans leur propre fenêtre.", "Close {0} too?\n\nYes: close everything.\nNo: leave them open in their own windows."),
                        string.Join(", ", others.Select(o => o.Entry.Name))),
                    "MLO Studio", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question);
                if (r == DialogResult.Cancel) return;
                closeOthers = r == DialogResult.Yes;
            }
            foreach (var t in tabs) t.Entry.Open = !t.IsMlo && t.Alive;
            if (live != null && !live.IsDisposed) live.Hide();
            SaveBounds();
            settings.Save();
            closing = true;
            status.Text = T("Enregistrement et fermeture…", "Saving and closing…");
            toClose = new List<AppTab>();
            foreach (var t in tabs)
            {
                if (!t.Alive || t.State == TabState.Detached) continue;
                if (t.IsMlo || closeOthers)
                {
                    toClose.Add(t);
                    IntPtr h = t.Hwnd != IntPtr.Zero ? t.Hwnd : t.DetachedHwnd;
                    if (h != IntPtr.Zero && Win.IsWindow(h)) Win.PostMessage(h, Win.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                    else { try { t.Proc.CloseMainWindow(); } catch { } }
                }
                else Release(t);
            }
            // MLO Creator saves the project when its window closes: give it the time it needs
            closeDeadline = DateTime.Now.AddSeconds(20);
            closeTimer.Start();
        }

        void CloseTick()
        {
            bool done = toClose.All(t => !t.Alive);
            if (!done && DateTime.Now < closeDeadline) return;
            closeTimer.Stop();
            watch.Stop();
            foreach (var t in tabs) if (t.Hwnd != IntPtr.Zero && Win.IsWindow(t.Hwnd)) Release(t);
            WriteConfig(false);
            bridge.Stop();
            if (live != null && !live.IsDisposed) live.Quit();
            reallyClose = true;
            Close();
        }
    }
}
