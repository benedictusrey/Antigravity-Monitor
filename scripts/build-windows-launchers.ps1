[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName System.Drawing
$source = [Drawing.Image]::FromFile((Join-Path $root 'media\icon.png'))
$frames = @()
try {
    foreach ($size in @(16,24,32,48,64,128,256,512)) {
        $bitmap = [Drawing.Bitmap]::new($size,$size)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        $memory = [IO.MemoryStream]::new()
        try {
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
            $graphics.DrawImage($source,0,0,$size,$size)
            $bitmap.Save($memory,[Drawing.Imaging.ImageFormat]::Png)
            $frames += [pscustomobject]@{Size=$size;Data=$memory.ToArray()}
        } finally { $memory.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
    }
} finally { $source.Dispose() }
$iconFrames = @($frames | Where-Object Size -le 256)
$stream = [IO.MemoryStream]::new()
$writer = [IO.BinaryWriter]::new($stream)
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$iconFrames.Count)
    $offset = 6 + 16 * $iconFrames.Count
    foreach ($frame in $iconFrames) {
        $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
        $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
        $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([uint16]1); $writer.Write([uint16]32)
        $writer.Write([uint32]$frame.Data.Length); $writer.Write([uint32]$offset)
        $offset += $frame.Data.Length
    }
    foreach ($frame in $iconFrames) { $writer.Write([byte[]]$frame.Data) }
    [IO.File]::WriteAllBytes((Join-Path $root 'media\icon.ico'),$stream.ToArray())
} finally { $writer.Dispose(); $stream.Dispose() }
$icns = [IO.MemoryStream]::new()
function Write-BigEndian([IO.Stream]$Stream, [int]$Value) {
    $bytes=[BitConverter]::GetBytes($Value); [Array]::Reverse($bytes); $Stream.Write($bytes,0,4)
}
try {
    $types=@{16='icp4';32='icp5';64='icp6';128='ic07';256='ic08';512='ic09'}
    $selected=@($frames|Where-Object {$types.ContainsKey($_.Size)})
    $length=8
    foreach($frame in $selected){$length+=8+$frame.Data.Length}
    $bytes=[Text.Encoding]::ASCII.GetBytes('icns');$icns.Write($bytes,0,4);Write-BigEndian $icns $length
    foreach($frame in $selected){$bytes=[Text.Encoding]::ASCII.GetBytes($types[$frame.Size]);$icns.Write($bytes,0,4);Write-BigEndian $icns (8+$frame.Data.Length);$icns.Write($frame.Data,0,$frame.Data.Length)}
    [IO.File]::WriteAllBytes((Join-Path $root 'media\icon.icns'),$icns.ToArray())
} finally {$icns.Dispose()}
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if(-not(Test-Path -LiteralPath $compiler)){$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'}
if(-not(Test-Path -LiteralPath $compiler)){throw 'The Windows .NET Framework C# compiler is required.'}
foreach($installer in @($false,$true)){
    $name=if($installer){'Install Antigravity Monitor.exe'}else{'Antigravity Monitor.exe'}
    $arguments=@('/nologo','/target:winexe','/platform:anycpu','/optimize+','/reference:System.Windows.Forms.dll',('/win32icon:'+(Join-Path $root 'media\icon.ico')),('/out:'+(Join-Path $root $name)))
    if($installer){$arguments+='/define:INSTALLER'}
    $arguments+=Join-Path $root 'tools\windows-launcher.cs'
    & $compiler @arguments
    if($LASTEXITCODE -ne 0){throw "Failed to build $name"}
}
Write-Output 'Built branded Windows launchers, multi-size ICO, and ICNS assets for v1.0.0.'
