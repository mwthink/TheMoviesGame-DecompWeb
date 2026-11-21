<#
 Runs a PowerShell script in the logged-in console session (elevated) through a scheduled task, and optionally waits for it.
 SSH logons have no desktop; anything that needs one (the game, screenshots, key presses) or that must outlive the SSH
 connection (long installs) goes through here.

   powershell -NoProfile -ExecutionPolicy Bypass -File run_interactive.ps1 -Name install -ScriptPath C:\dev\jobs\install.ps1 [-Wait] [-TimeoutSec 3600] [-ScriptArgs "-Tools"]

 Output of the script (stdout and stderr) goes to C:\dev\logs\<Name>.log; with -Wait the log is printed when the task ends.
 Needs a logged-in console session for the account (auto-logon provides it).
#>
param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$ScriptPath,
    [string]$ScriptArgs = '',
    [switch]$Wait,
    [int]$TimeoutSec = 3600,
    [switch]$NoElevate
)
$ErrorActionPreference = 'Stop'
$logDir = 'C:\dev\logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir "$Name.log"
Remove-Item $log -ErrorAction SilentlyContinue
$user = "$env:COMPUTERNAME\$env:USERNAME"
# powershell.exe with a hidden window (a visible cmd.exe window would sit on top of the game and swallow clicks)
$cmd = "& '$ScriptPath' $ScriptArgs *> '$log'"
$arg = "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -Command `"$cmd`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg
$level = if ($NoElevate) { 'Limited' } else { 'Highest' }
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel $level
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Seconds ($TimeoutSec + 600))
Unregister-ScheduledTask -TaskName "otm_$Name" -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "otm_$Name" -Action $action -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName "otm_$Name"
Write-Output "started task otm_$Name; log: $log"
if ($Wait) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    Start-Sleep -Seconds 2
    while ((Get-ScheduledTask -TaskName "otm_$Name").State -eq 'Running' -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 5 }
    $info = Get-ScheduledTaskInfo -TaskName "otm_$Name"
    Write-Output ("state: {0}, last result: {1}" -f (Get-ScheduledTask -TaskName "otm_$Name").State, $info.LastTaskResult)
    if (Test-Path $log) { Get-Content $log -Tail 60 }
}
