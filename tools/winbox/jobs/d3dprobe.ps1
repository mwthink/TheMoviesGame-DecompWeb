# Builds and runs the Direct3D 9 probe (tools/winbox/probe/d3dprobe.cpp) with the 32-bit MSVC toolchain.
$ErrorActionPreference = 'Stop'
$out = 'C:\dev\probe'; New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item C:\dev\OpenTheMoviesGame\tools\winbox\probe\d3dprobe.cpp $out -Force
$vcvars = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars32.bat"
cmd /c "`"$vcvars`" >nul && cd /d $out && cl /nologo /EHsc d3dprobe.cpp d3d9.lib user32.lib"
if ($LASTEXITCODE -ne 0) { throw 'compile failed' }
& "$out\d3dprobe.exe"
