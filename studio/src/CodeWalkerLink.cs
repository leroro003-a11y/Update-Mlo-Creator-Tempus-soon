// MLO Studio, "Modification live": reads what is selected in CodeWalker's World View, without changing CodeWalker.
// CodeWalker is a WinForms program: each of its controls answers the registered message WM_GETCONTROLNAME with its name
// (written into a buffer that has to live in CodeWalker's own memory), so the selection box ("SelectionNameTextBox") and the
// camera position box ("CameraPositionTextBox") are found by name, then their text is read with WM_GETTEXT.
// The named text boxes found the first time are written into logs\studio.log, to adapt the names to another CodeWalker version.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

namespace MloStudio
{
    // what CodeWalker shows as selected, and where its camera is
    class CwSelection
    {
        public string Raw = "";      // the text of CodeWalker's selection box
        public string Name = "";     // the model / interior name taken from it (lower case)
        public bool HasPos;          // a position was found (CodeWalker's camera, or three numbers on the clipboard)
        public double X, Y, Z;
        public string Source = "";   // "codewalker", "clipboard" or "manual"

        public bool Empty { get { return string.IsNullOrEmpty(Name) && !HasPos; } }

        public string PosText
        {
            get
            {
                if (!HasPos) return "";
                var ci = CultureInfo.InvariantCulture;
                return X.ToString("0.0", ci) + ", " + Y.ToString("0.0", ci) + ", " + Z.ToString("0.0", ci);
            }
        }

        // the same selection: the editor is not asked again while it stays the same
        public string Key { get { return (Name ?? "") + "|" + (Raw ?? ""); } }
    }

    static class CodeWalkerLink
    {
        const uint WM_GETTEXT = 0x000D, WM_GETTEXTLENGTH = 0x000E;
        const uint SMTO_ABORTIFHUNG = 0x0002, SMTO_BLOCK = 0x0001;
        const uint PROCESS_VM_OPERATION = 0x0008, PROCESS_VM_READ = 0x0010, PROCESS_VM_WRITE = 0x0020, PROCESS_QUERY_INFORMATION = 0x0400;
        const uint MEM_COMMIT = 0x1000, MEM_RESERVE = 0x2000, MEM_RELEASE = 0x8000, PAGE_READWRITE = 0x04;
        const int NameChars = 256;

        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RegisterWindowMessage(string name);
        [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, Win.EnumWindowsProc cb, IntPtr l);
        [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW")]
        static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
        [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode)]
        static extern IntPtr SendMessageTimeoutText(IntPtr h, uint msg, IntPtr w, StringBuilder l, uint flags, uint timeout, out IntPtr result);
        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr VirtualAllocEx(IntPtr proc, IntPtr addr, UIntPtr size, uint type, uint protect);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool VirtualFreeEx(IntPtr proc, IntPtr addr, UIntPtr size, uint type);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool ReadProcessMemory(IntPtr proc, IntPtr addr, byte[] buf, UIntPtr size, out IntPtr read);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool WriteProcessMemory(IntPtr proc, IntPtr addr, byte[] buf, UIntPtr size, out IntPtr written);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

        static readonly uint WM_GETCONTROLNAME = RegisterWindowMessage("WM_GETCONTROLNAME");
        static readonly object gate = new object();
        static readonly Dictionary<IntPtr, string> names = new Dictionary<IntPtr, string>();   // a control's name never changes
        static IntPtr namesRoot = IntPtr.Zero;
        static bool logged;

        // the names CodeWalker gives its boxes (WorldForm.Designer.cs); the first one found wins
        static readonly string[] SelectionNames = { "SelectionNameTextBox" };
        static readonly string[] CameraNames = { "CameraPositionTextBox" };

        public static string LastProblem = "";

