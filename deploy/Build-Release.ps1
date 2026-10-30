param([string]$ReleaseName = ('climb-' + (Get-Date -Format 'yyyyMMdd-HHmmss')))
$ErrorActionPreference = 'Stop'
if ($ReleaseName -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Invalid release name' }
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$release = Join-Path $workspace "outputs\deploy\$ReleaseName"
if (Test-Path -LiteralPath $release) { throw 'Release already exists; never merge or overwrite a release' }
Push-Location (Join-Path $workspace 'demo\web')
try { & npm.cmd run build; if ($LASTEXITCODE) { throw 'Frontend build failed' } } finally { Pop-Location }
Push-Location (Join-Path $workspace 'demo\backend')
try { & npm.cmd run build; if ($LASTEXITCODE) { throw 'Backend build failed' } } finally { Pop-Location }
New-Item -ItemType Directory -Path (Join-Path $release 'backend') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $workspace 'demo\web\dist') -Destination (Join-Path $release 'web') -Recurse
Copy-Item -LiteralPath (Join-Path $workspace 'demo\backend\dist') -Destination (Join-Path $release 'backend\dist') -Recurse
foreach ($name in @('package.json','package-lock.json')) { Copy-Item -LiteralPath (Join-Path $workspace "demo\backend\$name") -Destination (Join-Path $release "backend\$name") }
New-Item -ItemType Directory -Path (Join-Path $release 'operations') | Out-Null
foreach ($name in @('Start-Climb.ps1','Register-StartupTask.ps1','Switch-Release.ps1','runtime.env.example','current.example.json')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $release "operations\$name") }
Push-Location (Join-Path $release 'backend')
try { & npm.cmd ci --omit=dev --offline; if ($LASTEXITCODE) { throw 'Production dependency installation failed; release is incomplete' } } finally { Pop-Location }
$manifest = @{ release=$ReleaseName; createdAt=(Get-Date).ToUniversalTime().ToString('o'); nodeMajor=24; platform='win32-x64'; schemaVersion=3; complete=$true }
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $release 'release.json') -Encoding UTF8
Get-ChildItem -LiteralPath $release -Recurse -File | ForEach-Object { '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash, $_.FullName.Substring($release.Length+1) } | Set-Content -LiteralPath (Join-Path $release 'SHA256SUMS.txt') -Encoding UTF8
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=$release+'.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($release,$archive,[IO.Compression.CompressionLevel]::Optimal,$true)
Get-FileHash -LiteralPath $archive -Algorithm SHA256 | ForEach-Object { $_.Hash+'  '+[IO.Path]::GetFileName($archive) } | Set-Content -LiteralPath ($archive+'.sha256') -Encoding ASCII
Write-Output "Release ready: $release"
Write-Output "Transfer archive: $archive"
