// MLO Studio, "Modification live": a small window over MLO Studio that follows what is selected in CodeWalker.
// "Edit this building" puts MLO Creator on the left and CodeWalker on the right, and asks MLO Creator's editor to open that building
// (Building of the game): every change made in the editor shows at once in its 3D view, next to CodeWalker's view of the same place.
using System;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;

namespace MloStudio
{
    class LiveForm : Form
    {
        readonly Func<IntPtr> findCodeWalker;       // CodeWalker's World View window (asked on the UI thread)
        readonly Action<CwSelection> edit;          // "Edit this building"
        readonly Action openCodeWalker;
        readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
        int reading;                                 // 1 while a read of CodeWalker runs on a worker thread
        bool quitting;

        Label state, selName, selRaw, selPos;
        TextBox query;
        CheckBox follow, auto;
        Button bEdit, bClip, bCw;
        CwSelection current;                         // what the window shows (CodeWalker, clipboard or typed)
        string lastKey = "", autoKey = "", stableKey = "";
        DateTime stableSince = DateTime.MinValue;
        bool typed;                                  // the search box was changed by hand: following stops filling it

        static int S(int v) { return Theme.S(v); }
        static string T(string fr, string en) { return L.T(fr, en); }

        public LiveForm(Func<IntPtr> findCodeWalker, Action<CwSelection> edit, Action openCodeWalker)
        {
            this.findCodeWalker = findCodeWalker;
            this.edit = edit;
            this.openCodeWalker = openCodeWalker;

            Text = T("Modification live", "Live edit");
            FormBorderStyle = FormBorderStyle.FixedToolWindow;
            ShowInTaskbar = false;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.Manual;
            BackColor = Theme.Panel;
            ForeColor = Theme.Text;
            Font = Theme.UI(9.5f);
            ClientSize = new Size(S(430), S(400));
            KeyPreview = true;
            KeyDown += (s, e) => { if (e.KeyCode == Keys.Escape) Hide(); };

            int pad = S(16), w = ClientSize.Width - 2 * pad, y = pad;

            var title = new Label();
            title.Text = T("Modification live", "Live edit");
            title.Font = Theme.UI(13f, FontStyle.Bold);
            title.ForeColor = Theme.Text;
            title.AutoSize = true;
            title.Location = new Point(pad, y);
            y += S(30);

            var sub = new Label();
            sub.Text = T("Clique un bâtiment ou un objet dans CodeWalker, puis « Éditer ce bâtiment » : MLO Creator l'ouvre à gauche, CodeWalker reste à droite, et chaque modification s'affiche en direct dans la vue 3D.",
                "Click a building or an object in CodeWalker, then \"Edit this building\": MLO Creator opens it on the left, CodeWalker stays on the right, and every change shows live in the 3D view.");
            sub.ForeColor = Theme.Muted;
            sub.AutoSize = true;
            sub.MaximumSize = new Size(w, 0);
            sub.Location = new Point(pad, y);
            Controls.Add(sub);
            y += sub.GetPreferredSize(new Size(w, 0)).Height + S(10);

            state = new Label();
            state.AutoSize = true;
            state.MaximumSize = new Size(w, 0);
            state.Font = Theme.UI(8.5f);
            state.ForeColor = Theme.Wait;
            state.Location = new Point(pad, y);
            y += S(46);

            var card = new Panel();
            card.Location = new Point(pad, y);
            card.Size = new Size(w, S(92));
            card.BackColor = Theme.Bar;
            card.Paint += (s, e) => { using (var p = new Pen(Theme.Line)) e.Graphics.DrawRectangle(p, 0, 0, card.Width - 1, card.Height - 1); };
            var cap = new Label();
            cap.Text = T("SÉLECTION DANS CODEWALKER", "SELECTED IN CODEWALKER");
            cap.Font = Theme.UI(7.5f, FontStyle.Bold);
            cap.ForeColor = Theme.Muted;
            cap.AutoSize = true;
            cap.Location = new Point(S(10), S(8));
            selName = new Label();
            selName.Font = Theme.UI(12f, FontStyle.Bold);
            selName.ForeColor = Theme.Accent;
            selName.AutoEllipsis = true;
            selName.Location = new Point(S(10), S(24));
            selName.Size = new Size(w - S(20), S(26));
            selRaw = new Label();
            selRaw.Font = Theme.UI(8.5f);
            selRaw.ForeColor = Theme.Muted;
            selRaw.AutoEllipsis = true;
            selRaw.Location = new Point(S(10), S(51));
            selRaw.Size = new Size(w - S(20), S(18));
            selPos = new Label();
            selPos.Font = Theme.UI(8.5f);
            selPos.ForeColor = Theme.Dim;
            selPos.AutoEllipsis = true;
            selPos.Location = new Point(S(10), S(69));
            selPos.Size = new Size(w - S(20), S(18));
            card.Controls.Add(cap);
            card.Controls.Add(selName);
            card.Controls.Add(selRaw);
            card.Controls.Add(selPos);
            y += card.Height + S(10);

            var ql = new Label();
            ql.Text = T("Bâtiment à ouvrir (nom, ou position x y)", "Building to open (name, or position x y)");
            ql.ForeColor = Theme.Muted;
            ql.Font = Theme.UI(8.5f);
            ql.AutoSize = true;
            ql.Location = new Point(pad, y);
            y += S(20);
            query = new TextBox();
            query.Location = new Point(pad, y);
            query.Width = w;
            query.BackColor = Theme.Bg;
            query.ForeColor = Theme.Text;
            query.BorderStyle = BorderStyle.FixedSingle;
            query.TextChanged += (s, e) => { if (query.Focused) typed = true; };
            query.KeyDown += (s, e) => { if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; Edit(); } };
            y += S(30);

