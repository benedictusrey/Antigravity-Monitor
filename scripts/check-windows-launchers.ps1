[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName System.Drawing
$ico=[IO.File]::ReadAllBytes((Join-Path $root 'media\icon.ico'))
if([BitConverter]::ToUInt16($ico,2) -ne 1 -or [BitConverter]::ToUInt16($ico,4) -ne 7){throw 'Invalid multi-size ICO'}
$icns=[IO.File]::ReadAllBytes((Join-Path $root 'media\icon.icns'))
if([Text.Encoding]::ASCII.GetString($icns,0,4) -ne 'icns'){throw 'Invalid ICNS signature'}
$sizeBytes=$icns[4..7];[Array]::Reverse($sizeBytes)
if([BitConverter]::ToInt32($sizeBytes,0) -ne $icns.Length){throw 'Invalid ICNS length'}
$expectedVersion=(Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
foreach($name in @('Antigravity Monitor.exe','Install Antigravity Monitor.exe','Antigravity Monitor_Uninstaller.exe')){
    $file=Join-Path $root $name
    $version=[Diagnostics.FileVersionInfo]::GetVersionInfo($file)
    if($version.ProductVersion -ne $expectedVersion){throw "Wrong version in $name (expected $expectedVersion, got $($version.ProductVersion))"}
    $icon=[Drawing.Icon]::ExtractAssociatedIcon($file)
    if(-not $icon){throw "Missing embedded icon in $name"}
    $bitmap=$icon.ToBitmap()
    try {
        $blue=0;$white=0
        for($y=0;$y -lt $bitmap.Height;$y++){for($x=0;$x -lt $bitmap.Width;$x++){$pixel=$bitmap.GetPixel($x,$y);if($pixel.B -gt 150 -and $pixel.R -lt 140){$blue++};if($pixel.R -gt 200 -and $pixel.G -gt 200 -and $pixel.B -gt 200){$white++}}}
        if($blue -eq 0 -or $white -eq 0){throw "Embedded icon lacks logo colors in $name"}
    } finally {$bitmap.Dispose();$icon.Dispose()}
    $process=Start-Process -FilePath $file -ArgumentList '--verify-launcher' -WindowStyle Hidden -Wait -PassThru
    if($process.ExitCode -ne 0){throw "Launcher target check failed: $name"}
}
$temporary=Join-Path ([IO.Path]::GetTempPath()) ('agm-launcher-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
$testFile=Join-Path $temporary 'Install Antigravity Monitor.exe'
try {
    Copy-Item -LiteralPath (Join-Path $root 'Install Antigravity Monitor.exe') -Destination $testFile
    $process=Start-Process -FilePath $testFile -ArgumentList '--verify-launcher' -WindowStyle Hidden -Wait -PassThru
    if($process.ExitCode -ne 2){throw 'Missing companion command was not detected'}
} finally {Remove-Item -LiteralPath $testFile -Force;Remove-Item -LiteralPath $temporary}
$asm=[Reflection.Assembly]::LoadFrom((Join-Path $root 'Antigravity Monitor.exe'))
$flyoutType=$asm.GetType('TrayFlyoutForm',$true)
$parseMethod=$flyoutType.GetMethod('ParseSnapshot',[Reflection.BindingFlags]'NonPublic,Static')
$sampleJson='{"snapshot":{"status":"ready","activeQuotaGroupId":"gemini","prefs":{"warningThreshold":80,"maskPersonalInfo":true},"account":{"email":"dev@example.com"},"conversation":{"title":"Active Session","workspace":"Workspace","modelName":"Gemini 4 Neon","usage":{"percent":42.5,"used":425000,"capacity":1000000,"remaining":575000,"source":"measured","tokPerSec":160}},"quota":{"observedAt":1795400000000,"groups":[{"id":"gemini","label":"Gemini Models","buckets":[{"window":"5h","percent":65,"resetsAt":"2026-11-23T15:00:00Z","enabled":true},{"window":"weekly","percent":82,"resetsAt":"2026-11-29T12:00:00Z","enabled":true}]}]}}}'
$parsed=$parseMethod.Invoke($null,@($sampleJson))
if($parsed.Status -ne 'ready' -or $parsed.Title -ne 'Active Session' -or $parsed.MaskedEmail -ne "de$([char]0x2022)$([char]0x2022)$([char]0x2022)@example.com" -or [Math]::Abs($parsed.Percent - 42.5) -gt 0.01 -or $parsed.Pools.Count -ne 1 -or -not $parsed.Pools[0].Active){throw 'TrayFlyoutForm.ParseSnapshot smoke check failed'}
Write-Output "Launcher checks passed: embedded logo, v$expectedVersion metadata, target checks, missing-file guard, flyout ParseSnapshot, ICO sizes, and ICNS structure."
