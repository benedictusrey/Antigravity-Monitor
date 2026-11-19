[CmdletBinding()]
param([switch]$Supervise)
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $appRoot 'package.json') -Raw | ConvertFrom-Json
$expectedVersion = $manifest.version
$expectedBuild = $manifest.monitorBuild
$healthUrl = 'http://127.0.0.1:4599/api/health'
try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($health.service -eq 'antigravity-monitor') {
        if ($health.version -ne $expectedVersion -or ($expectedBuild -and $health.build -ne $expectedBuild)) { throw 'A different monitor build is running. Run the installer to update it.' }
        if ($Supervise -and $health.pid) {
            Wait-Process -Id ([int]$health.pid) -ErrorAction SilentlyContinue
            try { $null = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1; exit 0 } catch { exit 1 }
        }
        exit 0
    }
} catch [System.Net.WebException] {
    # No companion is expected on first launch.
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
$logRoot = Split-Path -Parent $appRoot
$stdout = Join-Path $logRoot 'companion.log'
$stderr = Join-Path $logRoot 'companion-error.log'
foreach ($log in @($stdout, $stderr)) {
    if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 2MB) {
        Copy-Item -LiteralPath $log -Destination ($log + '.previous') -Force
    }
}
$child = Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + $entrypoint + '" --no-open --port 4599') -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
$ready = $false
for ($attempt = 0; $attempt -lt 12; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
        if ($health.service -eq 'antigravity-monitor' -and $health.version -eq $expectedVersion -and (-not $expectedBuild -or $health.build -eq $expectedBuild)) {
            $ready = $true
            break
        }
    } catch [System.Net.WebException] {}
    if ($child.HasExited) { throw "Companion exited. See $stderr" }
}
if (-not $ready) { throw "Companion did not become ready. See $stderr" }
if ($Supervise) {
    $child.WaitForExit()
    if ($child.ExitCode -ne 0) { exit $child.ExitCode }
}
exit 0
