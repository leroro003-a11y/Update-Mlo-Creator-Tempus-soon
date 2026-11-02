// MLO Studio: one window for MLO Creator, CodeWalker and any other program, as tabs or side by side.
// Command line: --no-mlo (do not open MLO Creator inside), --codewalker (open CodeWalker's world view at start).
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;

namespace MloStudio
{
    static class Program
    {
        public static string AppDir;

        [STAThread]
        static void Main(string[] args)
        {
            AppDir = Path.GetDirectoryName(Application.ExecutablePath);
            bool created;
            using (var mutex = new Mutex(true, "MloStudio.SingleInstance", out created))
            {
                if (!created) { BringOther(); return; }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.ThreadException += (s, e) => Log.Error(e.Exception);
                AppDomain.CurrentDomain.UnhandledException += (s, e) => Log.Error(e.ExceptionObject as Exception);
                Log.Info("start " + string.Join(" ", args));
                Application.Run(new StudioForm(args));
                GC.KeepAlive(mutex);
            }
        }

        static void BringOther()
        {
            var me = Process.GetCurrentProcess();
            foreach (var p in Process.GetProcessesByName(me.ProcessName))
            {
                try
                {
                    if (p.Id != me.Id && p.MainWindowHandle != IntPtr.Zero)
                    {
                        if (Win.IsIconic(p.MainWindowHandle)) Win.ShowWindow(p.MainWindowHandle, Win.SW_RESTORE);
                        Win.SetForegroundWindow(p.MainWindowHandle);
                    }
                }
                catch { }
            }
        }
    }
}
