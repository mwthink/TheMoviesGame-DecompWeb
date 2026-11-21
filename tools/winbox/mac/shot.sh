#!/bin/bash
# Screenshot of the box's desktop -> data/runtime/shots/<name>.png (prints the path). Usage: BOX=user@host shot.sh <name>
: "${BOX:?set BOX=user@host}"
cd "$(dirname "$0")/../../.."
mkdir -p data/runtime/shots
ssh -o BatchMode=yes "$BOX" "powershell -NoProfile -ExecutionPolicy Bypass -File C:\\dev\\run_interactive.ps1 -Name shot -ScriptPath C:\\dev\\OpenTheMoviesGame\\tools\\winbox\\jobs\\screenshot.ps1 -ScriptArgs \"-Path C:\\dev\\logs\\shots\\cur.png\" -Wait -TimeoutSec 60" >/dev/null 2>&1
scp -o BatchMode=yes "$BOX:C:/dev/logs/shots/cur.png" "data/runtime/shots/$1.png" >/dev/null 2>&1 && echo "data/runtime/shots/$1.png"
