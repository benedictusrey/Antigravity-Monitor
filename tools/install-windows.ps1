[CmdletBinding()]
param([string]$PackageRoot, [string]$VsixPath, [switch]$Uninstall, [switch]$RefreshShortcuts, [string]$AntigravityExe)
$ErrorActionPreference = 'Stop'
$taskName = 'AntigravityMonitor'

function Save-MonitorLaunchShortcuts([object]$Shell, [string]$PreferredExe, [string]$ProgramFolder) {
    $exe = $PreferredExe
    if (-not $exe -or -not (Test-Path -LiteralPath $exe -PathType Leaf)) {
        $exe = @(
            (Join-Path $env:LOCALAPPDATA 'Programs\antigravity\Antigravity.exe'),
            (Join-Path $env:LOCALAPPDATA 'Programs\Antigravity\Antigravity.exe'),
            (Join-Path $env:ProgramFiles 'Antigravity\Antigravity.exe')
        ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    }
    if (-not $exe) {
        foreach ($lnkPath in @(
            (Join-Path ([Environment]::GetFolderPath('Programs')) 'Antigravity.lnk'),
            (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Antigravity.lnk')
        )) {
            if (Test-Path -LiteralPath $lnkPath -PathType Leaf) {
                $existingAg = $Shell.CreateShortcut($lnkPath)
                if ($existingAg.TargetPath -and (Test-Path -LiteralPath $existingAg.TargetPath -PathType Leaf)) {
                    $exe = $existingAg.TargetPath
                    break
                }
            }
        }
    }
    if (-not $exe) { return $null }
    $targets = @((Join-Path ([Environment]::GetFolderPath('Programs')) 'Antigravity (with Monitor).lnk'))
    if ($ProgramFolder -and (Test-Path -LiteralPath $ProgramFolder -PathType Container)) {
        $targets += (Join-Path $ProgramFolder 'Antigravity (with Monitor).lnk')
    }
    foreach ($shortcutFile in $targets) {
        $agMonitorLnk = $Shell.CreateShortcut($shortcutFile)
        $agMonitorLnk.TargetPath = $exe
        $agMonitorLnk.Arguments = '--remote-debugging-port=9222 --remote-debugging-address=127.0.0.1'
        $agMonitorLnk.WorkingDirectory = Split-Path -Parent $exe
        $agMonitorLnk.IconLocation = $exe + ',0'
        $agMonitorLnk.Description = 'Launch Antigravity desktop with local DevTools enabled for the inline monitor badge.'
        $agMonitorLnk.Save()
    }
    return $exe
}

if ($RefreshShortcuts) {
    $shell = New-Object -ComObject WScript.Shell
    $programFolder = Join-Path ([Environment]::GetFolderPath('Programs')) 'Antigravity Monitor'
    $null = Save-MonitorLaunchShortcuts -Shell $shell -PreferredExe $AntigravityExe -ProgramFolder $programFolder
    exit 0
}
if ($Uninstall) {
    try {
        if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
        }
    } catch {}
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    if (Test-Path -LiteralPath $runKey) {
        Remove-ItemProperty -LiteralPath $runKey -Name 'AntigravityMonitor' -ErrorAction SilentlyContinue
    }
    $programsDir = [Environment]::GetFolderPath('Programs')
    Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Startup')) 'Antigravity Monitor.lnk') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $programsDir 'Antigravity (with Monitor).lnk') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $programsDir 'Antigravity Monitor') -Recurse -Force -ErrorAction SilentlyContinue
    Write-Output ('Startup and shortcuts removed. Usage, settings, and runtime retained under ' + (Join-Path $env:LOCALAPPDATA 'Antigravity Monitor') + '.')
    exit 0
}
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
$previousHealthOk = $false
if ($listener) {
    $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listener.OwningProcess)
    if ($process.Name -ne 'node.exe' -or $process.CommandLine -notmatch 'monitor-server\.mjs(?:"|\s|$)') {
        throw 'Port 4599 belongs to another program. No process was stopped.'
    }
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4599/api/health' -TimeoutSec 3
    if ($health.service -ne 'antigravity-monitor') { throw 'Existing service was not recognized as Antigravity Monitor.' }
    $previousHealthOk = $true
}
$taskWasDisabled = $false
try {
    $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        Disable-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        $taskWasDisabled = ($existingTask.State -ne 'Disabled')
    }
} catch {}
$taskRegistered = $false
try {
    if ($listener -and $previousHealthOk) {
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
    $agExe = Save-MonitorLaunchShortcuts -Shell $shell -PreferredExe $AntigravityExe -ProgramFolder $programFolder
    try {
        $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
        if (Test-Path -LiteralPath $runKey) {
            $runCmd = '"' + (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') + '" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $appRoot 'tools\start-companion.ps1') + '"'
            Set-ItemProperty -LiteralPath $runKey -Name 'AntigravityMonitor' -Value $runCmd
        }
    } catch {
        Write-Output ('Registry startup registration skipped: ' + $_.Exception.Message)
    }
    try {
        $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $taskArg = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $appRoot 'tools\start-companion.ps1') + '" -Supervise'
        $taskAction = New-ScheduledTaskAction -Execute $psExe -Argument $taskArg -WorkingDirectory $appRoot
        $taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
        $taskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
        Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Settings $taskSettings -Description 'Start Antigravity Monitor companion at sign-in and keep it running across Antigravity updates.' -Force | Out-Null
        $taskRegistered = $true
        $taskWasDisabled = $false
    } catch {
        Write-Output ('Scheduled task registration skipped: ' + $_.Exception.Message)
        if ($taskWasDisabled) {
            try { Enable-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null; $taskWasDisabled = $false } catch {}
        }
    }
} catch {
    if ($taskWasDisabled) {
        try { Enable-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null } catch {}
    }
    throw
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
if ($taskRegistered) { Write-Output ('Logon task: ' + $taskName + ' (auto-start at sign-in with crash restart)') }
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
