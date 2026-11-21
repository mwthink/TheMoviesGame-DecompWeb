# Sends mouse and keyboard input to the console desktop. Run through run_interactive.ps1.
#   -Action click|dblclick|move|key|scroll|rightclick   absolute cursor position (SetCursorPos)
#           rmove|rclick   RELATIVE mouse motion (-X/-Y are deltas; rclick = move then click): the game reads the mouse through DirectInput and ignores SetCursorPos
#           press|release  hold / release the left button (drags)   -X/-Y screen coordinates (as in screenshots)   -Keys "{F9}" or "abc" (SendKeys syntax)
param([Parameter(Mandatory)][ValidateSet('click', 'dblclick', 'move', 'key', 'scroll', 'rightclick', 'rmove', 'rclick', 'press', 'release', 'focus', 'clickat')][string]$Action,
      [int]$X = 0, [int]$Y = 0, [string]$Keys = '', [int]$Amount = 0, [switch]$Focus, [int]$Step = 3)   # -Step: pixels per mouse event for relative moves (small = no pointer acceleration)
Add-Type -AssemblyName System.Windows.Forms
. "$PSScriptRoot\lib_input.ps1"
if ($Focus -and $Action -ne 'focus') {      # give the game the foreground in the same process as the input
    $gp = Get-Process MoviesSE -ErrorAction SilentlyContinue
    if ($gp) {
        [In]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [In]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
        [void][In]::ShowWindow($gp.MainWindowHandle, 9); [void][In]::SetForegroundWindow($gp.MainWindowHandle); Start-Sleep -Milliseconds 400
    }
}
if ($Action -eq 'clickat') { Click-At $X $Y; Write-Output "clickat $X,$Y"; exit }
switch ($Action) {
    'rmove'      { $dx = $X; $dy = $Y; while ($dx -ne 0 -or $dy -ne 0) { $sx = [Math]::Max(-$Step, [Math]::Min($Step, $dx)); $sy = [Math]::Max(-$Step, [Math]::Min($Step, $dy)); [In]::mouse_event(1, $sx, $sy, 0, [UIntPtr]::Zero); $dx -= $sx; $dy -= $sy; Start-Sleep -Milliseconds 6 } }
    'rclick'     { $dx = $X; $dy = $Y; while ($dx -ne 0 -or $dy -ne 0) { $sx = [Math]::Max(-$Step, [Math]::Min($Step, $dx)); $sy = [Math]::Max(-$Step, [Math]::Min($Step, $dy)); [In]::mouse_event(1, $sx, $sy, 0, [UIntPtr]::Zero); $dx -= $sx; $dy -= $sy; Start-Sleep -Milliseconds 6 }
                   Start-Sleep -Milliseconds 200; [In]::mouse_event([In]::LD, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 100; [In]::mouse_event([In]::LU, 0, 0, 0, [UIntPtr]::Zero) }
    'focus'      { $p = Get-Process MoviesSE -ErrorAction Stop; $h = $p.MainWindowHandle
                   [In]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [In]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)   # a tap of Alt lets SetForegroundWindow through
                   [void][In]::ShowWindow($h, 9); [void][In]::BringWindowToTop($h); [void][In]::SetForegroundWindow($h)
                   Start-Sleep -Milliseconds 300
                   Write-Output ("foreground is the game: {0}" -f ([In]::GetForegroundWindow() -eq $h)) }
    'press'      { [In]::mouse_event([In]::LD, 0, 0, 0, [UIntPtr]::Zero) }
    'release'    { [In]::mouse_event([In]::LU, 0, 0, 0, [UIntPtr]::Zero) }
    'move'       { [void][In]::SetCursorPos($X, $Y) }
    'click'      { [void][In]::SetCursorPos($X, $Y); Start-Sleep -Milliseconds 150; [In]::mouse_event([In]::LD, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 80; [In]::mouse_event([In]::LU, 0, 0, 0, [UIntPtr]::Zero) }
    'dblclick'   { [void][In]::SetCursorPos($X, $Y); Start-Sleep -Milliseconds 150
                   foreach ($i in 1, 2) { [In]::mouse_event([In]::LD, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [In]::mouse_event([In]::LU, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 90 } }
    'rightclick' { [void][In]::SetCursorPos($X, $Y); Start-Sleep -Milliseconds 150; [In]::mouse_event([In]::RD, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 80; [In]::mouse_event([In]::RU, 0, 0, 0, [UIntPtr]::Zero) }
    'scroll'     { [void][In]::SetCursorPos($X, $Y); [In]::mouse_event([In]::WHEEL, 0, 0, $Amount, [UIntPtr]::Zero) }
    'key'        { [System.Windows.Forms.SendKeys]::SendWait($Keys) }
}
Write-Output "$Action $X,$Y $Keys"
