param([Parameter(Mandatory=$true)][string]$ControlFile,[string]$TaskName='Climb',[switch]$PreviewOnly)
$ErrorActionPreference='Stop'
$control=(Resolve-Path -LiteralPath $ControlFile).Path
$script=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'Start-Climb.ps1')).Path
if($control.Contains('"') -or $script.Contains('"')){throw 'Invalid paths'}
$arguments='-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$script+'" -ControlFile "'+$control+'"'
if(Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue){throw 'Task exists; review before replacing'}
$action=New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $arguments
$trigger=New-ScheduledTaskTrigger -AtStartup
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal=New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount -RunLevel Limited
$definition=New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal
if($PreviewOnly){Write-Output "Task definition constructed: $TaskName; account: LOCAL SERVICE; trigger: startup; restart: 1 minute; duplicate instances: IgnoreNew";Write-Output $arguments;exit 0}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if(-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Task registration requires an administrator PowerShell; preview does not register a task'}
Register-ScheduledTask -TaskName $TaskName -InputObject $definition | Out-Null
