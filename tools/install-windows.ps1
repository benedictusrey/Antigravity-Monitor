[CmdletBinding()]
param([string]$PackageRoot, [string]$VsixPath)
$ErrorActionPreference = 'Stop'
if (-not $PackageRoot) { $PackageRoot = Split-Path -Parent $PSScriptRoot }
$PackageRoot = (Resolve-Path -LiteralPath $PackageRoot).Path
$manifest = Get-Content -LiteralPath (Join-Path $PackageRoot 'package.json') -Raw | ConvertFrom-Json
if (-not $VsixPath) { $VsixPath = Join-Path $PackageRoot ('antigravity-monitor-' + $manifest.version + '.vsix') }
$VsixPath = (Resolve-Path -LiteralPath $VsixPath).Path
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$nodeMajor = [int](& $nodeExecutable -p 'parseInt(process.versions.node)')
if ($LASTEXITCODE -ne 0 -or $nodeMajor -lt 22) { throw 'Node.js 22 or newer is required.' }
foreach ($relative in @('out\src\app\monitor.js', 'tools\monitor-server.mjs', 'tools\start-companion.ps1', 'media\dashboard.html', 'media\icon.ico', 'Antigravity Monitor.exe', 'Antigravity Monitor.cmd')) {
    if (-not (Test-Path -LiteralPath (Join-Path $PackageRoot $relative) -PathType Leaf)) { throw "Missing package file: $relative. Build the package first." }
}
$editors = @(
    @{ Name = 'Antigravity IDE'; Command = 'antigravity-ide.cmd'; Folder = 'Antigravity IDE' },
    @{ Name = 'Visual Studio Code'; Command = 'code.cmd'; Folder = 'Microsoft VS Code' },
    @{ Name = 'Visual Studio Code Insiders'; Command = 'code-insiders.cmd'; Folder = 'Microsoft VS Code Insiders' }
)
$installers = @()
foreach ($editor in $editors) {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA ('Programs\' + $editor.Folder + '\bin\' + $editor.Command)),
        (Join-Path $env:ProgramFiles ($editor.Folder + '\bin\' + $editor.Command))
    )
    $cli = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $cli) { $cli = (Get-Command $editor.Command -ErrorAction SilentlyContinue).Source }
    if ($cli) { $installers += @{ Name = $editor.Name; Cli = $cli } }
    else { Write-Output ($editor.Name + ': not installed; skipped.') }
}
$installRoot = Join-Path $env:LOCALAPPDATA 'Antigravity Monitor'
$appRoot = Join-Path $installRoot 'app'
$backupRoot = Join-Path $installRoot ('backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
# Only the monitor on its own loopback port may be replaced; editors stay open.
$listener = Get-NetTCPConnection -LocalPort 4599 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listener.OwningProcess)
    if ($process.Name -ne 'node.exe' -or $process.CommandLine -notmatch 'monitor-server\.mjs(?:"|\s|$)') {
        throw 'Port 4599 belongs to another program. No process was stopped.'
    }
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4599/api/health' -TimeoutSec 3
    if ($health.service -ne 'antigravity-monitor') { throw 'Existing service was not recognized as Antigravity Monitor.' }
    $stateFile = Join-Path $installRoot 'state.json'
    if (Test-Path -LiteralPath $stateFile) {
        New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
        Copy-Item -LiteralPath $stateFile -Destination (Join-Path $backupRoot 'state.json')
    }
    $previousMonitor = Get-Process -Id $listener.OwningProcess -ErrorAction Stop
    Stop-Process -Id $listener.OwningProcess -ErrorAction Stop
    if (-not $previousMonitor.WaitForExit(5000)) { throw 'Previous monitor did not exit; replacement was not started.' }
    Write-Output 'Stopped the previous monitor process; the existing persisted state file was backed up.'
}
foreach ($relative in @('package.json', 'LICENSE', 'tools', 'media', 'out\src', 'Antigravity Monitor.exe', 'Antigravity Monitor.cmd')) {
    $source = Join-Path $PackageRoot $relative
    $target = Join-Path $appRoot $relative
    if (Test-Path -LiteralPath $target) {
        $saved = Join-Path $backupRoot $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $saved) -Force | Out-Null
        Copy-Item -LiteralPath $target -Destination $saved -Recurse
    }
    if (Test-Path -LiteralPath $source -PathType Container) {
        if (Test-Path -LiteralPath $target -PathType Container) { Remove-Item -LiteralPath $target -Recurse -Force }
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $target -Recurse -Force
    } else {
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $target -Force
    }
}
[System.IO.File]::WriteAllText((Join-Path $appRoot 'node-path.txt'), $nodeExecutable)
$shell = New-Object -ComObject WScript.Shell
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Antigravity Monitor.lnk'
if (Test-Path -LiteralPath $shortcutPath) {
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    Copy-Item -LiteralPath $shortcutPath -Destination (Join-Path $backupRoot 'Antigravity Monitor.lnk')
}
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $appRoot 'tools\start-companion.ps1') + '"'
$shortcut.WorkingDirectory = $appRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Automatically attaches Antigravity Monitor to supported local apps.'
$shortcut.IconLocation = (Join-Path $appRoot 'media\icon.ico') + ',0'
$shortcut.Save()
$programFolder = Join-Path ([Environment]::GetFolderPath('Programs')) 'Antigravity Monitor'
New-Item -ItemType Directory -Path $programFolder -Force | Out-Null
$menuShortcut = $shell.CreateShortcut((Join-Path $programFolder 'Antigravity Monitor.lnk'))
$menuShortcut.TargetPath = Join-Path $appRoot 'Antigravity Monitor.exe'
$menuShortcut.WorkingDirectory = $appRoot
$menuShortcut.IconLocation = (Join-Path $appRoot 'media\icon.ico') + ',0'
$menuShortcut.Description = 'Open the local Antigravity Monitor dashboard.'
$menuShortcut.Save()
$agExe = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\antigravity\Antigravity.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Antigravity\Antigravity.exe'),
    (Join-Path $env:ProgramFiles 'Antigravity\Antigravity.exe')
) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $agExe) {
    foreach ($lnkPath in @(
        (Join-Path ([Environment]::GetFolderPath('Programs')) 'Antigravity.lnk'),
        (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Antigravity.lnk')
    )) {
        if (Test-Path -LiteralPath $lnkPath -PathType Leaf) {
            $existingAg = $shell.CreateShortcut($lnkPath)
            if ($existingAg.TargetPath -and (Test-Path -LiteralPath $existingAg.TargetPath -PathType Leaf)) {
                $agExe = $existingAg.TargetPath
                break
            }
        }
    }
}
if ($agExe) {
    foreach ($shortcutFile in @(
        (Join-Path $programFolder 'Antigravity (with Monitor).lnk'),
        (Join-Path ([Environment]::GetFolderPath('Programs')) 'Antigravity (with Monitor).lnk')
    )) {
        $agMonitorLnk = $shell.CreateShortcut($shortcutFile)
        $agMonitorLnk.TargetPath = $agExe
        $agMonitorLnk.Arguments = '--remote-debugging-port=9222 --remote-debugging-address=127.0.0.1'
        $agMonitorLnk.WorkingDirectory = Split-Path -Parent $agExe
        $agMonitorLnk.IconLocation = $agExe + ',0'
        $agMonitorLnk.Description = 'Launch Antigravity desktop with local DevTools enabled for the inline monitor badge.'
        $agMonitorLnk.Save()
    }
}
try {
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    if (Test-Path -LiteralPath $runKey) {
        $runCmd = '"' + (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') + '" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $appRoot 'tools\start-companion.ps1') + '"'
        Set-ItemProperty -LiteralPath $runKey -Name 'AntigravityMonitor' -Value $runCmd
    }
} catch {
    Write-Output ('Registry startup registration skipped: ' + $_.Exception.Message)
}
$failures = @()
foreach ($editor in $installers) {
    Write-Output ('Installing into ' + $editor.Name + '...')
    & $editor.Cli --install-extension $VsixPath --force
    if ($LASTEXITCODE -ne 0) { $failures += $editor.Name }
}
& (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -ExecutionPolicy Bypass -File (Join-Path $appRoot 'tools\start-companion.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Background companion failed to start. See the logs under LocalAppData\Antigravity Monitor.' }
Write-Output 'White Antigravity: companion installed, started, and enabled at sign-in.'
Write-Output ('Runtime: ' + $appRoot)
Write-Output ('Startup: ' + $shortcutPath)
$devtoolsReady = Test-Path -LiteralPath (Join-Path $env:APPDATA 'Antigravity\DevToolsActivePort') -PathType Leaf
if (-not $devtoolsReady) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $iar = $tcp.BeginConnect('127.0.0.1', 9222, $null, $null)
        if ($iar.AsyncWaitHandle.WaitOne(250, $false) -and $tcp.Connected) { $devtoolsReady = $true }
        $tcp.Close()
    } catch {}
}
if ($devtoolsReady) {
    Write-Output 'Inline composer badge: DevTools endpoint detected.'
} else {
    Write-Output 'Inline composer badge: no DevTools endpoint detected yet (dashboard works at http://127.0.0.1:4599).'
    if ($agExe) {
        Write-Output ('To show the inline pill in Antigravity, quit Antigravity completely and launch "Antigravity (with Monitor)" from the Start Menu, or run:')
        Write-Output ('  "' + $agExe + '" --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1')
    } else {
        Write-Output 'To show the inline pill in Antigravity, quit Antigravity completely and relaunch with --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1'
    }
}
Write-Output 'The companion stays running and reconnects when apps close and reopen.'
Write-Output 'Reload IDE and VS Code windows to activate the updated native extension.'
if ($failures.Count) { throw ('Extension installation failed for: ' + ($failures -join ', ')) }
