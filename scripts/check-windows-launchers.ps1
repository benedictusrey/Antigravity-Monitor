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
foreach($name in @('Antigravity Monitor.exe','Install Antigravity Monitor.exe')){
    $file=Join-Path $root $name
    $version=[Diagnostics.FileVersionInfo]::GetVersionInfo($file)
    if($version.ProductVersion -ne '1.0.0'){throw "Wrong version in $name"}
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
Write-Output 'Launcher checks passed: embedded logo, v1.0.0 metadata, target checks, missing-file guard, ICO sizes, and ICNS structure.'
