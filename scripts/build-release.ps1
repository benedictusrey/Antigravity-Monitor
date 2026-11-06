[CmdletBinding()]
param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne '1.0.0') { throw 'This release must remain v1.0.0.' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'release\v1.0.0' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Choose a new output folder; existing release files are never overwritten.' }
$vsix = 'antigravity-monitor-1.0.0.vsix'
foreach ($required in @($vsix,'out\src\app\monitor.js','out\src\core\quota.js','media\icon.png','media\icon.ico','media\icon.icns','Antigravity Monitor.exe','Install Antigravity Monitor.exe','assets\banners\antigravity-monitor-hero.png','assets\banners\antigravity-monitor-features.png','assets\banners\antigravity-monitor-customization.png')) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $required) -PathType Leaf)) { throw "Build first; missing: $required" }
}
$repository = Join-Path $OutputDirectory 'repository'
$runtime = Join-Path $OutputDirectory 'Antigravity-Monitor-1.0.0'
New-Item -ItemType Directory -Path $repository,$runtime -Force | Out-Null
function Copy-Relative([string]$Relative, [string]$Destination) {
    $source = Join-Path $projectRoot $Relative
    $target = Join-Path $Destination $Relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
}
$rootFiles = @('.gitignore','.gitattributes','.vscodeignore','package.json','package-lock.json','LICENSE','tsconfig.json','Antigravity Monitor.cmd','Install Antigravity Monitor.cmd','Install Antigravity Monitor.sh','Install Antigravity Monitor.command','Antigravity Monitor.sh')
$rootFiles += Get-ChildItem -LiteralPath $projectRoot -Filter '*.md' -File | ForEach-Object Name
foreach ($relative in $rootFiles) { Copy-Relative $relative $repository }
foreach ($relative in @('src','tests','scripts','tools','media','assets','.github')) { Copy-Relative $relative $repository }
foreach ($relative in @('docs\ARCHITECTURE.md','docs\AUDIT.md','docs\DESIGN.md','docs\screenshots')) { Copy-Relative $relative $repository }
foreach ($relative in @('package.json','LICENSE','tools','media','assets','out\src',$vsix)) { Copy-Relative $relative $runtime }
foreach ($relative in @('Antigravity Monitor.exe','Install Antigravity Monitor.exe','Antigravity Monitor.cmd','Install Antigravity Monitor.cmd','Install Antigravity Monitor.sh','Install Antigravity Monitor.command','Antigravity Monitor.sh')) { Copy-Relative $relative $runtime }
foreach ($relative in (Get-ChildItem -LiteralPath $projectRoot -Filter '*.md' -File | ForEach-Object Name)) { Copy-Relative $relative $runtime }
foreach ($relative in @('docs\ARCHITECTURE.md','docs\AUDIT.md','docs\DESIGN.md','docs\screenshots')) { Copy-Relative $relative $runtime }
Copy-Item -LiteralPath (Join-Path $projectRoot $vsix) -Destination (Join-Path $OutputDirectory $vsix)
Copy-Item -LiteralPath (Join-Path $projectRoot 'RELEASE_NOTES.md') -Destination (Join-Path $OutputDirectory 'RELEASE_NOTES.md')
$runtimeZip = Join-Path $OutputDirectory 'Antigravity-Monitor-1.0.0-companion.zip'
$sourceZip = Join-Path $OutputDirectory 'Antigravity-Monitor-1.0.0-source.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($runtime, $runtimeZip, [IO.Compression.CompressionLevel]::Optimal, $true)
[IO.Compression.ZipFile]::CreateFromDirectory($repository, $sourceZip, [IO.Compression.CompressionLevel]::Optimal, $true)
$checksums = foreach ($file in @((Join-Path $OutputDirectory $vsix),$runtimeZip,$sourceZip)) {
    ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()) + '  ' + (Split-Path -Leaf $file)
}
[IO.File]::WriteAllLines((Join-Path $OutputDirectory 'SHA256SUMS.txt'), $checksums, [Text.UTF8Encoding]::new($false))
Write-Output "Prepared v1.0.0 upload files: $OutputDirectory"
