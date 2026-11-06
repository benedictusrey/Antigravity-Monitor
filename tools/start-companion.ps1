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
        exit 0
    }
} catch [System.Net.WebException] {
    # No companion is expected on first launch.
}
$nodeExecutable = (Get-Content -LiteralPath (Join-Path $appRoot 'node-path.txt') -Raw).Trim()
if (-not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) { throw 'Node.js is unavailable. Run the installer again.' }
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
for ($attempt = 0; $attempt -lt 12; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
        if ($health.service -eq 'antigravity-monitor' -and $health.version -eq $expectedVersion -and (-not $expectedBuild -or $health.build -eq $expectedBuild)) { exit 0 }
    } catch [System.Net.WebException] {}
    if ($child.HasExited) { throw "Companion exited. See $stderr" }
}
throw "Companion did not become ready. See $stderr"
