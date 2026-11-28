using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Antigravity Monitor")]
[assembly: AssemblyProduct("Antigravity Monitor")]
[assembly: AssemblyCompany("Benedictus RH (@benedictusrey)")]
[assembly: AssemblyDescription("Antigravity Monitor launcher")]
[assembly: AssemblyVersion("1.4.0.0")]
[assembly: AssemblyFileVersion("1.4.0.0")]
[assembly: AssemblyInformationalVersion("1.4.0")]

internal static class Launcher
{
#if !INSTALLER && !UNINSTALLER
    private const string DashboardUrl = "http://127.0.0.1:4599";
    private const string TrayMutexName = "Local\\AntigravityMonitorTray";
    private const string ShowFlyoutEventName = "Local\\AntigravityMonitorShowFlyout";

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();
#endif

    [STAThread]
    private static int Main(string[] arguments)
    {
#if INSTALLER
        const string command = "Install Antigravity Monitor.cmd";
#elif UNINSTALLER
        string command = Path.Combine("tools", "install-windows.ps1");
#else
        const string command = "Antigravity Monitor.cmd";
        try { SetProcessDPIAware(); } catch { }
#endif
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string target = Path.Combine(root, command);
        if (!File.Exists(target))
        {
            if (arguments.Length == 1 && arguments[0] == "--verify-launcher") return 2;
            MessageBox.Show("Keep the extracted package together. Missing: " + command,
                "Antigravity Monitor", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 2;
        }
        if (arguments.Length == 1 && arguments[0] == "--verify-launcher") return 0;
#if UNINSTALLER
        DialogResult confirm = MessageBox.Show(
            "Uninstall Antigravity Monitor?\n\n" +
            "This stops the background companion and system tray, removes sign-in startup entries, shortcuts, and editor extensions, and deletes the installed app under %LOCALAPPDATA%\\Antigravity Monitor.",
            "Antigravity Monitor Uninstaller",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question,
            MessageBoxDefaultButton.Button2);
        if (confirm != DialogResult.Yes) return 0;
        try
        {
            string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
            var start = new ProcessStartInfo
            {
                FileName = powershell,
                Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + target + "\" -Uninstall -Purge",
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            using (Process child = Process.Start(start))
            {
                if (child == null) return 1;
                string stderr = child.StandardError.ReadToEnd();
                child.WaitForExit();
                if (child.ExitCode != 0)
                {
                    MessageBox.Show(
                        string.IsNullOrWhiteSpace(stderr) ? "Uninstall failed (exit code " + child.ExitCode + ")." : stderr.Trim(),
                        "Antigravity Monitor Uninstaller",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error);
                    return child.ExitCode;
                }
            }
            MessageBox.Show("Antigravity Monitor has been uninstalled.",
                "Antigravity Monitor Uninstaller", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Antigravity Monitor Uninstaller", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
#elif !INSTALLER
        if (Array.IndexOf(arguments, "--tray") >= 0)
        {
            return RunTray(root, Array.IndexOf(arguments, "--show") >= 0);
        }
        if (Array.IndexOf(arguments, "--companion") >= 0)
        {
            // Startup, Run, and logon-task entries. Start the tray and companion without any console window.
            EnsureTray(false);
            return StartCompanion(root, Array.IndexOf(arguments, "--supervise") >= 0);
        }
        // Normal Start Menu / desktop launch: start hidden companion, then open the lightweight native flyout.
        StartCompanion(root, false);
        if (!SignalExistingTray())
        {
            EnsureTray(true);
        }
        return 0;
#else
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "cmd.exe"),
                Arguments = "/d /c \"\"" + target + "\"\"",
                WorkingDirectory = root,
                UseShellExecute = true
            });
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Antigravity Monitor", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
#endif
    }

#if !INSTALLER && !UNINSTALLER
    // Windows Terminal, the default console on Windows 11, ignores the Hidden window style and still
    // shows a window for a console app. CreateNoWindow is the only reliable way to avoid that window.
    private static int StartCompanion(string root, bool supervise)
    {
        string script = Path.Combine(root, "tools", "start-companion.ps1");
        string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
        if (!File.Exists(script) || !File.Exists(powershell)) return 2;
        var start = new ProcessStartInfo
        {
            FileName = powershell,
            Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\"" + (supervise ? " -Supervise" : ""),
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };
        using (Process child = Process.Start(start))
        {
            if (child == null) return 1;
            child.WaitForExit();
            return child.ExitCode;
        }
    }

    private static bool SignalExistingTray()
    {
        try
        {
            using (var ev = EventWaitHandle.OpenExisting(ShowFlyoutEventName))
            {
                ev.Set();
                return true;
            }
        }
        catch
        {
            return false;
        }
    }

    private static void EnsureTray(bool showFlyout)
    {
        bool created;
        using (var probe = new Mutex(false, TrayMutexName, out created))
        {
            if (!created)
            {
                if (showFlyout) SignalExistingTray();
                return;
            }
        }
        try
        {
            string exe = Assembly.GetExecutingAssembly().Location;
            Process.Start(new ProcessStartInfo
            {
                FileName = exe,
                Arguments = showFlyout ? "--tray --show" : "--tray",
                WorkingDirectory = Path.GetDirectoryName(exe) ?? AppDomain.CurrentDomain.BaseDirectory,
                UseShellExecute = false,
                CreateNoWindow = true
            });
        }
        catch { }
    }

    private static int RunTray(string root, bool showInitialFlyout)
    {
        bool created;
        using (var mutex = new Mutex(true, TrayMutexName, out created))
        {
            if (!created)
            {
                if (showInitialFlyout) SignalExistingTray();
                return 0;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            Icon icon = null;
            try { icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); } catch { }

            using (var flyout = new TrayFlyoutForm(DashboardUrl, () => OpenOrFocusAntigravity(root)))
            using (var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowFlyoutEventName))
            {
                bool stopping = false;
                var listener = new Thread(() =>
                {
                    while (!stopping)
                    {
                        if (showEvent.WaitOne(500) && !stopping && !flyout.IsDisposed)
                        {
                            try { flyout.BeginInvoke((Action)(() => flyout.ShowFlyout())); } catch { }
                        }
                    }
                }) { IsBackground = true };
                listener.Start();

                var menu = new ContextMenuStrip();
                var focusItem = new ToolStripMenuItem("Open Antigravity (Active Thread)");
                focusItem.Font = new Font(focusItem.Font, FontStyle.Bold);
                focusItem.Click += (s, e) => OpenOrFocusAntigravity(root);

                var ideItem = new ToolStripMenuItem("Open with Antigravity IDE (Active Thread)");
                ideItem.Click += (s, e) => OpenOrFocusAntigravityIde(root);

                var dashItem = new ToolStripMenuItem("Open Monitor Dashboard");
                dashItem.Click += (s, e) =>
                {
                    ThreadPool.QueueUserWorkItem(_ => StartCompanion(root, false));
                    flyout.ToggleFlyout();
                };

                var restartItem = new ToolStripMenuItem("Restart Companion");
                restartItem.Click += (s, e) =>
                {
                    ThreadPool.QueueUserWorkItem(_ => { StopCompanion(); StartCompanion(root, false); });
                };

                var bootItem = new ToolStripMenuItem("Start on Boot");
                menu.Opening += (s, e) => { bootItem.Checked = IsStartOnBootEnabled(); };
                bootItem.Click += (s, e) =>
                {
                    bool next = !IsStartOnBootEnabled();
                    SetStartOnBoot(next);
                    bootItem.Checked = IsStartOnBootEnabled();
                };

                var exitItem = new ToolStripMenuItem("Exit");
                menu.Items.Add(focusItem);
                menu.Items.Add(ideItem);
                menu.Items.Add(new ToolStripSeparator());
                menu.Items.Add(dashItem);
                menu.Items.Add(restartItem);
                menu.Items.Add(bootItem);
                menu.Items.Add(new ToolStripSeparator());
                menu.Items.Add(exitItem);

                using (var tray = new NotifyIcon())
                {
                    tray.Icon = icon ?? SystemIcons.Application;
                    tray.Text = "Antigravity Monitor";
                    tray.ContextMenuStrip = menu;
                    tray.Visible = true;
                    tray.MouseUp += (s, e) =>
                    {
                        if (e.Button == MouseButtons.Left) OpenOrFocusAntigravity(root);
                    };
                    exitItem.Click += (s, e) =>
                    {
                        stopping = true;
                        showEvent.Set();
                        tray.Visible = false;
                        flyout.HideFlyout();
                        StopCompanion();
                        Application.Exit();
                    };
                    if (showInitialFlyout)
                    {
                        flyout.ShowFlyout();
                    }
                    else
                    {
                        // Ensure handle exists so BeginInvoke works from the background signal thread.
                        IntPtr _ = flyout.Handle;
                    }
                    Application.Run();
                }
                stopping = true;
                showEvent.Set();
            }
            if (icon != null) icon.Dispose();
            GC.KeepAlive(mutex);
            return 0;
        }
    }

