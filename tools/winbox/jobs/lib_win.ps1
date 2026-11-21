# Helpers for driving dialogs of a running process from the interactive session (dot-source this file).
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class W32 {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc p, IntPtr l);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    public const uint BM_CLICK = 0x00F5;
    public static string Text(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
    public static string Cls(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
    public static List<IntPtr> TopWindows(uint pid) {
        var r = new List<IntPtr>();
        EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) r.Add(h); return true; }, IntPtr.Zero);
        return r;
    }
    public static List<IntPtr> Children(IntPtr parent) {
        var r = new List<IntPtr>();
        EnumChildWindows(parent, (h, l) => { r.Add(h); return true; }, IntPtr.Zero);
        return r;
    }
}
'@

# Finds visible message-box style dialogs (class #32770) of the process, logs their text, and presses the first button whose
# caption matches one of $Prefer (default: Cancel, No). Returns the number of dialogs handled.
function Close-ProcessDialogs {
    param([string]$ProcessName = 'MoviesSE', [string[]]$Prefer = @('Cancel', 'No'),
          [string[]]$OkWhenTextMatches = @('first time you are running'))   # harmless notices that only need OK
    $handled = 0
    foreach ($proc in Get-Process $ProcessName -ErrorAction SilentlyContinue) {
        foreach ($w in [W32]::TopWindows([uint32]$proc.Id)) {
            if ([W32]::Cls($w) -ne '#32770') { continue }
            $kids = [W32]::Children($w)
            $texts = $kids | ForEach-Object { '{0}:{1}' -f [W32]::Cls($_), [W32]::Text($_) }
            Write-Output ("dialog '{0}': {1}" -f [W32]::Text($w), ($texts -join ' | '))
            $clicked = $false
            foreach ($want in $Prefer) {
                foreach ($k in $kids) {
                    if ([W32]::Cls($k) -eq 'Button' -and ([W32]::Text($k) -replace '&', '') -ieq $want) {
                        [void][W32]::SendMessage($k, [W32]::BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
                        Write-Output "  pressed '$want'"; $clicked = $true; $handled++; break
                    }
                }
                if ($clicked) { break }
            }
            if (-not $clicked) {
                $all = ($texts -join ' ')
                foreach ($pat in $OkWhenTextMatches) {
                    if ($all -match $pat) {
                        foreach ($k in $kids) {
                            if ([W32]::Cls($k) -eq 'Button' -and ([W32]::Text($k) -replace '&', '') -ieq 'OK') {
                                [void][W32]::SendMessage($k, [W32]::BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
                                Write-Output "  pressed 'OK' (notice matching '$pat')"; $clicked = $true; $handled++; break
                            }
                        }
                    }
                    if ($clicked) { break }
                }
            }
            if (-not $clicked) { Write-Output '  no matching button' }
        }
    }
    return $handled
}

# The game writes "Game running:" = Yes and "OpenDx" = Yes into its registry key at start-up and clears them on a clean exit /
# after Direct3D opened. A stale value from an earlier run shows the "did not shut down properly" and "DirectX" dialogs.
function Clear-GameFlags {
    $k = 'HKCU:\Software\Lionhead Studios Ltd\TheMovies'
    foreach ($n in 'Game running:', 'OpenDx') { Remove-ItemProperty -Path $k -Name $n -ErrorAction SilentlyContinue }
    Write-Output 'cleared stale Game running / OpenDx flags'
}

# The game's own settings live as REG_SZ values under this key ("Fullscreen" = 0/1, "Audio Off" = 0/1, ...).
function Set-GameConfig {
    param([string]$Name, [string]$Value)
    $k = 'HKCU:\Software\Lionhead Studios Ltd\TheMovies'
    New-Item -Path $k -Force | Out-Null
    New-ItemProperty -Path $k -Name $Name -Value $Value -PropertyType String -Force | Out-Null
    Write-Output "game config: $Name = $Value"
}

# Per-application compatibility flags for MoviesSE.exe (what "Properties > Compatibility" writes): "Disable fullscreen
# optimizations" and the high-DPI override are the commonly needed settings for The Movies on current Windows (mouse input).
function Set-GameCompat {
    param([string]$Flags = '~ DISABLEDXMAXIMIZEDWINDOWEDMODE HIGHDPIAWARE', [string]$Exe = 'C:\Games\TheMovies\MoviesSE.exe')
    $k = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\AppCompat Flags\Layers'
    New-Item -Path $k -Force | Out-Null
    New-ItemProperty -Path $k -Name $Exe -Value $Flags -PropertyType String -Force | Out-Null
    Write-Output "compat flags for $Exe : $Flags"
}
