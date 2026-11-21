# Sets the "large address aware" flag in MoviesSE.exe (what the NTCore 4GB Patch does), as PCGamingWiki recommends: the game
# crashes on Windows 10/11 when a new game is created without it. Only PE header bytes change, no code, so every address stays
# the same. The untouched file is kept as MoviesSE.exe.orig (SHA-256 48f909d7...566a).
$ErrorActionPreference = 'Stop'
$game = 'C:\Games\TheMovies'
Get-Process MoviesSE -ErrorAction SilentlyContinue | Stop-Process -Force
if (-not (Test-Path "$game\MoviesSE.exe.orig")) { Copy-Item "$game\MoviesSE.exe" "$game\MoviesSE.exe.orig" }
Start-Sleep -Seconds 2
foreach ($f in 'MoviesSE.exe', 'MoviesSE.exe.orig') { Set-ItemProperty -Path "$game\$f" -Name IsReadOnly -Value $false }   # the install marks the exe read-only
Copy-Item "$game\MoviesSE.exe.orig" "$game\MoviesSE.exe" -Force            # always patch from the original
Set-ItemProperty -Path "$game\MoviesSE.exe" -Name IsReadOnly -Value $false
$vcvars = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars32.bat"
cmd /c "`"$vcvars`" >nul && editbin /nologo /LARGEADDRESSAWARE `"$game\MoviesSE.exe`""
if ($LASTEXITCODE -ne 0) { throw "editbin failed ($LASTEXITCODE)" }
$a = [IO.File]::ReadAllBytes("$game\MoviesSE.exe.orig"); $b = [IO.File]::ReadAllBytes("$game\MoviesSE.exe")
$diff = for ($i = 0; $i -lt [Math]::Min($a.Length, $b.Length); $i++) { if ($a[$i] -ne $b[$i]) { '{0:X}' -f $i } }
"sizes: {0} -> {1}; differing bytes: {2} at offsets: {3}" -f $a.Length, $b.Length, @($diff).Count, ((@($diff) | Select-Object -First 12) -join ' ')
"orig  sha256: " + (Get-FileHash "$game\MoviesSE.exe.orig" -Algorithm SHA256).Hash
"patch sha256: " + (Get-FileHash "$game\MoviesSE.exe" -Algorithm SHA256).Hash
# is the .text section byte-identical? (PE header is the only expected difference)
$pe = [BitConverter]::ToInt32($a, 0x3C); $first = $a[$pe + 24 + 224 + 20..($pe + 24 + 224 + 23)]
"LAA flag now: " + ((([BitConverter]::ToUInt16($b, $pe + 22)) -band 0x20) -ne 0)