        // the selection of the CodeWalker window root (its World View); null when nothing can be read
        public static CwSelection Read(IntPtr root)
        {
            lock (gate)
            {
                LastProblem = "";
                if (root == IntPtr.Zero || !Win.IsWindow(root)) { LastProblem = "nowindow"; return null; }
                if (root != namesRoot) { names.Clear(); namesRoot = root; logged = false; }
                int pid = Win.PidOf(root);
                var edits = new List<IntPtr>();
                Win.EnumWindowsProc cb = delegate(IntPtr h, IntPtr l)
                {
                    string cls = Win.ClassOf(h);
                    if (cls.IndexOf("EDIT", StringComparison.OrdinalIgnoreCase) >= 0) edits.Add(h);
                    return true;
                };
                EnumChildWindows(root, cb, IntPtr.Zero);
                GC.KeepAlive(cb);
                if (edits.Count == 0) { LastProblem = "noedits"; return null; }

                var todo = edits.Where(h => !names.ContainsKey(h)).ToList();
                if (todo.Count > 0) ReadNames(todo, pid);

                IntPtr sel = Find(edits, SelectionNames), cam = Find(edits, CameraNames);
                if (!logged)
                {
                    logged = true;
                    var found = edits.Select(h => names.ContainsKey(h) ? names[h] : null).Where(n => !string.IsNullOrEmpty(n)).Distinct().ToList();
                    Log.Info("live: CodeWalker text boxes: " + (found.Count > 0 ? string.Join(", ", found) : "(no names: run MLO Studio with the same rights as CodeWalker)"));
                }
                if (sel == IntPtr.Zero && cam == IntPtr.Zero) { if (LastProblem != "rights") LastProblem = "noselectionbox"; return null; }

                var r = new CwSelection();
                r.Source = "codewalker";
                if (sel != IntPtr.Zero)
                {
                    r.Raw = (RemoteText(sel) ?? "").Trim();
                    r.Name = NameFrom(r.Raw);
                }
                if (cam != IntPtr.Zero)
                {
                    double x, y, z;
                    if (ParsePos(RemoteText(cam), out x, out y, out z)) { r.HasPos = true; r.X = x; r.Y = y; r.Z = z; }
                }
                return r;
            }
        }

        static IntPtr Find(List<IntPtr> edits, string[] wanted)
        {
            foreach (var w in wanted)
                foreach (var h in edits)
                {
                    string n;
                    if (names.TryGetValue(h, out n) && n != null && n.Equals(w, StringComparison.OrdinalIgnoreCase)) return h;
                }
            return IntPtr.Zero;
        }

