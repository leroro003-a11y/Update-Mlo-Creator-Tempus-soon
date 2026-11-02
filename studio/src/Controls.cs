// MLO Studio: the tab chips of the top bar, and the "Add an application" dialog.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Windows.Forms;

namespace MloStudio
{
    public enum TabState { Idle, Searching, Embedded, Exited, Detached }

    // one program of MLO Studio: its process, its window and the panel that holds it
    class AppTab
    {
        public AppEntry Entry;
        public Process Proc;
        public IntPtr Hwnd = IntPtr.Zero;          // the window while it is inside MLO Studio
        public IntPtr DetachedHwnd = IntPtr.Zero;  // the window while it is in its own window again
        public TabState State = TabState.Idle;
        public Panel Host;
        public InfoCard Info;
        public TabChip Chip;
        public long OrigStyle, OrigExStyle;
        public Win.RECT OrigRect;
        public DateTime LaunchedAt = DateTime.MinValue, SearchSince = DateTime.MinValue;
        public string ExeDir;
        public bool EmbeddedOnce, SlowHintShown, PendingRemove;

        public bool IsMlo { get { return Entry.Kind == "mlo"; } }

        public bool Alive
        {
            get
            {
                if (Proc == null) return false;
                try { return !Proc.HasExited; }
                catch { IntPtr h = Hwnd != IntPtr.Zero ? Hwnd : DetachedHwnd; return h != IntPtr.Zero && Win.IsWindow(h); }
            }
        }

        public int Pid
        {
            get { try { return Proc != null ? Proc.Id : -1; } catch { return -1; } }
        }
    }

    class TabChip : Control
    {
        public readonly AppTab Tab;
        public bool Active, Shown, Pulse;
        bool hover;

        public TabChip(AppTab tab)
        {
            Tab = tab;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Bar;
            Font = Theme.UI(9.5f, FontStyle.Bold);
            Height = Theme.S(32);
            Margin = new Padding(Theme.S(2), Theme.S(7), Theme.S(2), Theme.S(7));
            Cursor = Cursors.Hand;
            Relayout();
        }

        public void Relayout()
        {
            Width = TextRenderer.MeasureText(Tab.Entry.Name ?? "", Font).Width + Theme.S(44);
            Invalidate();
        }

        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }

