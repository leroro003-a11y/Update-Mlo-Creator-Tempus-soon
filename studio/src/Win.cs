// MLO Studio: the Win32 calls used to put another program's window inside ours.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace MloStudio
{
    static class Win
    {
        public const int GWL_STYLE = -16, GWL_EXSTYLE = -20;
        public const long WS_CHILD = 0x40000000L, WS_POPUP = 0x80000000L, WS_CAPTION = 0x00C00000L, WS_THICKFRAME = 0x00040000L,
            WS_SYSMENU = 0x00080000L, WS_MINIMIZEBOX = 0x00020000L, WS_MAXIMIZEBOX = 0x00010000L, WS_VISIBLE = 0x10000000L;
        public const long WS_EX_APPWINDOW = 0x00040000L, WS_EX_WINDOWEDGE = 0x00000100L, WS_EX_CLIENTEDGE = 0x00000200L,
            WS_EX_DLGMODALFRAME = 0x00000001L, WS_EX_TOOLWINDOW = 0x00000080L, WS_EX_STATICEDGE = 0x00020000L;
        public const uint SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOZORDER = 0x0004, SWP_NOACTIVATE = 0x0010,
            SWP_FRAMECHANGED = 0x0020, SWP_SHOWWINDOW = 0x0040, SWP_ASYNCWINDOWPOS = 0x4000;
        public const int SW_HIDE = 0, SW_SHOWNORMAL = 1, SW_SHOW = 5, SW_RESTORE = 9;
        public const uint WM_CLOSE = 0x0010;
        public const uint GW_OWNER = 4;

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT
        {
            public int Left, Top, Right, Bottom;
            public int Width { get { return Right - Left; } }
            public int Height { get { return Bottom - Top; } }
        }

        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
        [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
        [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool repaint);
        [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextLength(IntPtr h);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
        [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr h);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
        [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr64(IntPtr h, int i);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr64(IntPtr h, int i, IntPtr v);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong32(IntPtr h, int i);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongW")] static extern int SetWindowLong32(IntPtr h, int i, int v);

        // window styles are 32-bit values; keep them as positive longs so the masks below stay simple
        public static long GetLong(IntPtr h, int i)
        {
            if (IntPtr.Size == 8) return GetWindowLongPtr64(h, i).ToInt64() & 0xFFFFFFFFL;
            return ((long)GetWindowLong32(h, i)) & 0xFFFFFFFFL;
        }

        public static void SetLong(IntPtr h, int i, long v)
        {
            int iv = unchecked((int)(uint)(v & 0xFFFFFFFFL));
            if (IntPtr.Size == 8) SetWindowLongPtr64(h, i, new IntPtr(iv)); else SetWindowLong32(h, i, iv);
        }

        public static string TextOf(IntPtr h)
        {
            int n = GetWindowTextLength(h);
            if (n <= 0) return "";
            var sb = new StringBuilder(n + 2);
            GetWindowText(h, sb, sb.Capacity);
            return sb.ToString();
        }

        public static string ClassOf(IntPtr h)
        {
            var sb = new StringBuilder(256);
            GetClassName(h, sb, sb.Capacity);
            return sb.ToString();
        }

        public static int PidOf(IntPtr h)
        {
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            return (int)pid;
        }

        public class WinInfo
        {
            public IntPtr Handle;
            public string Title;
            public string Class;
            public int Pid;
            public RECT Rect;
            public bool Visible;
            public bool Owned;
            public long ExStyle;
        }

        // every top-level window of the desktop
        public static List<WinInfo> TopWindows()
        {
            var list = new List<WinInfo>();
            EnumWindowsProc cb = delegate(IntPtr h, IntPtr l)
            {
                var w = new WinInfo();
                w.Handle = h;
                w.Title = TextOf(h);
                w.Class = ClassOf(h);
                w.Pid = PidOf(h);
                GetWindowRect(h, out w.Rect);
                w.Visible = IsWindowVisible(h);
                w.Owned = GetWindow(h, GW_OWNER) != IntPtr.Zero;
                w.ExStyle = GetLong(h, GWL_EXSTYLE);
                list.Add(w);
                return true;
            };
            EnumWindows(cb, IntPtr.Zero);
            GC.KeepAlive(cb);
            return list;
        }

        // keyboard focus into a window of another program (its thread has its own input queue)
        public static void FocusCross(IntPtr h)
        {
            if (h == IntPtr.Zero || !IsWindow(h)) return;
            uint pid;
            uint tid = GetWindowThreadProcessId(h, out pid);
            uint me = GetCurrentThreadId();
            if (tid == 0) return;
            if (tid == me) { SetFocus(h); return; }
            if (AttachThreadInput(me, tid, true))
            {
                try { SetFocus(h); }
                finally { AttachThreadInput(me, tid, false); }
            }
        }
    }
}