            follow = new CheckBox();
            follow.Text = T("Suivre la sélection de CodeWalker", "Follow CodeWalker's selection");
            follow.Checked = true;
            follow.AutoSize = true;
            follow.ForeColor = Theme.Text;
            follow.Location = new Point(pad, y);
            follow.CheckedChanged += (s, e) => { if (follow.Checked) { typed = false; lastKey = ""; } };
            y += S(24);
            auto = new CheckBox();
            auto.Text = T("Ouvrir tout seul chaque nouveau bâtiment sélectionné", "Open each newly selected building by itself");
            auto.Checked = false;
            auto.AutoSize = true;
            auto.ForeColor = Theme.Text;
            auto.Location = new Point(pad, y);
            y += S(30);

            var row = new FlowLayoutPanel();
            row.FlowDirection = FlowDirection.RightToLeft;
            row.Location = new Point(pad - S(6), y);
            row.Size = new Size(w + S(6), S(44));
            row.BackColor = Theme.Panel;
            bEdit = Theme.Btn(T("Éditer ce bâtiment", "Edit this building"), true, (s, e) => Edit());
            bClip = Theme.Btn(T("Presse-papiers", "Clipboard"), false, (s, e) => FromClipboard());
            bCw = Theme.Btn(T("Ouvrir CodeWalker", "Open CodeWalker"), false, (s, e) => { if (openCodeWalker != null) openCodeWalker(); });
            row.Controls.Add(bEdit);
            row.Controls.Add(bClip);
            row.Controls.Add(bCw);
            y += S(48);

            Controls.Add(title);
            Controls.Add(state);
            Controls.Add(card);
            Controls.Add(ql);
            Controls.Add(query);
            Controls.Add(follow);
            Controls.Add(auto);
            Controls.Add(row);
            ClientSize = new Size(ClientSize.Width, y + S(6));

            var tip = new ToolTip();
            tip.SetToolTip(bClip, T("Prend un nom ou une position copiés (par exemple la Position d'une entité dans CodeWalker)", "Takes a name or a position you copied (for example an entity's Position in CodeWalker)"));
            tip.SetToolTip(auto, T("Attend que la sélection ne bouge plus pendant une seconde, puis l'ouvre dans MLO Creator", "Waits until the selection stays the same for a second, then opens it in MLO Creator"));

