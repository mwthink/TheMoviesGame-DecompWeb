# The Windows test box

A Windows PC that runs the original `MoviesSE.exe` with the debugger DLL (`debugger/`) injected, driven over SSH from the Mac. It is one of the
two places the original game runs for this project; the other is CrossOver on the Mac (`WINE_CROSSOVER.md`). The box runs x86 natively and
supports every debugger mode (the `this`-class tracer needs the CPU trap flag, which Rosetta does not have), so it is the reference when Wine and
the box disagree.

What it is used for: first-call coverage traces (`ANALYSIS_TOOLS.md`), the `this`-class log, `decade_log.csv` runs that verify the
reimplementation's formulas, and scripted sessions (new game, hotkeys, screenshots) that need no one at the keyboard.

## The box as built

- Windows 11 Pro 24H2 (build 26100), x86-64, **no GPU**: the Microsoft Basic Render Driver (WARP). The game runs windowed under software Direct3D.
- One administrator account that runs both SSH and the console desktop, with auto-logon so the desktop always exists. Key login only.
- The layout `tools/winbox/setup_box.ps1` creates, which the scripts assume: tools, the repository copy and logs under `C:\dev`
  (`C:\dev\OpenTheMoviesGame`, `C:\dev\logs`, `C:\dev\vcpkg`), the game in `C:\Games\TheMovies`.
- The game is patch 1.2 with the large-address-aware flag set (`tools/winbox/jobs/patch_laa.ps1`; the original is kept as `MoviesSE.exe.orig`,
  SHA-256 `48f909d7f89051ff0d3277f7dc0aa7c65cd1c92015542fcbc3d5f86700b1566a`).

The host and account are the owner's; the scripts take them from `BOX=<user>@<host>`. Security settings (SSH, firewall, Defender, auto-logon, RDP) are
set by the owner with `setup_box.ps1`, not by the scripts that drive the game.

## A session

`tools/winbox/mac/README.md` explains each helper.

```
export BOX=<user>@<host>
tools/winbox/mac/sync.sh                                         # push scripts, debugger sources, coverage_functions.txt
tools/winbox/mac/wj.sh build build_debugger.ps1 ''               # MSVC x86 + vcpkg MinHook
TIMEOUT=3000 tools/winbox/mac/wj.sh cov launch_game.ps1 '-Coverage -Seconds 2400 -Tag cov' &    # game + tracer, keeps running
tools/winbox/mac/wj.sh ng new_game.ps1 '-Pause 5'                # menu > Game > Quick Start > accept (once the menu is up)
tools/winbox/mac/wj.sh hk hotkey.ps1 '-Key F8'                   # F8 re-arm (steady-state set), F9 marker, F10 summary
tools/winbox/mac/shot.sh now                                     # screenshot -> data/runtime/shots/now.png
tools/winbox/mac/pull_logs.sh <run>                              # logs -> data/runtime/<run>/
```

Stop the game with `Get-Process MoviesSE | Stop-Process -Force` on the box (the launch job leaves it running unless given `-Kill`).

Click coordinates in `new_game.ps1` and `lib_input.ps1` (`CornerX`/`CornerY`, the mouse gain) assume the default window placement on a 1280 x 800 desktop.

## What it took to run the game (all found by running it)

- **Stale registry flags** in `HKCU\Software\Lionhead Studios Ltd\TheMovies`. The game writes `Game running:` = Yes at start and `OpenDx` = Yes just before
  opening Direct3D, and clears them on a clean exit and once Direct3D is open. A stale value shows the "did not shut down properly" prompt or the "old version
  of DirectX" dialog. The launch scripts delete both first.
- **Windowed mode.** Fullscreen fails when the display has a single mode (the Basic Render Driver offers only 1280 x 800): `CreateDevice` rejects 800 x 600 and
  1024 x 768 fullscreen. The registry value `Fullscreen` = `0` gives a window, which works under WARP.
