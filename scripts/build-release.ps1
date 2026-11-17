[CmdletBinding()]
param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$version = $manifest.version
if (-not $version) { throw 'Missing version in package.json.' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot ('release\v' + $version) }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Choose a new output folder; existing release files are never overwritten.' }
$vsix = 'antigravity-monitor-' + $version + '.vsix'
foreach ($scriptName in @('Install Antigravity Monitor.sh','Install Antigravity Monitor.command','Antigravity Monitor.sh')) {
    $raw = [IO.File]::ReadAllText((Join-Path $projectRoot $scriptName))
    if ($raw.Contains("`r`n")) { throw "POSIX script must use LF line endings: $scriptName" }
}
foreach ($required in @($vsix,'out\src\app\monitor.js','out\src\core\quota.js','media\icon.png','media\icon.ico','media\icon.icns','Antigravity Monitor.exe','Install Antigravity Monitor.exe','Install Antigravity Monitor.cmd','Install Antigravity Monitor.sh','Install Antigravity Monitor.command','Antigravity Monitor.sh','assets\banners\antigravity-monitor-hero.png','assets\banners\antigravity-monitor-features.png','assets\banners\antigravity-monitor-customization.png')) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $required) -PathType Leaf)) { throw "Build first; missing: $required" }
}
$repository = Join-Path $OutputDirectory 'repository'
$runtime = Join-Path $OutputDirectory ('Antigravity-Monitor-' + $version)
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
$runtimeZip = Join-Path $OutputDirectory ('Antigravity-Monitor-' + $version + '-companion.zip')
$windowsZip = Join-Path $OutputDirectory ('Antigravity-Monitor-' + $version + '-windows.zip')
$macosZip = Join-Path $OutputDirectory ('Antigravity-Monitor-' + $version + '-macos.zip')
$linuxZip = Join-Path $OutputDirectory ('Antigravity-Monitor-' + $version + '-linux.zip')
$sourceZip = Join-Path $OutputDirectory ('Antigravity-Monitor-' + $version + '-source.zip')
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($runtime, $runtimeZip, [IO.Compression.CompressionLevel]::Optimal, $true)
[IO.Compression.ZipFile]::CreateFromDirectory($repository, $sourceZip, [IO.Compression.CompressionLevel]::Optimal, $true)

$osTargets = @(
    @{ Name = 'windows'; Zip = $windowsZip; Keep = @('Antigravity Monitor.exe','Install Antigravity Monitor.exe','Antigravity Monitor.cmd','Install Antigravity Monitor.cmd') }
    @{ Name = 'macos'; Zip = $macosZip; Keep = @('Install Antigravity Monitor.command','Install Antigravity Monitor.sh','Antigravity Monitor.sh') }
    @{ Name = 'linux'; Zip = $linuxZip; Keep = @('Install Antigravity Monitor.sh','Antigravity Monitor.sh') }
)
$allLaunchers = @('Antigravity Monitor.exe','Install Antigravity Monitor.exe','Antigravity Monitor.cmd','Install Antigravity Monitor.cmd','Install Antigravity Monitor.sh','Install Antigravity Monitor.command','Antigravity Monitor.sh')
$stageRoot = Join-Path $OutputDirectory '_os-stage'
try {
    foreach ($os in $osTargets) {
        $bundleRoot = Join-Path $stageRoot ($os.Name + '\Antigravity-Monitor-' + $version)
        New-Item -ItemType Directory -Path (Split-Path -Parent $bundleRoot) -Force | Out-Null
        Copy-Item -LiteralPath $runtime -Destination $bundleRoot -Recurse -Force
        foreach ($launcher in $allLaunchers) {
            if ($launcher -notin $os.Keep) { Remove-Item -LiteralPath (Join-Path $bundleRoot $launcher) -Force }
        }
        if ($os.Name -ne 'windows') {
            Remove-Item -LiteralPath (Join-Path $bundleRoot 'tools\windows-launcher.cs') -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath (Join-Path $bundleRoot 'tools\install-windows.ps1') -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath (Join-Path $bundleRoot 'tools\start-companion.ps1') -Force -ErrorAction SilentlyContinue
        }
        [IO.Compression.ZipFile]::CreateFromDirectory($bundleRoot, $os.Zip, [IO.Compression.CompressionLevel]::Optimal, $true)
    }
} finally {
    if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
}

$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
& $nodeExe (Join-Path $PSScriptRoot 'set-zip-permissions.mjs') $runtimeZip $windowsZip $macosZip $linuxZip $sourceZip
if ($LASTEXITCODE -ne 0) { throw 'Failed to apply POSIX permissions to release ZIP archives.' }

$checksums = foreach ($file in @((Join-Path $OutputDirectory $vsix),$runtimeZip,$windowsZip,$macosZip,$linuxZip,$sourceZip)) {
    ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()) + '  ' + (Split-Path -Leaf $file)
}
[IO.File]::WriteAllLines((Join-Path $OutputDirectory 'SHA256SUMS.txt'), $checksums, [Text.UTF8Encoding]::new($false))
Write-Output ("Prepared v" + $version + " upload files: " + $OutputDirectory)
