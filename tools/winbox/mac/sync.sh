#!/bin/bash
# Copies the pieces of the repository the box needs. Usage: BOX=user@host tools/winbox/mac/sync.sh
set -e
: "${BOX:?set BOX=user@host}"
cd "$(dirname "$0")/../../.."
ssh -o BatchMode=yes "$BOX" 'cmd /c "mkdir C:\dev\OpenTheMoviesGame\tools\winbox\jobs 2>nul & mkdir C:\dev\OpenTheMoviesGame\tools\winbox\probe 2>nul & mkdir C:\dev\OpenTheMoviesGame\debugger\src 2>nul"' >/dev/null || true
scp -o BatchMode=yes -r tools/winbox/jobs/*.ps1 "$BOX:C:/dev/OpenTheMoviesGame/tools/winbox/jobs/"
scp -o BatchMode=yes tools/winbox/*.ps1 "$BOX:C:/dev/OpenTheMoviesGame/tools/winbox/"
scp -o BatchMode=yes tools/winbox/probe/*.cpp "$BOX:C:/dev/OpenTheMoviesGame/tools/winbox/probe/"
scp -o BatchMode=yes tools/winbox/run_interactive.ps1 "$BOX:C:/dev/run_interactive.ps1"
scp -o BatchMode=yes tools/winbox/status.ps1 "$BOX:C:/dev/status.ps1"
scp -o BatchMode=yes -r debugger/src debugger/CMakeLists.txt debugger/vcpkg.json debugger/injector "$BOX:C:/dev/OpenTheMoviesGame/debugger/"
scp -o BatchMode=yes tools/coverage_functions.txt "$BOX:C:/dev/OpenTheMoviesGame/tools/"
echo synced