- **OpenAL** must be installed (Creative's `oalinst.exe`, signed; `jobs/install_openal.ps1`).
- **Large-address-aware flag**: without it the game crashes with an access violation in a `rep movsl` copy right after a new studio loads (a known crash,
  documented on PCGamingWiki). Four header bytes change (the flag and the checksum).
- **The mouse** is DirectInput: absolute cursor positioning is ignored, only relative motion counts (about 1.5 screen pixels per unit), and the cursor is clamped
  to the window, so a scripted click first parks the cursor in a corner (`lib_input.ps1`). The compatibility flags "disable fullscreen optimizations" and the
  high-DPI override are needed for it to work at all (`lib_win.ps1`).
- The "first time you are running" notice appears at every start; the helper presses OK.
- **Running jobs**: SSH logons have no desktop, so anything that needs the game or the screen runs as a scheduled task in the logged-in console session
  (`run_interactive.ps1`), hidden (a visible console window covers the game). Tracer hotkeys need a held key (`hotkey.ps1`), not `SendKeys`.
- **SSH quoting**: a command string goes through `cmd.exe` first, where `|` and quotes break; pass PowerShell scripts as `-File`. `winget` needs `--source winget`
  (the msstore source failed with a certificate error on this network).

## Building another box

The checklist, for a fresh machine. `setup_box.ps1` automates most of it (`-Exclusions`, `-Tools`, ...).

**Machine.** x86-64 Windows 10 or 11 (not Windows on ARM: the debugger patches machine code, and an emulated x86 makes those measurements unreliable). A real
Direct3D 9 GPU is better but not required (the box above has none). 4 cores, 8 GB RAM, 80 GB free disk (the game about 2.5 GB, Visual Studio Build Tools about
8 GB, logs and saves). A spare PC, a VM on your own hypervisor or a cloud Windows instance all work; treat it as a throwaway machine with nothing personal on it,
and take a snapshot once it is ready.

**Access.** OpenSSH Server with key-only login (`PasswordAuthentication no`; administrators' keys go in `C:\ProgramData\ssh\administrators_authorized_keys`,
a standard user's in `C:\Users\<user>\.ssh\authorized_keys`). Reachable over a private network (LAN, Tailscale or a VPN), never an internet-facing port; allow
SSH only on that interface.

**An interactive desktop.** A game cannot render from an SSH session. Auto-logon the account at boot (Sysinternals `Autologon64.exe`), disable the lock screen,
screen saver, display sleep and sleep (`powercfg /change monitor-timeout-ac 0`, `powercfg /change standby-timeout-ac 0`). Do not watch it over Remote Desktop:
disconnecting can lock the session and break Direct3D; use a console-session tool (Sunshine/Moonlight, TightVNC) or a monitor. Add Defender exclusions for
`C:\Games` and `C:\dev`: injecting a DLL into a suspended process looks like malware to real-time protection.

**Software** (elevated PowerShell, reboot once at the end):

```powershell
winget install --source winget --id Git.Git -e
winget install --source winget --id Python.Python.3.12 -e
winget install --source winget --id Kitware.CMake -e
winget install --source winget --id Microsoft.PowerShell -e
winget install --source winget --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.22621"
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Set-Service sshd -StartupType Automatic; Start-Service sshd
```

Then vcpkg (`git clone https://github.com/microsoft/vcpkg C:\dev\vcpkg; C:\dev\vcpkg\bootstrap-vcpkg.bat`, machine variable `VCPKG_ROOT=C:\dev\vcpkg`; the
debugger's `vcpkg.json` pulls in MinHook for `x86-windows`), Sysinternals under `C:\dev\sysinternals`, the DirectX 9 June 2010 redistributable (`d3dx9_*.dll`)
and OpenAL.

**The game.** Your own copy of *The Movies: Stunts & Effects*, patched to the 2006 build (`version.inf`: `ExtVersion=1.2`, `IntVersion=17.0`, `QA=4135`),
installed to `C:\Games\TheMovies`. `MoviesSE.exe` must be byte-identical to the one the analysis used (12,230,656 bytes, the SHA-256 above, before the LAA patch),
or every address in the docs, `debugger/` and `coverage_functions.txt` is off: check with `Get-FileHash C:\Games\TheMovies\MoviesSE.exe -Algorithm SHA256`.
Run it once from the desktop (create a studio, get past the intro, confirm it renders and plays sound).

**Ready check** from the Mac:

```bash
ssh $BOX "powershell -NoProfile -Command \"cmd /c ver; python --version; cmake --version | Select -First 1; git --version; (Get-FileHash C:\\Games\\TheMovies\\MoviesSE.exe -Algorithm SHA256).Hash\""
ssh $BOX "query user"          # the account must show an Active console session
```

Logs and files pulled back from the box are game-derived: they go under `data/` (gitignored).
