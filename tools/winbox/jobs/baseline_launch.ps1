# Starts MoviesSE.exe WITHOUT the debugger DLL, logs every dialog it shows (pressing Cancel/No on the "improper shutdown" kind),
# takes screenshots and reports how the process ended. Use it to find out why the game does not boot on this machine.
param([int]$Seconds = 60, [string]$Tag = 'baseline', [switch]$Kill, [switch]$KeepFlags, [string]$Fullscreen = '0', [string]$Compat = '~ DISABLEDXMAXIMIZEDWINDOWEDMODE HIGHDPIAWARE')
$ErrorActionPreference = 'Continue'
. "$PSScriptRoot\lib_win.ps1"
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$game = 'C:\Games\TheMovies'
Get-Process MoviesSE -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1
if (-not $KeepFlags) { Clear-GameFlags }
if ($Compat) { Set-GameCompat -Flags $Compat }
Set-GameConfig 'Fullscreen' $Fullscreen   # this machine's display has a single mode (1280x800): the game's own fullscreen modes fail
Write-Output '--- registry before'; reg query 'HKCU\Software\Lionhead Studios Ltd\TheMovies' /s 2>&1 | Select-Object -First 40
$t0 = Get-Date
$p = Start-Process -FilePath "$game\MoviesSE.exe" -WorkingDirectory $game -PassThru
Write-Output "started pid $($p.Id)"
$shots = "C:\dev\logs\shots\$Tag"; New-Item -ItemType Directory -Force $shots | Out-Null
$i = 0; $last = [datetime]::MinValue
while (((Get-Date) - $t0).TotalSeconds -lt $Seconds) {
    $alive = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
    if ($alive) { Close-ProcessDialogs -ProcessName 'MoviesSE' | ForEach-Object { Write-Output $_ } }
    if (((Get-Date) - $last).TotalSeconds -ge 10 -or -not $alive) {
        $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
        $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
        $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
        $bmp.Save(('{0}\{1:D3}.png' -f $shots, $i), [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
        Write-Output ("t={0:N0}s shot {1} alive={2} windowTitle='{3}'" -f ((Get-Date) - $t0).TotalSeconds, $i, [bool]$alive, $(if ($alive) { $alive.MainWindowTitle }))
        $i++; $last = Get-Date
    }
    if (-not $alive) { break }
    Start-Sleep -Seconds 1
}
$p.Refresh()
if ($p.HasExited) { Write-Output "process exited with code $($p.ExitCode)" } else { Write-Output 'process still running' }
if ($Kill) { Get-Process MoviesSE -ErrorAction SilentlyContinue | Stop-Process -Force }
Write-Output '--- registry after'; reg query 'HKCU\Software\Lionhead Studios Ltd\TheMovies' /s 2>&1 | Select-Object -First 40
Write-Output '--- application event log (last 5 minutes)'
Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $t0.AddMinutes(-1) } -ErrorAction SilentlyContinue |
    Where-Object { $_.Message -match 'MoviesSE|d3d9|OpenAL' } | Select-Object -First 5 TimeCreated, Id, @{n='msg';e={$_.Message.Substring(0, [math]::Min(400, $_.Message.Length))}} | Format-List | Out-String
Get-ChildItem $game -File | Where-Object { $_.LastWriteTime -gt $t0 } | Select-Object Name, Length
