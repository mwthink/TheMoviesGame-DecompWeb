# From the main menu: Game > Quick Start > accept the studio name. Screen positions are for the default window placement
# (windowed, 1280x800 desktop). Takes a screenshot after each step into C:\dev\logs\shots\newgame.
param([int]$Pause = 4)
. "$PSScriptRoot\lib_input.ps1"
Add-Type -AssemblyName System.Drawing
$dir = 'C:\dev\logs\shots\newgame'; New-Item -ItemType Directory -Force $dir | Out-Null
function Snap($n) {
    $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
    $bmp.Save("$dir\$n.png", [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
}
Write-Output "focus: $(Focus-Game)"
Send-Keys '{F9}'; Write-Output 'F9 marker (main menu reached)'
Snap 0
Click-At 130 355;  Write-Output 'clicked Game';        Start-Sleep -Seconds $Pause; Snap 1
Click-At 277 601;  Write-Output 'clicked Quick Start'; Start-Sleep -Seconds ($Pause + 2); Snap 2
Click-At 695 645;  Write-Output 'clicked accept';      Start-Sleep -Seconds $Pause; Snap 3
Write-Output 'done'
