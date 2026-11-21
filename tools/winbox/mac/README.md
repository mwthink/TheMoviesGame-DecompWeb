# Mac-side helpers for the Windows test box

All scripts need `BOX=<user>@<host>` in the environment (the account on the box, key login: `ssh -o BatchMode=yes $BOX ...`).
They assume the repository was copied to `C:\dev\OpenTheMoviesGame` on the box (`sync.sh`) and that `run_interactive.ps1` was copied
to `C:\dev\run_interactive.ps1` (`sync.sh` does that too).

| script | what it does |
|---|---|
| `sync.sh` | copies `tools/winbox`, `debugger/src`, `debugger/CMakeLists.txt`, `tools/coverage_functions.txt` to the box |
| `wj.sh <name> <job.ps1> '<args>'` | runs `tools/winbox/jobs/<job.ps1>` in the console session through a scheduled task and prints its log (`TIMEOUT=3000` for long jobs) |
| `shot.sh <name>` | takes a screenshot of the box's desktop and saves it as `data/runtime/shots/<name>.png` |
| `pull_logs.sh <run name>` | copies `coverage_log.csv`, `coverage_this.csv`, `decade_log.csv` from the game folder to `data/runtime/<run name>/` |
| `status.ps1` (in `tools/winbox/`) | on the box: state of a scheduled task and the matching lines of its log |

Quoting: pass PowerShell scripts with `-File` (a command string through ssh goes through cmd.exe first and breaks on `|` and `"`).
