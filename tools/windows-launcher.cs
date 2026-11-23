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

[assembly: AssemblyTitle("Antigravity Monitor")]
[assembly: AssemblyProduct("Antigravity Monitor")]
[assembly: AssemblyCompany("Benedictus RH (@benedictusrey)")]
[assembly: AssemblyDescription("Antigravity Monitor launcher")]
[assembly: AssemblyVersion("1.3.0.0")]
[assembly: AssemblyFileVersion("1.3.0.0")]
[assembly: AssemblyInformationalVersion("1.3.0")]

internal static class Launcher
{
#if !INSTALLER
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
#if !INSTALLER
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

#if !INSTALLER
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

                var exitItem = new ToolStripMenuItem("Exit");
                menu.Items.Add(focusItem);
                menu.Items.Add(dashItem);
                menu.Items.Add(restartItem);
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
            using (var client = new WebClient())
            {
                client.Headers[HttpRequestHeader.ContentType] = "application/json";
                client.UploadString(DashboardUrl + "/api/command", "POST", "{\"type\":\"openInAppPanel\"}");
            }
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

    private static void StopCompanion()
    {
        try
        {
            using (var client = new WebClient())
            {
                string json = client.DownloadString(DashboardUrl + "/api/health");
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
        }
        catch { }
    }
#endif
}
