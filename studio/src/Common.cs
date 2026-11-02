// MLO Studio: settings, log, language and the look shared by every window of the program.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace MloStudio
{
    // one program shown in a tab (kept in studio.json)
    public class AppEntry
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Path { get; set; }
        public string Args { get; set; }
        public string Kind { get; set; }     // "mlo", "codewalker" or "app"
        public bool Open { get; set; }       // it was running when MLO Studio closed: start it again next time
    }

    public class StudioSettings
    {
        public List<AppEntry> Apps { get; set; }
        public string CodeWalkerPath { get; set; }
        public bool Split { get; set; }
        public int SplitPercent { get; set; }
        public string Lang { get; set; }
        public string MloArgs { get; set; }
        public bool? EmbedMlo { get; set; }
        public int[] Bounds { get; set; }
        public bool Maximized { get; set; }
        public string ActiveId { get; set; }

        static string FilePath { get { return System.IO.Path.Combine(Program.AppDir, "studio.json"); } }

        public static StudioSettings Load()
        {
            try
            {
                if (File.Exists(FilePath))
                {
                    var s = new JavaScriptSerializer().Deserialize<StudioSettings>(File.ReadAllText(FilePath));
                    if (s != null) return s.Fix();
                }
            }
            catch (Exception e) { Log.Error(e); }
            return new StudioSettings().Fix();
        }

        StudioSettings Fix()
        {
            if (Apps == null) Apps = new List<AppEntry>();
            Apps.RemoveAll(a => a == null || string.IsNullOrEmpty(a.Id));
            if (SplitPercent < 15 || SplitPercent > 85) SplitPercent = 55;
            if (string.IsNullOrEmpty(Lang)) Lang = "fr";
            return this;
        }

        public void Save()
        {
            string tmp = FilePath + ".tmp";
            try
            {
                File.WriteAllText(tmp, new JavaScriptSerializer().Serialize(this));
                if (File.Exists(FilePath)) File.Replace(tmp, FilePath, FilePath + ".bak", true);
                else File.Move(tmp, FilePath);
                string backup = FilePath + ".bak"; if (File.Exists(backup)) File.Delete(backup);
            }
            catch (Exception e) { Log.Error(e); try { if (File.Exists(tmp)) File.Delete(tmp); } catch { } }
        }
    }

    // the language of MLO Studio: French and English are in the code, the others in LangData (Lang.cs); it follows MLO Creator's editor
    static class L
    {
        static string code = "fr";
        static Dictionary<string, string> table;
        public static bool Fr { get { return code == "fr"; } }
        public static string Code
        {
            get { return code; }
            set
            {
                code = string.IsNullOrEmpty(value) ? "fr" : value;
                Dictionary<string, string> t;
                table = LangData.Tables.TryGetValue(code, out t) ? t : null;
            }
        }
        public static string T(string fr, string en)
        {
            if (code == "fr") return fr;
            string v;
            if (table != null && en != null && table.TryGetValue(en, out v)) return v;
            return en;
        }
    }

    static class Log
    {
        static readonly object gate = new object();
        public static void Info(string m) { Write("info ", m); }
        public static void Error(Exception e) { if (e != null) Write("error", e.ToString()); }
        static void Write(string kind, string m)
        {
            try
            {
                lock (gate)
                {
                    string dir = Path.Combine(Program.AppDir ?? ".", "logs");
                    Directory.CreateDirectory(dir);
                    File.AppendAllText(Path.Combine(dir, "studio.log"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + kind + "  " + m + Environment.NewLine);
                }
            }
            catch { }
        }
    }

    // the colours of MLO Creator's editor (ui/app.css), so the two read as one program
    static class Theme
    {
        public static readonly Color Bg = Color.FromArgb(7, 8, 14), Bar = Color.FromArgb(13, 15, 25), Panel = Color.FromArgb(19, 21, 34),
            Line = Color.FromArgb(40, 43, 64), Text = Color.FromArgb(238, 240, 248), Muted = Color.FromArgb(155, 161, 187), Dim = Color.FromArgb(100, 107, 136),
            Accent = Color.FromArgb(143, 125, 255), Accent2 = Color.FromArgb(108, 92, 245), Hover = Color.FromArgb(30, 33, 52),
            Ok = Color.FromArgb(52, 211, 153), Wait = Color.FromArgb(251, 191, 36), Cyan = Color.FromArgb(63, 212, 242), Red = Color.FromArgb(255, 107, 139);

        public static float Scale = 1f;
        public static int S(int px) { return (int)Math.Round(px * Scale); }
        public static Font UI(float size) { return new Font("Segoe UI", size, FontStyle.Regular); }
        public static Font UI(float size, FontStyle st) { return new Font("Segoe UI", size, st); }

        public static GraphicsPath Round(RectangleF r, float rad)
        {
            var p = new GraphicsPath();
            float d = rad * 2;
            if (d > r.Height) d = r.Height;
            if (d > r.Width) d = r.Width;
            if (d < 1) { p.AddRectangle(r); return p; }
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        public static Button Btn(string text, bool primary, EventHandler click)
        {
            var b = new Button();
            b.Text = text;
            b.FlatStyle = FlatStyle.Flat;
            b.UseVisualStyleBackColor = false;
            b.BackColor = primary ? Accent2 : Hover;
            b.ForeColor = Color.White;
            b.FlatAppearance.BorderColor = primary ? Accent : Line;
            b.FlatAppearance.BorderSize = 1;
            b.FlatAppearance.MouseOverBackColor = primary ? Accent : Color.FromArgb(44, 48, 74);
            b.FlatAppearance.MouseDownBackColor = primary ? Accent2 : Color.FromArgb(24, 27, 44);
            b.Font = UI(9f, primary ? FontStyle.Bold : FontStyle.Regular);
            b.AutoSize = true;
            b.AutoSizeMode = AutoSizeMode.GrowAndShrink;
            b.Padding = new Padding(S(8), S(2), S(8), S(2));
            b.Margin = new Padding(S(6), S(8), 0, S(6));
            b.Cursor = Cursors.Hand;
            if (click != null) b.Click += click;
            return b;
        }
    }

    // a centred message with buttons: shown in a tab while its program starts, after it closed, and when there is nothing to show
    class InfoCard : Panel
    {
        public readonly Label Title, Body;
        public readonly FlowLayoutPanel Buttons;
        readonly FlowLayoutPanel stack;

        public InfoCard()
        {
            Dock = DockStyle.Fill;
            BackColor = Theme.Bg;
            DoubleBuffered = true;
            stack = new FlowLayoutPanel();
            stack.FlowDirection = FlowDirection.TopDown;
            stack.WrapContents = false;
            stack.AutoSize = true;
            stack.AutoSizeMode = AutoSizeMode.GrowAndShrink;
            stack.BackColor = Theme.Bg;
            Title = new Label();
            Title.AutoSize = true;
            Title.Font = Theme.UI(15f, FontStyle.Bold);
            Title.ForeColor = Theme.Text;
            Title.MaximumSize = new Size(Theme.S(560), 0);
            Title.Margin = new Padding(0, 0, 0, Theme.S(6));
            Body = new Label();
            Body.AutoSize = true;
            Body.Font = Theme.UI(10f);
            Body.ForeColor = Theme.Muted;
            Body.MaximumSize = new Size(Theme.S(560), 0);
            Body.Margin = new Padding(0, 0, 0, Theme.S(14));
            Buttons = new FlowLayoutPanel();
            Buttons.AutoSize = true;
            Buttons.AutoSizeMode = AutoSizeMode.GrowAndShrink;
            Buttons.WrapContents = false;
            Buttons.BackColor = Theme.Bg;
            Buttons.Margin = Padding.Empty;
            stack.Controls.Add(Title);
            stack.Controls.Add(Body);
            stack.Controls.Add(Buttons);
            Controls.Add(stack);
            stack.SizeChanged += (s, e) => Center();
        }

        protected override void OnResize(EventArgs e) { base.OnResize(e); Center(); }

        void Center()
        {
            stack.Location = new Point(Math.Max(Theme.S(16), (ClientSize.Width - stack.Width) / 2),
                Math.Max(Theme.S(16), (ClientSize.Height - stack.Height) / 2 - Theme.S(20)));
        }

        public void Set(string title, string body, params Button[] buttons)
        {
            Title.Text = title ?? "";
            Body.Text = body ?? "";
            Body.Visible = !string.IsNullOrEmpty(body);
            var old = new List<Control>();
            foreach (Control c in Buttons.Controls) old.Add(c);
            foreach (var c in old) c.Dispose();
            foreach (var b in buttons)
            {
                if (b == null) continue;
                b.Margin = new Padding(0, 0, Theme.S(8), 0);
                Buttons.Controls.Add(b);
            }
            Center();
        }
    }

    static class Prompt
    {
        public static string Ask(IWin32Window owner, string title, string label, string value)
        {
            using (var f = new Form())
            {
                f.Text = title;
                f.FormBorderStyle = FormBorderStyle.FixedDialog;
                f.MinimizeBox = false;
                f.MaximizeBox = false;
                f.ShowInTaskbar = false;
                f.StartPosition = FormStartPosition.CenterParent;
                f.ClientSize = new Size(Theme.S(440), Theme.S(132));
                f.BackColor = Theme.Panel;
                f.ForeColor = Theme.Text;
                f.Font = Theme.UI(9.5f);
                var l = new Label();
                l.Text = label;
                l.AutoSize = true;
                l.Location = new Point(Theme.S(14), Theme.S(14));
                var tb = new TextBox();
                tb.Text = value ?? "";
                tb.Location = new Point(Theme.S(14), Theme.S(40));
                tb.Width = Theme.S(412);
                tb.BackColor = Theme.Bg;
                tb.ForeColor = Theme.Text;
                tb.BorderStyle = BorderStyle.FixedSingle;
                var ok = Theme.Btn("OK", true, null);
                ok.DialogResult = DialogResult.OK;
                var cancel = Theme.Btn(L.T("Annuler", "Cancel"), false, null);
                cancel.DialogResult = DialogResult.Cancel;
                var row = new FlowLayoutPanel();
                row.FlowDirection = FlowDirection.RightToLeft;
                row.Dock = DockStyle.Bottom;
                row.Height = Theme.S(48);
                row.Padding = new Padding(0, 0, Theme.S(8), 0);
                row.BackColor = Theme.Panel;
                row.Controls.Add(ok);
                row.Controls.Add(cancel);
                f.Controls.Add(l);
                f.Controls.Add(tb);
                f.Controls.Add(row);
                f.AcceptButton = ok;
                f.CancelButton = cancel;
                return f.ShowDialog(owner) == DialogResult.OK ? tb.Text : null;
            }
        }
    }
}
