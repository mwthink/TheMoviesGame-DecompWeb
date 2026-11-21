# Starts MoviesSE.exe with TheMoviesDebugger.dll injected at the entry point, optionally under the coverage tracer, and takes a
# screenshot every 15 seconds. Run through run_interactive.ps1.
#   -Coverage   plant the first-call tracer (coverage_functions.txt) and the this-class log (coverage_this.txt)
#   -Seconds N  how long to watch (the game keeps running afterwards unless -Kill)
param([switch]$Coverage, [int]$Seconds = 90, [switch]$Kill, [switch]$KeepFlags, [string]$Fullscreen = '0', [string]$Compat = '~ DISABLEDXMAXIMIZEDWINDOWEDMODE HIGHDPIAWARE', [string]$Tag = 'run')
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib_win.ps1"
$game = 'C:\Games\TheMovies'; $repo = 'C:\dev\OpenTheMoviesGame'; $build = "$repo\debugger\build\RelWithDebInfo"
Get-Process MoviesSE -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1
if (-not $KeepFlags) { Clear-GameFlags }
if ($Compat) { Set-GameCompat -Flags $Compat }
Set-GameConfig 'Fullscreen' $Fullscreen   # this machine's display has a single mode (1280x800): the game's own fullscreen modes fail
Start-Sleep -Seconds 2
Copy-Item "$build\*.dll", "$build\TheMoviesInjector.exe" $game -Force
Remove-Item "$game\coverage_log.csv", "$game\coverage_this.csv", "$game\coverage_summary.txt" -ErrorAction SilentlyContinue
if ($Coverage) {
    Copy-Item "$repo\tools\coverage_functions.txt" "$game\coverage_functions.txt" -Force
    Set-Content -Path "$game\coverage_this.txt" -Value "6`r`n64"
} else {
    Remove-Item "$game\coverage_functions.txt", "$game\coverage_this.txt" -ErrorAction SilentlyContinue
}
Write-Output '--- registry before'; reg query 'HKCU\Software\Lionhead Studios Ltd\TheMovies' /s 2>&1 | Select-Object -First 60
Set-Location $game
& "$game\TheMoviesInjector.exe" --launch "$game\MoviesSE.exe" "$game\TheMoviesDebugger.dll"
Write-Output "injector exit code: $LASTEXITCODE"
$shots = "C:\dev\logs\shots\$Tag"; New-Item -ItemType Directory -Force $shots | Out-Null
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$t0 = Get-Date; $i = 0; $lastShot = [datetime]::MinValue
while (((Get-Date) - $t0).TotalSeconds -lt $Seconds) {
    $p = Get-Process MoviesSE -ErrorAction SilentlyContinue
    if ($p) { Close-ProcessDialogs | ForEach-Object { Write-Output $_ } }
    if (((Get-Date) - $lastShot).TotalSeconds -ge 15 -or -not $p) {
        $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
        $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
        $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
        $shotPath = '{0}\{1:D3}.png' -f $shots, $i
        $bmp.Save($shotPath, [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
        Write-Output ("t={0:N0}s shot {1}  MoviesSE alive: {2}  title: '{3}'" -f ((Get-Date) - $t0).TotalSeconds, $i, [bool]$p, $(if ($p) { $p.MainWindowTitle }))
        $i++; $lastShot = Get-Date
    }
    if (-not $p) { break }
    Start-Sleep -Seconds 2
}
Write-Output '--- registry after'; reg query 'HKCU\Software\Lionhead Studios Ltd\TheMovies' /s 2>&1 | Select-Object -First 60
if ($Kill) { Get-Process MoviesSE -ErrorAction SilentlyContinue | Stop-Process -Force }
Get-ChildItem $game -Filter coverage_* | Select-Object Name, Length
Get-ChildItem "$game\*.log", "$game\*.json", "$game\*.txt" -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt $t0 } | Select-Object Name, Length
