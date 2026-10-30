param([Parameter(Mandatory=$true)][string]$ControlFile,[Parameter(Mandatory=$true)][string]$ReleaseDir,[switch]$ServiceStopped,[string]$TaskName='Climb')
$ErrorActionPreference='Stop'
if(-not $ServiceStopped){throw 'Stop the app, take a consistent backup, then pass -ServiceStopped'}
if(-not [IO.Path]::IsPathRooted($ReleaseDir)){throw 'ReleaseDir must be absolute'}
$release=(Resolve-Path -LiteralPath $ReleaseDir).Path
$manifest=Get-Content -LiteralPath (Join-Path $release 'release.json') -Raw | ConvertFrom-Json
if(-not $manifest.complete -or $manifest.platform -ne 'win32-x64' -or -not (Test-Path -LiteralPath (Join-Path $release 'backend\dist\server.js'))){throw 'Release is not complete'}
if(Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue){$task=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue;if($task -and $task.State -eq 'Running'){throw 'Scheduled task is still running'}}
$path=(Resolve-Path -LiteralPath $ControlFile).Path
$control=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
$control.ReleaseDir=$release
$stamp=[Guid]::NewGuid().ToString('N')
$temp=$path+'.pending-'+$stamp
$previous=$path+'.previous-'+$stamp
[IO.File]::WriteAllText($temp,($control|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
[IO.File]::Replace($temp,$path,$previous)
Write-Output "Application pointer switched; previous pointer: $previous. Database and secrets were not replaced."
