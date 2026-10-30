param([Parameter(Mandatory=$true)][string]$ControlFile)
$ErrorActionPreference = 'Stop'
$control = Get-Content -LiteralPath $ControlFile -Raw | ConvertFrom-Json
foreach ($path in @($control.ReleaseDir,$control.EnvFile,$control.NodeExe)) { if (-not [IO.Path]::IsPathRooted($path) -or -not (Test-Path -LiteralPath $path)) { throw 'Control paths must exist and be absolute' } }
$release = (Resolve-Path -LiteralPath $control.ReleaseDir).Path
if (-not (Test-Path -LiteralPath (Join-Path $release 'release.json'))) { throw 'Incomplete release' }
$version = & $control.NodeExe '--version'
if ($LASTEXITCODE -or $version -notmatch '^v24\.') { throw 'Node.js 24 is required; do not build dependencies on the server' }
$env:WEB_ROOT = Join-Path $release 'web'
$env:NODE_ENV = 'production'
$env:COOKIE_SECURE = 'true'
Push-Location (Join-Path $release 'backend')
try {
  & $control.NodeExe '--max-old-space-size=256' "--env-file=$($control.EnvFile)" (Join-Path $release 'backend\dist\server.js')
  $result = $LASTEXITCODE
} finally { Pop-Location }
exit $result
