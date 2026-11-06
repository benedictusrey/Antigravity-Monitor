using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("Antigravity Monitor")]
[assembly: AssemblyProduct("Antigravity Monitor")]
[assembly: AssemblyCompany("Antigravity Monitor contributors")]
[assembly: AssemblyDescription("Antigravity Monitor launcher")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]
[assembly: AssemblyInformationalVersion("1.0.0")]

internal static class Launcher
{
    [STAThread]
    private static int Main(string[] arguments)
    {
#if INSTALLER
        const string command = "Install Antigravity Monitor.cmd";
#else
        const string command = "Antigravity Monitor.cmd";
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
    }
}
