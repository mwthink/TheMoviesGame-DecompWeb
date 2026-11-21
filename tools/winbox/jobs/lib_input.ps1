# Mouse and keyboard helpers for driving MoviesSE.exe from the interactive session (dot-source this file).
# The game reads the mouse through DirectInput: absolute cursor positioning is ignored, only RELATIVE motion counts, and the
# game's cursor moves about 1.5 screen pixels per unit sent. Its cursor is clamped to the game window, so a large move in one
# direction parks it in a corner; Click-At uses that to click a given screen position reliably.
Add-Type -AssemblyName System.Windows.Forms
if (-not ('In' -as [type])) {
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class In {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, int data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    public const uint LD = 2, LU = 4, RD = 8, RU = 16, WHEEL = 0x800;
}
'@
}
$script:Gain = 1.5            # screen pixels the game cursor moves per mouse unit
$script:CornerX = 1038        # bottom-right corner of the game's client area on screen (window at the default position)
$script:CornerY = 805

function Focus-Game {
    $p = Get-Process MoviesSE -ErrorAction SilentlyContinue
    if (-not $p) { return $false }
    [In]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [In]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)   # an Alt tap lets SetForegroundWindow through
    [void][In]::ShowWindow($p.MainWindowHandle, 9); [void][In]::SetForegroundWindow($p.MainWindowHandle)
    Start-Sleep -Milliseconds 400
    return ([In]::GetForegroundWindow() -eq $p.MainWindowHandle)
}
function Move-Rel([int]$dx, [int]$dy, [int]$step = 4) {
    while ($dx -ne 0 -or $dy -ne 0) {
        $sx = [Math]::Max(-$step, [Math]::Min($step, $dx)); $sy = [Math]::Max(-$step, [Math]::Min($step, $dy))
        [In]::mouse_event(1, $sx, $sy, 0, [UIntPtr]::Zero); $dx -= $sx; $dy -= $sy; Start-Sleep -Milliseconds 6
    }
}
function Click-Left { Start-Sleep -Milliseconds 200; [In]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 100; [In]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero) }
# Park the cursor in the bottom-right corner, then move to screen position (x, y) and click.
function Click-At([int]$x, [int]$y, [switch]$NoClick) {
    [void](Focus-Game)
    Move-Rel 1700 1100 6
    Move-Rel ([int][Math]::Round(($x - $script:CornerX) / $script:Gain)) ([int][Math]::Round(($y - $script:CornerY) / $script:Gain)) 4
    if (-not $NoClick) { Click-Left }
}
function Send-Keys([string]$keys) { [void](Focus-Game); [System.Windows.Forms.SendKeys]::SendWait($keys) }

# Holds a virtual key long enough for a 50 ms GetAsyncKeyState poll to see it (SendKeys is too short for the tracer's hotkeys).
function Hold-Key([byte]$vk, [int]$ms = 250) {
    [In]::keybd_event($vk, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds $ms; [In]::keybd_event($vk, 0, 2, [UIntPtr]::Zero)
}
