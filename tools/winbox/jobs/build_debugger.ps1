# Builds debugger/ (32-bit MSVC + vcpkg MinHook). Run through run_interactive.ps1 (needs the PATH of a fresh logon).
$ErrorActionPreference = 'Stop'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$env:VCPKG_ROOT = 'C:\dev\vcpkg'
Set-Location C:\dev\OpenTheMoviesGame\debugger
cmake --version | Select-Object -First 1
cmake -B build -A Win32 "-DCMAKE_TOOLCHAIN_FILE=C:/dev/vcpkg/scripts/buildsystems/vcpkg.cmake"
if ($LASTEXITCODE -ne 0) { throw "configure failed ($LASTEXITCODE)" }
cmake --build build --config RelWithDebInfo
if ($LASTEXITCODE -ne 0) { throw "build failed ($LASTEXITCODE)" }
Get-ChildItem build\RelWithDebInfo | Where-Object Extension -in '.dll', '.exe' | Select-Object Name, Length