        Color DotColor()
        {
            switch (Tab.State)
            {
                case TabState.Embedded: return Theme.Ok;
                case TabState.Searching: return Pulse ? Color.FromArgb(120, Theme.Wait) : Theme.Wait;
                case TabState.Detached: return Theme.Cyan;
                default: return Theme.Dim;
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(BackColor);
            var r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
            using (var p = Theme.Round(r, Theme.S(9)))
            {
                if (Active)
                {
                    using (var b = new LinearGradientBrush(new Rectangle(0, 0, Math.Max(1, Width), Math.Max(1, Height)), Theme.Accent, Theme.Accent2, 0f)) g.FillPath(b, p);
                }
                else if (Shown || hover)
                {
                    using (var b = new SolidBrush(Theme.Hover)) g.FillPath(b, p);
                    if (Shown) using (var pen = new Pen(Theme.Accent, 1f)) g.DrawPath(pen, p);
                }
            }
            int d = Theme.S(8);
            using (var b = new SolidBrush(DotColor())) g.FillEllipse(b, Theme.S(13), (Height - d) / 2, d, d);
            Color fore = Active ? Color.White : (hover || Shown ? Theme.Text : Theme.Muted);
            TextRenderer.DrawText(g, Tab.Entry.Name ?? "", Font, new Rectangle(Theme.S(28), 0, Width - Theme.S(34), Height), fore,
                TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
        }
    }

    // a big clickable choice of the "Add an application" dialog
    class Tile : Control
    {
        readonly string title, desc;
        readonly bool highlight;   // the "Share your project" card: accent border and a soft accent fill
        bool hover;
        readonly Font titleFont = Theme.UI(10.5f, FontStyle.Bold), descFont = Theme.UI(9f);

        public Tile(string title, string desc, Action click) : this(title, desc, click, false) { }

        public Tile(string title, string desc, Action click, bool highlight)
        {
            this.title = title;
            this.desc = desc;
            this.highlight = highlight;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.Selectable, true);
            Cursor = Cursors.Hand;
            Dock = DockStyle.Fill;
            Margin = new Padding(Theme.S(4));
            TabStop = true;
            Click += (s, e) => click();
            KeyDown += (s, e) => { if (e.KeyCode == Keys.Enter || e.KeyCode == Keys.Space) click(); };
        }

        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
        protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Parent != null ? Parent.BackColor : Theme.Panel);
            var r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
            bool on = hover || Focused;
            using (var p = Theme.Round(r, Theme.S(10)))
            {
                if (highlight)
                {
                    var rr = new Rectangle(0, 0, Math.Max(1, Width), Math.Max(1, Height));
                    using (var b = new LinearGradientBrush(rr, on ? Color.FromArgb(52, 44, 110) : Color.FromArgb(36, 31, 78), on ? Color.FromArgb(22, 58, 74) : Color.FromArgb(16, 40, 54), 0f)) g.FillPath(b, p);
                    using (var pen = new Pen(on ? Theme.Cyan : Theme.Accent, on ? 1.6f : 1.2f)) g.DrawPath(pen, p);
                }
                else
                {
                    using (var b = new SolidBrush(on ? Color.FromArgb(34, 32, 64) : Theme.Bar)) g.FillPath(b, p);
                    using (var pen = new Pen(on ? Theme.Accent : Theme.Line, 1f)) g.DrawPath(pen, p);
                }
            }
            int pad = Theme.S(14);
            TextRenderer.DrawText(g, title, titleFont, new Rectangle(pad, Theme.S(11), Width - 2 * pad, Theme.S(24)), Theme.Text,
                TextFormatFlags.Left | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
            TextRenderer.DrawText(g, desc, descFont, new Rectangle(pad, Theme.S(36), Width - 2 * pad, Height - Theme.S(42)), Theme.Muted,
                TextFormatFlags.Left | TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);
        }
    }

    class AddResult
    {
        public string Choice;   // "share", "live", "world", "explorer", "exe", "capture"
        public string Path;
        public IntPtr Hwnd;
    }

    class AddAppForm : Form
    {
        public AddResult Result;
        readonly ListView list;
        static int S(int v) { return Theme.S(v); }
        static string T(string fr, string en) { return L.T(fr, en); }

        public AddAppForm(bool codeWalkerKnown)
        {
            Text = T("Ajouter une application", "Add an application");
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.CenterParent;
            BackColor = Theme.Panel;
            ForeColor = Theme.Text;
            Font = Theme.UI(9.5f);
            ClientSize = new Size(S(660), S(722));
            KeyPreview = true;
            KeyDown += (s, e) => { if (e.KeyCode == Keys.Escape) { DialogResult = DialogResult.Cancel; Close(); } };
            int pad = S(18), w = ClientSize.Width - 2 * pad;

            var title = new Label();
            title.Text = T("Ajouter une application", "Add an application");
            title.Font = Theme.UI(14f, FontStyle.Bold);
            title.AutoSize = true;
            title.Location = new Point(pad, pad);
            var sub = new Label();
            sub.Text = T("Sa fenêtre s'affiche directement dans MLO Studio, dans un onglet à côté de MLO Creator.",
                "Its window shows right inside MLO Studio, in a tab next to MLO Creator.");
            sub.ForeColor = Theme.Muted;
            sub.AutoSize = true;
            sub.MaximumSize = new Size(w, 0);
            sub.Location = new Point(pad, pad + S(34));

            var tiles = new TableLayoutPanel();
            tiles.ColumnCount = 2;
            tiles.RowCount = 3;
            tiles.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50f));
            tiles.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50f));
            tiles.RowStyles.Add(new RowStyle(SizeType.Percent, 33.34f));
            tiles.RowStyles.Add(new RowStyle(SizeType.Percent, 33.33f));
            tiles.RowStyles.Add(new RowStyle(SizeType.Percent, 33.33f));
            tiles.Location = new Point(pad - S(4), S(92));
            tiles.Size = new Size(w + S(8), S(300));
            tiles.BackColor = Theme.Panel;
            string cwNote = codeWalkerKnown ? "" : T(" (tu choisiras CodeWalker.exe)", " (you will pick CodeWalker.exe)");
            // 1st card, across the whole width: share a mapping on the TEMPUS website (same system as MLO Creator's "Upload Mlo Site")
            var share = new Tile(T("Partage ton projet", "Share your project"),
                T("Analyse les fichiers, compresse le dossier en ZIP et l'envoie sur le site TEMPUS : en attente jusqu'à ce qu'un staff l'accepte",
                  "Checks the files, zips the folder and sends it to the TEMPUS website: pending until a staff member accepts it"),
                () => Done("share"), true);
            tiles.Controls.Add(share, 0, 0);
            // 2nd card of the first row: pick a building in CodeWalker and edit it with a live preview (LiveForm.cs)
            tiles.Controls.Add(new Tile(T("Modification live", "Live edit"),
                T("Sélectionne un bâtiment dans CodeWalker et édite-le avec un aperçu en direct, côte à côte", "Pick a building in CodeWalker and edit it with a live preview, side by side"),
                () => Done("live"), true), 1, 0);
            tiles.Controls.Add(new Tile(T("Carte du monde", "World map"), T("CodeWalker · World View : la map de GTA V en 3D", "CodeWalker · World View: GTA V's map in 3D") + cwNote, () => Done("world")), 0, 1);
            tiles.Controls.Add(new Tile("RPF Explorer", T("CodeWalker · parcourir et extraire les fichiers du jeu", "CodeWalker · browse and extract the game files") + cwNote, () => Done("explorer")), 1, 1);
            tiles.Controls.Add(new Tile(T("Autre programme (.exe)", "Another program (.exe)"), T("OpenIV, Blender, un éditeur de texte… n'importe quel logiciel", "OpenIV, Blender, a text editor… any program"), PickExe), 0, 2);
            tiles.Controls.Add(new Tile(T("Fenêtre déjà ouverte", "A window already open"), T("Choisis-la dans la liste en dessous, elle passe dans MLO Studio", "Pick it in the list below, it moves into MLO Studio"), () => list.Focus()), 1, 2);

            var lh = new Label();
            lh.Text = T("FENÊTRES OUVERTES", "OPEN WINDOWS");
            lh.Font = Theme.UI(8f, FontStyle.Bold);
            lh.ForeColor = Theme.Muted;
            lh.AutoSize = true;
            lh.Location = new Point(pad, S(406));

            list = new ListView();
            list.View = View.Details;
            list.FullRowSelect = true;
            list.HeaderStyle = ColumnHeaderStyle.Nonclickable;
            list.MultiSelect = false;
            list.HideSelection = false;
            list.Location = new Point(pad, S(428));
            list.Size = new Size(w, S(222));
            list.BackColor = Theme.Bg;
            list.ForeColor = Theme.Text;
            list.BorderStyle = BorderStyle.FixedSingle;
            list.Columns.Add(T("Fenêtre", "Window"), w - S(190));
            list.Columns.Add(T("Programme", "Program"), S(170));
            list.DoubleClick += (s, e) => CaptureSelected();

            var row = new FlowLayoutPanel();
            row.FlowDirection = FlowDirection.RightToLeft;
            row.Location = new Point(pad, S(662));
            row.Size = new Size(w + S(6), S(48));
            row.BackColor = Theme.Panel;
            row.Controls.Add(Theme.Btn(T("Intégrer cette fenêtre", "Bring this window in"), true, (s, e) => CaptureSelected()));
            row.Controls.Add(Theme.Btn(T("Actualiser", "Refresh"), false, (s, e) => FillList()));
            row.Controls.Add(Theme.Btn(T("Annuler", "Cancel"), false, (s, e) => { DialogResult = DialogResult.Cancel; Close(); }));

            Controls.Add(title);
            Controls.Add(sub);
            Controls.Add(tiles);
            Controls.Add(lh);
            Controls.Add(list);
            Controls.Add(row);
            FillList();
        }

        void FillList()
        {
            list.BeginUpdate();
            list.Items.Clear();
            int own = Process.GetCurrentProcess().Id;
            var skip = new HashSet<string>(new[] { "Progman", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "WorkerW", "Windows.UI.Core.CoreWindow", "IME", "MSCTFIME UI" });
            var names = new Dictionary<int, string>();
            var items = new List<ListViewItem>();
            foreach (var w in Win.TopWindows())
            {
                if (!w.Visible || w.Owned || w.Pid == own || string.IsNullOrWhiteSpace(w.Title)) continue;
                if ((w.ExStyle & Win.WS_EX_TOOLWINDOW) != 0 || skip.Contains(w.Class)) continue;
                if (w.Rect.Width < 120 || w.Rect.Height < 80) continue;
                string pname;
                if (!names.TryGetValue(w.Pid, out pname))
                {
                    pname = "";
                    try { pname = Process.GetProcessById(w.Pid).ProcessName; } catch { }
                    names[w.Pid] = pname;
                }
                var it = new ListViewItem(new[] { w.Title, pname });
                it.Tag = w.Handle;
                items.Add(it);
            }
            // CodeWalker first: it is what this is mostly for
            foreach (var it in items.OrderBy(i => i.SubItems[1].Text.IndexOf("codewalker", StringComparison.OrdinalIgnoreCase) >= 0 ? 0 : 1))
                list.Items.Add(it);
            list.EndUpdate();
        }

        void CaptureSelected()
        {
            if (list.SelectedItems.Count == 0)
            {
                MessageBox.Show(this, T("Choisis d'abord une fenêtre dans la liste.", "Pick a window in the list first."), Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            Result = new AddResult { Choice = "capture", Hwnd = (IntPtr)list.SelectedItems[0].Tag };
            DialogResult = DialogResult.OK;
            Close();
        }

        void PickExe()
        {
            using (var d = new OpenFileDialog())
            {
                d.Title = T("Choisir un programme", "Pick a program");
                d.Filter = T("Programmes (*.exe)|*.exe", "Programs (*.exe)|*.exe");
                if (d.ShowDialog(this) != DialogResult.OK) return;
                Result = new AddResult { Choice = "exe", Path = d.FileName };
                DialogResult = DialogResult.OK;
                Close();
            }
        }

        void Done(string choice)
        {
            Result = new AddResult { Choice = choice };
            DialogResult = DialogResult.OK;
            Close();
        }
    }
}