            ShowSelection(null);
            timer.Interval = 600;
            timer.Tick += (s, e) => Tick();
        }

        // shown again: start following
        protected override void OnVisibleChanged(EventArgs e)
        {
            base.OnVisibleChanged(e);
            if (Visible) { lastKey = ""; timer.Start(); Tick(); } else timer.Stop();
        }

        // closing only hides it (MLO Studio keeps it for next time); Quit() really closes it
        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!quitting && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); return; }
            timer.Stop();
            base.OnFormClosing(e);
        }

        public void Quit() { quitting = true; timer.Stop(); Close(); }

        // next to the right edge of MLO Studio, over CodeWalker's side
        public void PlaceOver(Form owner)
        {
            var r = owner.RectangleToScreen(owner.ClientRectangle);
            int x = r.Right - Width - S(24), y = r.Top + S(64);
            var wa = Screen.FromControl(owner).WorkingArea;
            x = Math.Max(wa.Left, Math.Min(wa.Right - Width, x));
            y = Math.Max(wa.Top, Math.Min(wa.Bottom - Height, y));
            Location = new Point(x, y);
        }

        void Tick()
        {
            if (!Visible || IsDisposed) return;
            IntPtr cw = IntPtr.Zero;
            try { cw = findCodeWalker != null ? findCodeWalker() : IntPtr.Zero; } catch (Exception ex) { Log.Error(ex); }
            bCw.Visible = cw == IntPtr.Zero;
            if (cw == IntPtr.Zero)
            {
                SetState(T("CodeWalker n'est pas ouvert : clique « Ouvrir CodeWalker », ou tape un nom / une position.", "CodeWalker is not open: click \"Open CodeWalker\", or type a name / a position."), Theme.Wait);
                return;
            }
            if (!follow.Checked) { SetState(T("Suivi arrêté : le bâtiment tapé est ouvert.", "Not following: the typed building is opened."), Theme.Muted); return; }
            if (Interlocked.CompareExchange(ref reading, 1, 0) != 0) return;
            // the read asks CodeWalker's window (it may be busy loading): never on the UI thread
            ThreadPool.QueueUserWorkItem(_ =>
            {
                CwSelection r = null;
                string problem = "";
                try { r = CodeWalkerLink.Read(cw); problem = CodeWalkerLink.LastProblem; }
                catch (Exception ex) { Log.Error(ex); problem = "error"; }
                finally { Interlocked.Exchange(ref reading, 0); }
                try { if (!IsDisposed && IsHandleCreated) BeginInvoke(new Action(() => OnRead(r, problem))); } catch { }
            });
        }

        void OnRead(CwSelection r, string problem)
        {
            if (IsDisposed || !follow.Checked) return;
            if (r == null)
            {
                if (problem == "rights")
                    SetState(T("Windows refuse de lire CodeWalker : lance MLO Studio et CodeWalker avec les mêmes droits (tous les deux en administrateur, ou aucun).",
                        "Windows will not let CodeWalker be read: run MLO Studio and CodeWalker with the same rights (both as administrator, or neither)."), Theme.Red);
                else if (problem == "noselectionbox")
                    SetState(T("Ouvre le panneau d'outils de CodeWalker (bouton >> en haut à droite) puis son onglet « Selection » une fois, et clique un objet.",
                        "Open CodeWalker's tools panel (the >> button at the top right), then its \"Selection\" tab once, and click an object."), Theme.Wait);
                else SetState(T("CodeWalker charge encore…", "CodeWalker is still loading…"), Theme.Wait);
                return;
            }
            if (string.IsNullOrEmpty(r.Name))
                SetState(T("Rien de sélectionné dans CodeWalker : clique un bâtiment ou un objet de la carte.", "Nothing selected in CodeWalker: click a building or an object of the map."), Theme.Muted);
            else
                SetState(T("Connecté à CodeWalker · la sélection est suivie.", "Connected to CodeWalker · following the selection."), Theme.Ok);

            if (string.IsNullOrEmpty(r.Name))
            {
                if (!typed) query.Text = "";
                if (current == null || current.Source == "codewalker") ShowSelection(r);
                return;
            }
            if (r.Key != lastKey)
            {
                lastKey = r.Key;
                ShowSelection(r);
                if (!typed) query.Text = r.Name;
                stableKey = r.Key;
                stableSince = DateTime.Now;
            }
            else ShowSelection(r);   // (the camera moves: its position follows)

            // "Open each newly selected building by itself": once the selection stays the same for a second
            if (auto.Checked && r.Key == stableKey && r.Key != autoKey && (DateTime.Now - stableSince).TotalMilliseconds >= 1000)
            {
                autoKey = r.Key;
                Send(r);
            }
        }

        void SetState(string text, Color c)
        {
            if (state.Text != text) state.Text = text;
            state.ForeColor = c;
        }

        void ShowSelection(CwSelection r)
        {
            current = r;
            if (r == null || r.Empty)
            {
                selName.Text = "—";
                selName.ForeColor = Theme.Dim;
                selRaw.Text = T("Clique un objet dans la vue de CodeWalker.", "Click an object in CodeWalker's view.");
                selPos.Text = "";
                return;
            }
            selName.ForeColor = Theme.Accent;
            selName.Text = !string.IsNullOrEmpty(r.Name) ? r.Name : r.PosText;
            selRaw.Text = r.Raw != r.Name ? r.Raw : "";
            string src = r.Source == "clipboard" ? T("presse-papiers", "clipboard") : r.Source == "manual" ? T("tapé", "typed") : "CodeWalker";
            selPos.Text = (r.HasPos ? (r.Source == "codewalker" ? T("Caméra : ", "Camera: ") : T("Position : ", "Position: ")) + r.PosText + "  ·  " : "") + src;
        }

        void FromClipboard()
        {
            string text = "";
            try { if (Clipboard.ContainsText()) text = Clipboard.GetText(); } catch { }
            if (string.IsNullOrWhiteSpace(text))
            {
                SetState(T("Le presse-papiers est vide : copie d'abord un nom ou une position.", "The clipboard is empty: copy a name or a position first."), Theme.Wait);
                return;
            }
            var r = CodeWalkerLink.FromText(text, "clipboard");
            if (r.Empty) { SetState(T("Pas de nom ni de position dans le presse-papiers.", "No name or position on the clipboard."), Theme.Wait); return; }
            follow.Checked = false;
            ShowSelection(r);
            query.Text = !string.IsNullOrEmpty(r.Name) ? r.Name : Math.Round(r.X) + " " + Math.Round(r.Y);
            typed = true;
        }

        void Edit()
        {
            string q = (query.Text ?? "").Trim();
            CwSelection r;
            if (current != null && !current.Empty && (q.Length == 0 || q.Equals(current.Name, StringComparison.OrdinalIgnoreCase)))
                r = current;
            else
            {
                r = CodeWalkerLink.FromText(q, "manual");
                // what was typed, with CodeWalker's camera position as a second guess
                if (!r.HasPos && current != null && current.HasPos) { r.HasPos = true; r.X = current.X; r.Y = current.Y; r.Z = current.Z; }
            }
            if (r.Empty) { SetState(T("Sélectionne un objet dans CodeWalker, ou tape un nom / une position.", "Select an object in CodeWalker, or type a name / a position."), Theme.Wait); return; }
            autoKey = r.Key;
            Send(r);
        }

        void Send(CwSelection r)
        {
            if (edit != null) edit(r);
            SetState(string.Format(T("Ouverture de « {0} » dans MLO Creator…", "Opening \"{0}\" in MLO Creator…"), !string.IsNullOrEmpty(r.Name) ? r.Name : r.PosText), Theme.Ok);
        }
    }
}
