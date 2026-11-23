[CmdletBinding()]
param([switch]$Supervise)
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$logRoot = Split-Path -Parent $appRoot
$stdout = Join-Path $logRoot 'companion.log'
$stderr = Join-Path $logRoot 'companion-error.log'
$healthUrl = 'http://127.0.0.1:4599/api/health'

function Get-Health {
    try { return Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2 } catch [System.Net.WebException] { return $null }
}

try {
    $manifest = Get-Content -LiteralPath (Join-Path $appRoot 'package.json') -Raw | ConvertFrom-Json
    $expectedVersion = $manifest.version
    $expectedBuild = $manifest.monitorBuild

    function Test-Companion($health) {
        return [bool]($health -and $health.service -eq 'antigravity-monitor' -and $health.version -eq $expectedVersion -and (-not $expectedBuild -or $health.build -eq $expectedBuild))
    }

    $health = Get-Health
    if ($health -and $health.service -eq 'antigravity-monitor') {
        if (-not (Test-Companion $health)) { throw 'A different monitor build is running. Run the installer to update it.' }
        if ($Supervise) {
            # Watch the running instance; when it stops, exit non-zero so the logon task restarts it.
            Wait-Process -Id ([int]$health.pid) -ErrorAction SilentlyContinue
            exit 1
        }
        exit 0
    }

    $nodePathFile = Join-Path $appRoot 'node-path.txt'
    $nodeExecutable = if (Test-Path -LiteralPath $nodePathFile -PathType Leaf) { (Get-Content -LiteralPath $nodePathFile -Raw).Trim() } else { '' }
    if (-not $nodeExecutable -or -not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) {
        $candidates = @(
            (Get-Command node.exe -ErrorAction SilentlyContinue).Source,
            (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
            (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
            (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
        ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
        $nodeExecutable = $candidates | Select-Object -First 1
        if (-not $nodeExecutable) { throw 'Node.js is unavailable. Install Node.js 22+ and run the installer again.' }
        [System.IO.File]::WriteAllText($nodePathFile, $nodeExecutable)
    }
    $entrypoint = Join-Path $appRoot 'tools\monitor-server.mjs'
    foreach ($log in @($stdout, $stderr)) {
        if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 2MB) {
            Copy-Item -LiteralPath $log -Destination ($log + '.previous') -Force
        }
    }
    # No -WindowStyle: the companion inherits this script's console, which the launcher creates without a window.
    $child = Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + $entrypoint + '" --no-open --port 4599') -WorkingDirectory $appRoot -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 500
        $health = Get-Health
        if (Test-Companion $health) { $ready = $true; break }
        if ($child.HasExited) { break }
    }
    if (-not $ready) {
        # Another launcher may have bound the port a moment earlier. That instance serves the dashboard instead.
        $health = Get-Health
        if (-not (Test-Companion $health)) { throw "Companion did not start. See $stderr" }
    }
    if ($Supervise) {
        Wait-Process -Id ([int]$health.pid) -ErrorAction SilentlyContinue
        exit 1
    }
    exit 0
} catch {
    # The launcher hides this console, so failures are written to a file where they can be read.
    try { Add-Content -LiteralPath $stderr -Value ('{0} start-companion: {1}' -f (Get-Date -Format 's'), $_.Exception.Message) -Encoding utf8 } catch {}
    exit 1
}