        // asks every control for its WinForms name; the name is written by CodeWalker into a buffer allocated in its process
        static void ReadNames(List<IntPtr> hs, int pid)
        {
            IntPtr proc = OpenProcess(PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_QUERY_INFORMATION, false, pid);
            if (proc == IntPtr.Zero) { LastProblem = "rights"; return; }
            try
            {
                int bytes = (NameChars + 1) * 2;
                IntPtr mem = VirtualAllocEx(proc, IntPtr.Zero, (UIntPtr)(uint)bytes, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
                if (mem == IntPtr.Zero) { LastProblem = "rights"; return; }
                try
                {
                    var zero = new byte[bytes];
                    var buf = new byte[bytes];
                    foreach (var h in hs)
                    {
                        IntPtr wr, rd, res;
                        WriteProcessMemory(proc, mem, zero, (UIntPtr)(uint)bytes, out wr);
                        IntPtr ok = SendMessageTimeout(h, WM_GETCONTROLNAME, (IntPtr)NameChars, mem, SMTO_ABORTIFHUNG | SMTO_BLOCK, 150, out res);
                        if (ok == IntPtr.Zero) continue;   // busy (CodeWalker loading): asked again next time
                        string n = "";
                        if (ReadProcessMemory(proc, mem, buf, (UIntPtr)(uint)bytes, out rd))
                        {
                            n = Encoding.Unicode.GetString(buf);
                            int z = n.IndexOf('\0');
                            if (z >= 0) n = n.Substring(0, z);
                        }
                        names[h] = n.Trim();
                    }
                }
                finally { VirtualFreeEx(proc, mem, UIntPtr.Zero, MEM_RELEASE); }
            }
            finally { CloseHandle(proc); }
        }

        // the text of a box of another program (GetWindowText does not read those)
        static string RemoteText(IntPtr h)
        {
            IntPtr len;
            if (SendMessageTimeout(h, WM_GETTEXTLENGTH, IntPtr.Zero, IntPtr.Zero, SMTO_ABORTIFHUNG | SMTO_BLOCK, 150, out len) == IntPtr.Zero) return null;
            int n = (int)len.ToInt64();
            if (n <= 0) return "";
            if (n > 4096) n = 4096;
            var sb = new StringBuilder(n + 2);
            IntPtr got;
            if (SendMessageTimeoutText(h, WM_GETTEXT, (IntPtr)(n + 1), sb, SMTO_ABORTIFHUNG | SMTO_BLOCK, 150, out got) == IntPtr.Zero) return null;
            return sb.ToString();
        }

        static readonly Regex Word = new Regex(@"[A-Za-z0-9_@\-\.]{3,}");
        static readonly Regex Number = new Regex(@"^-?\d+(\.\d+)?$");
        static readonly HashSet<string> Skip = new HashSet<string>(new[] {
            "entity", "archetype", "mlo", "room", "interior", "ymap", "ytyp", "drawable", "fragment", "none", "selection", "selected", "instance", "entityset", "car", "generator" });
        static readonly string[] Exts = { ".ydr", ".yft", ".ydd", ".ybn", ".ymap", ".ytyp", ".ytd" };

        // "v_ilev_ph_door01", "Entity: v_policehub", "sc1_31_res02 - hash..." : the first word that looks like a name of the game
        public static string NameFrom(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return "";
            foreach (Match m in Word.Matches(raw))
            {
                string w = m.Value.Trim('.', '-').ToLowerInvariant();
                foreach (var e in Exts) if (w.EndsWith(e)) w = w.Substring(0, w.Length - e.Length);
                if (w.Length < 3 || Skip.Contains(w) || Number.IsMatch(w)) continue;
                if (!w.Any(char.IsLetter)) continue;
                return w;
            }
            return "";
        }

        static readonly Regex Axis = new Regex(@"([XYZxyz])\s*[:=]\s*(-?\d+(?:[.,]\d+)?)");
        static readonly Regex Spaced = new Regex(@"-?\d+(?:[.,]\d+)?");

        // "441.2, -982.5, 30.7" (CodeWalker's boxes), "X:98,72334 Y:11,6177 Z:30,5" (its property grid, on a Windows in French),
        // "441,2; -982,5; 30,7" or "441 -982": dot or comma decimals
        public static bool ParsePos(string s, out double x, out double y, out double z)
        {
            x = y = z = 0;
            if (string.IsNullOrWhiteSpace(s)) return false;
            var vals = new List<string>();
            var axes = Axis.Matches(s);
            if (axes.Count >= 2)
            {
                string[] byAxis = new string[3];
                foreach (Match m in axes)
                {
                    int k = char.ToUpperInvariant(m.Groups[1].Value[0]) - 'X';
                    if (k >= 0 && k < 3 && byAxis[k] == null) byAxis[k] = m.Groups[2].Value;
                }
                if (byAxis[0] == null || byAxis[1] == null) return false;
                vals.Add(byAxis[0]); vals.Add(byAxis[1]); vals.Add(byAxis[2] ?? "0");
            }
            else
            {
                // "a, b, c" with dots, or "a; b; c" / "a b c" where a comma can be the decimal mark
                bool commaDecimals = s.IndexOf('.') < 0 && (s.IndexOf(';') >= 0 || Regex.IsMatch(s, @"\d,\d"));
                string t = commaDecimals ? s : s.Replace(",", " ");
                if (commaDecimals && s.IndexOf(';') < 0 && Regex.IsMatch(s, @"\d,\s")) t = s.Replace(", ", " ");
                foreach (Match m in Spaced.Matches(t)) vals.Add(m.Value);
                if (vals.Count < 2) return false;
            }
            var ci = CultureInfo.InvariantCulture;
            if (!double.TryParse(vals[0].Replace(',', '.'), NumberStyles.Float, ci, out x)) return false;
            if (!double.TryParse(vals[1].Replace(',', '.'), NumberStyles.Float, ci, out y)) return false;
            if (vals.Count >= 3) double.TryParse(vals[2].Replace(',', '.'), NumberStyles.Float, ci, out z);
            // a position of GTA V's map, not a hash or a date
            return Math.Abs(x) < 20000 && Math.Abs(y) < 20000 && Math.Abs(z) < 5000;
        }

        // text typed or pasted by hand: a name, "x y", "x, y, z" or vector3(x, y, z)
        public static CwSelection FromText(string text, string source)
        {
            var r = new CwSelection();
            r.Source = source;
            r.Raw = (text ?? "").Trim();
            if (r.Raw.Length > 300) r.Raw = r.Raw.Substring(0, 300);
            string t = r.Raw.Replace("vector3", " ").Replace("(", " ").Replace(")", " ");
            double x, y, z;
            bool onlyNumbers = Regex.IsMatch(t, @"^[\s\d\.,:;\-xyzXYZ=]+$");
            if (onlyNumbers && ParsePos(t, out x, out y, out z)) { r.HasPos = true; r.X = x; r.Y = y; r.Z = z; }
            else r.Name = NameFrom(r.Raw);
            return r;
        }
    }
}