    private static void OpenOrFocusAntigravity(string root)
    {
        bool focused = false;
        try
        {
            foreach (Process proc in Process.GetProcessesByName("Antigravity"))
            {
                try
                {
                    if (proc.MainWindowHandle != IntPtr.Zero)
                    {
                        if (IsIconic(proc.MainWindowHandle)) ShowWindow(proc.MainWindowHandle, 9); // SW_RESTORE
                        SetForegroundWindow(proc.MainWindowHandle);
                        focused = true;
                        break;
                    }
                }
                catch { }
                finally { proc.Dispose(); }
            }
        }
        catch { }

        if (focused)
        {
            ThreadPool.QueueUserWorkItem(_ =>
            {
                StartCompanion(root, false);
                RequestOpenInAppPanel();
            });
            return;
        }

        string agExe = FindAntigravityExe();
        if (!string.IsNullOrEmpty(agExe))
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = agExe,
                    Arguments = "--remote-debugging-port=9222 --remote-debugging-address=127.0.0.1",
                    WorkingDirectory = Path.GetDirectoryName(agExe),
                    UseShellExecute = false
                });
                ThreadPool.QueueUserWorkItem(_ =>
                {
                    StartCompanion(root, false);
                    Thread.Sleep(3500);
                    RequestOpenInAppPanel();
                });
                return;
            }
            catch { }
        }
        SignalExistingTray();
    }

    private static void RequestOpenInAppPanel()
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(DashboardUrl + "/api/command");
            req.Method = "POST";
            req.ContentType = "application/json";
            req.Timeout = 1500;
            req.ReadWriteTimeout = 1500;
            byte[] body = System.Text.Encoding.UTF8.GetBytes("{\"type\":\"openInAppPanel\"}");
            req.ContentLength = body.Length;
            using (var stream = req.GetRequestStream())
            {
                stream.Write(body, 0, body.Length);
            }
            using (req.GetResponse()) { }
        }
        catch { }
    }

    private static string FindAntigravityExe()
    {
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string prog = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string[] candidates = new[]
        {
            Path.Combine(local, "Programs", "antigravity", "Antigravity.exe"),
            Path.Combine(local, "Programs", "Antigravity", "Antigravity.exe"),
            Path.Combine(prog, "Antigravity", "Antigravity.exe")
        };
        foreach (string path in candidates)
        {
            if (File.Exists(path)) return path;
        }
        return null;
    }

    private static void OpenOrFocusAntigravityIde(string root)
    {
        bool focused = false;
        try
        {
            foreach (Process proc in Process.GetProcessesByName("Antigravity IDE"))
            {
                try
                {
                    if (proc.MainWindowHandle != IntPtr.Zero)
                    {
                        if (IsIconic(proc.MainWindowHandle)) ShowWindow(proc.MainWindowHandle, 9);
                        SetForegroundWindow(proc.MainWindowHandle);
                        focused = true;
                        break;
                    }
                }
                catch { }
                finally { proc.Dispose(); }
            }
        }
        catch { }

        if (focused)
        {
            ThreadPool.QueueUserWorkItem(_ => StartCompanion(root, false));
            return;
        }

        string ideExe = FindAntigravityIdeExe();
        if (!string.IsNullOrEmpty(ideExe))
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = ideExe,
                    Arguments = "--remote-debugging-port=9223 --remote-debugging-address=127.0.0.1",
                    WorkingDirectory = Path.GetDirectoryName(ideExe),
                    UseShellExecute = false
                });
                ThreadPool.QueueUserWorkItem(_ => StartCompanion(root, false));
                return;
            }
            catch { }
        }
        SignalExistingTray();
    }

    private static string FindAntigravityIdeExe()
    {
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string prog = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string[] candidates = new[]
        {
            Path.Combine(local, "Programs", "Antigravity IDE", "Antigravity IDE.exe"),
            Path.Combine(prog, "Antigravity IDE", "Antigravity IDE.exe")
        };
        foreach (string path in candidates)
        {
            if (File.Exists(path)) return path;
        }
        return null;
    }

    private static void StopCompanion()
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(DashboardUrl + "/api/health");
            req.Timeout = 1500;
            req.ReadWriteTimeout = 1500;
            string json;
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var reader = new StreamReader(resp.GetResponseStream()))
            {
                json = reader.ReadToEnd();
            }
            if (json == null || json.IndexOf("\"antigravity-monitor\"", StringComparison.OrdinalIgnoreCase) < 0) return;
            Match match = Regex.Match(json, "\"pid\"\\s*:\\s*(\\d+)");
            if (!match.Success) return;
            int pid;
            if (int.TryParse(match.Groups[1].Value, out pid) && pid > 0)
            {
                using (Process proc = Process.GetProcessById(pid))
                {
                    proc.Kill();
                    proc.WaitForExit(2000);
                }
            }
        }
        catch { }
    }

    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValueName = "AntigravityMonitor";

    private static string StartupShortcutPath()
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "Antigravity Monitor.lnk");
    }

    private static bool IsStartOnBootEnabled()
    {
        try
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKeyPath, false))
            {
                if (key != null)
                {
                    string val = key.GetValue(RunValueName) as string;
                    if (!string.IsNullOrWhiteSpace(val)) return true;
                }
            }
        }
        catch { }
        try
        {
            if (File.Exists(StartupShortcutPath())) return true;
        }
        catch { }
        return false;
    }

    private static void SetStartOnBoot(bool enable)
    {
        try
        {
            if (enable)
            {
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(RunKeyPath))
                {
                    if (key != null)
                    {
                        key.SetValue(RunValueName, "\"" + Assembly.GetExecutingAssembly().Location + "\" --companion");
                    }
                }
            }
            else
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKeyPath, true))
                {
                    if (key != null) key.DeleteValue(RunValueName, false);
                }
                string lnk = StartupShortcutPath();
                if (File.Exists(lnk)) File.Delete(lnk);
            }
        }
        catch { }
        ThreadPool.QueueUserWorkItem(_ =>
        {
            try
            {
                using (Process proc = Process.Start(new ProcessStartInfo
                {
                    FileName = "schtasks.exe",
                    Arguments = "/change /tn AntigravityMonitor " + (enable ? "/enable" : "/disable"),
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                }))
                {
                    if (proc != null) proc.WaitForExit(3000);
                }
            }
            catch { }
        });
    }
#endif
}
