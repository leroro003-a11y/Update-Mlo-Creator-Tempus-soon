// MLO Studio: a tiny HTTP server on 127.0.0.1 so the "Applications" button of MLO Creator's editor can drive MLO Studio.
// Only requests with the token written into ui/js/studio-config.js are answered, and only from a page on this computer.
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace MloStudio
{
    class Bridge
    {
        TcpListener listener;
        Thread thread;
        volatile bool running;
        public int Port;
        public readonly string Token;
        readonly Func<string, Dictionary<string, string>, string> handler;

        public Bridge(Func<string, Dictionary<string, string>, string> handler)
        {
            this.handler = handler;
            var b = new byte[18];
            using (var rng = new System.Security.Cryptography.RNGCryptoServiceProvider()) rng.GetBytes(b);
            Token = Convert.ToBase64String(b).Replace('+', '-').Replace('/', '_').TrimEnd('=');
        }

        public bool Start()
        {
            for (int p = 17345; p < 17365 && listener == null; p++)
            {
                try
                {
                    var l = new TcpListener(IPAddress.Loopback, p);
                    l.Start();
                    listener = l;
                    Port = p;
                }
                catch (SocketException) { }
            }
            if (listener == null) return false;
            running = true;
            thread = new Thread(Loop);
            thread.IsBackground = true;
            thread.Name = "studio-bridge";
            thread.Start();
            Log.Info("bridge on 127.0.0.1:" + Port);
            return true;
        }

        public void Stop()
        {
            running = false;
            try { if (listener != null) listener.Stop(); } catch { }
        }

        void Loop()
        {
            while (running)
            {
                TcpClient c;
                try { c = listener.AcceptTcpClient(); }
                catch { if (!running) return; Thread.Sleep(50); continue; }
                ThreadPool.QueueUserWorkItem(Serve, c);
            }
        }

        void Serve(object o)
        {
            var c = (TcpClient)o;
            try
            {
                c.ReceiveTimeout = 4000;
                c.SendTimeout = 4000;
                var s = c.GetStream();
                var buf = new byte[8192];
                var sb = new StringBuilder();
                int total = 0;
                while (true)
                {
                    int n = s.Read(buf, 0, buf.Length);
                    if (n <= 0) break;
                    total += n;
                    sb.Append(Encoding.ASCII.GetString(buf, 0, n));
                    if (sb.ToString().Contains("\r\n\r\n") || total > 32768) break;
                }
                string req = sb.ToString();
                int end = req.IndexOf("\r\n\r\n", StringComparison.Ordinal);
                if (end < 0) return;
                string[] lines = req.Substring(0, end).Split(new[] { "\r\n" }, StringSplitOptions.None);
                string[] first = lines[0].Split(' ');
                if (first.Length < 2) return;
                string method = first[0].ToUpperInvariant(), target = first[1];
                string origin = null;
                for (int i = 1; i < lines.Length; i++)
                {
                    int k = lines[i].IndexOf(':');
                    if (k > 0 && lines[i].Substring(0, k).Trim().Equals("Origin", StringComparison.OrdinalIgnoreCase)) origin = lines[i].Substring(k + 1).Trim();
                }
                if (origin != null && !IsLocalOrigin(origin)) { Write(s, 403, "{\"error\":\"origin\"}", null); return; }
                if (method == "OPTIONS") { Write(s, 204, "", origin); return; }
                if (method != "GET") { Write(s, 405, "{\"error\":\"method\"}", origin); return; }
                string path = target, query = "";
                int q = target.IndexOf('?');
                if (q >= 0) { path = target.Substring(0, q); query = target.Substring(q + 1); }
                var args = ParseQuery(query);
                string tok;
                if (!args.TryGetValue("token", out tok) || !SafeEquals(tok, Token)) { Write(s, 403, "{\"error\":\"token\"}", origin); return; }
                string route = path.Trim('/');
                if (route == "outdir/list") { c.SendTimeout = 30000; Write(s, 200, OutDirList(), origin); return; }
                if (route == "outdir/file")
                {
                    c.SendTimeout = 60000;
                    string rel;
                    args.TryGetValue("path", out rel);
                    SendFile(s, rel, origin);
                    return;
                }
                string body = handler(path.Trim('/'), args);
                Write(s, 200, body ?? "{}", origin);
            }
            catch (IOException) { }
            catch (Exception e) { Log.Error(e); }
            finally { try { c.Close(); } catch { } }
        }

        // ---------- the "output" folder of MLO Creator, for "Share your project" ----------
        // outdir/list : every folder of the output directory (one exported resource each) with its files (path, size, date)
        // outdir/file : the bytes of one file, only from inside the output directory
        const int MaxFilesPerFolder = 20000;

        public static string OutDir()
        {
            string dir = null;
            try
            {
                string f = Path.Combine(Program.AppDir, "settings.json");
                if (File.Exists(f))
                {
                    var d = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(f));
                    object v;
                    if (d != null && d.TryGetValue("outDir", out v) && v is string && ((string)v).Trim().Length > 0) dir = ((string)v).Trim();
                }
            }
            catch (Exception e) { Log.Error(e); }
            if (string.IsNullOrEmpty(dir)) dir = Path.Combine(Program.AppDir, "output");
            try { dir = Path.GetFullPath(dir); } catch { }
            return dir;
        }

        static long ToMs(DateTime utc)
        {
            return (long)(utc - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }

        static string OutDirList()
        {
            string root = OutDir();
            var folders = new List<object>();
            bool exists = Directory.Exists(root);
            if (exists)
            {
                string[] dirs = new string[0];
                try { dirs = Directory.GetDirectories(root); } catch (Exception e) { Log.Error(e); }
                foreach (var d in dirs)
                {
                    var di = new DirectoryInfo(d);
                    if ((di.Attributes & FileAttributes.Hidden) != 0 || di.Name.StartsWith(".")) continue;
                    var files = new List<object>();
                    long bytes = 0;
                    DateTime newest = di.LastWriteTimeUtc;
                    bool truncated = false;
                    var pending = new Stack<DirectoryInfo>();
                    pending.Push(di);
                    while (pending.Count > 0 && !truncated)
                    {
                        var folder = pending.Pop();
                        try
                        {
                            foreach (var child in folder.GetDirectories())
                            {
                                if ((child.Attributes & FileAttributes.ReparsePoint) != 0) { truncated = true; continue; }
                                if ((child.Attributes & FileAttributes.Hidden) == 0 && !child.Name.StartsWith(".")) pending.Push(child);
                            }
                            foreach (var fi in folder.GetFiles())
                            {
                                if ((fi.Attributes & FileAttributes.ReparsePoint) != 0) { truncated = true; continue; }
                                if (files.Count >= MaxFilesPerFolder) { truncated = true; break; }
                                string rel = fi.FullName.Substring(di.FullName.Length).TrimStart('\\', '/').Replace('\\', '/');
                                var item = new Dictionary<string, object>();
                                item["path"] = rel;
                                item["size"] = fi.Length;
                                item["mtime"] = ToMs(fi.LastWriteTimeUtc);
                                files.Add(item);
                                bytes += fi.Length;
                                if (fi.LastWriteTimeUtc > newest) newest = fi.LastWriteTimeUtc;
                            }
                        }
                        catch (Exception e) { Log.Error(e); truncated = true; }
                    }
                    var one = new Dictionary<string, object>();
                    one["name"] = di.Name;
                    one["files"] = files;
                    one["bytes"] = bytes;
                    one["modified"] = ToMs(newest);
                    one["truncated"] = truncated;
                    folders.Add(one);
                }
            }
            var res = new Dictionary<string, object>();
            res["ok"] = true;
            res["dir"] = root;
            res["exists"] = exists;
            res["folders"] = folders;
            var ser = new JavaScriptSerializer();
            ser.MaxJsonLength = int.MaxValue;
            return ser.Serialize(res);
        }

        static void SendFile(Stream s, string rel, string origin)
        {
            string root = OutDir();
            string full = null;
            try
            {
                if (!string.IsNullOrEmpty(rel) && rel.IndexOf(':') < 0 && !rel.StartsWith("/") && !rel.StartsWith("\\"))
                    full = Path.GetFullPath(Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar)));
            }
            catch { full = null; }
            string prefix = root.TrimEnd('\\', '/') + Path.DirectorySeparatorChar;
            if (full == null || !full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || HasReparsePoint(root, full) || !File.Exists(full))
            {
                Write(s, 404, "{\"error\":\"file\"}", origin);
                return;
            }
            using (var fs = new FileStream(full, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                var h = new StringBuilder();
                h.Append("HTTP/1.1 200 OK\r\n");
                h.Append("Content-Type: application/octet-stream\r\n");
                h.Append("Content-Length: ").Append(fs.Length).Append("\r\n");
                h.Append("Cache-Control: no-store\r\n");
                h.Append("Connection: close\r\n");
                h.Append("Access-Control-Allow-Origin: ").Append(origin ?? "*").Append("\r\n");
                h.Append("Access-Control-Allow-Private-Network: true\r\n");
                h.Append("Vary: Origin\r\n\r\n");
                byte[] head = Encoding.ASCII.GetBytes(h.ToString());
                s.Write(head, 0, head.Length);
                fs.CopyTo(s, 81920);
                s.Flush();
            }
        }

        static bool HasReparsePoint(string root, string full)
        {
            try
            {
                var rootInfo = new DirectoryInfo(root);
                if ((rootInfo.Attributes & FileAttributes.ReparsePoint) != 0) return true;
                string rel = full.Substring(root.TrimEnd('\\', '/').Length).TrimStart('\\', '/');
                string cur = root.TrimEnd('\\', '/');
                var parts = rel.Split(new[] { '\\', '/' }, StringSplitOptions.RemoveEmptyEntries);
                for (int i = 0; i < parts.Length; i++)
                {
                    cur = Path.Combine(cur, parts[i]);
                    var attrs = File.GetAttributes(cur);
                    if ((attrs & FileAttributes.ReparsePoint) != 0) return true;
                }
                return false;
            }
            catch { return true; }
        }

        static bool IsLocalOrigin(string origin)
        {
            Uri u;
            if (!Uri.TryCreate(origin, UriKind.Absolute, out u)) return false;
            string h = u.Host.ToLowerInvariant();
            return h == "127.0.0.1" || h == "localhost" || h == "[::1]" || h == "::1";
        }

        static void Write(Stream s, int code, string body, string origin)
        {
            string reason = code == 200 ? "OK" : code == 204 ? "No Content" : code == 403 ? "Forbidden" : code == 404 ? "Not Found" : code == 405 ? "Method Not Allowed" : "Error";
            byte[] data = code == 204 ? new byte[0] : Encoding.UTF8.GetBytes(body ?? "");
            var h = new StringBuilder();
            h.Append("HTTP/1.1 ").Append(code).Append(' ').Append(reason).Append("\r\n");
            h.Append("Content-Type: application/json; charset=utf-8\r\n");
            h.Append("Content-Length: ").Append(data.Length).Append("\r\n");
            h.Append("Cache-Control: no-store\r\n");
            h.Append("Connection: close\r\n");
            h.Append("Access-Control-Allow-Origin: ").Append(origin ?? "*").Append("\r\n");
            h.Append("Access-Control-Allow-Methods: GET, OPTIONS\r\n");
            h.Append("Access-Control-Allow-Headers: Content-Type\r\n");
            h.Append("Access-Control-Allow-Private-Network: true\r\n");
            h.Append("Vary: Origin\r\n\r\n");
            byte[] head = Encoding.ASCII.GetBytes(h.ToString());
            s.Write(head, 0, head.Length);
            if (data.Length > 0) s.Write(data, 0, data.Length);
            s.Flush();
        }

        static Dictionary<string, string> ParseQuery(string q)
        {
            var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var part in q.Split('&'))
            {
                if (part.Length == 0) continue;
                int e = part.IndexOf('=');
                string k = e < 0 ? part : part.Substring(0, e);
                string v = e < 0 ? "" : part.Substring(e + 1);
                try { d[Uri.UnescapeDataString(k.Replace('+', ' '))] = Uri.UnescapeDataString(v.Replace('+', ' ')); } catch { }
            }
            return d;
        }

        static bool SafeEquals(string a, string b)
        {
            if (a == null || b == null || a.Length != b.Length) return false;
            int diff = 0;
            for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
            return diff == 0;
        }
    }
}
