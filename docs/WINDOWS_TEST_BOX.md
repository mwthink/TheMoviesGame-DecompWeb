# Windows test box: what to set up for runtime testing

The reimplementation (`src/`) is checked against the real game wherever a measurement from the running game can settle a question
(see "verified" in `docs/REIMPLEMENTATION.md`). That needs `MoviesSE.exe` running on Windows with `debugger/` injected. This page
describes a machine I can work on directly, so a test is a few minutes of my work instead of a round trip through you.

## What I would do with it

1. Build `debugger/` (32-bit MSVC + vcpkg MinHook) and run the first coverage trace (`tools/run_coverage.ps1`): which of the ~35,000
   functions run for boot, loading a save and playing a month. That list decides what to reimplement next.
2. Add hooks for the functions in `src/game/movie/` that are not verified yet (`ActorPerformance`: mood, genre fit, likeness, stunt
   factors) and compare their logged results with the reimplementation.
3. Build and run the `src/` tests with MSVC for x86. The game uses x87 80-bit intermediates; this shows how far the portable code can
   differ in the last bits.
4. Run scripted sessions from saved games (load a 1920s / 1930s / 1960s save, advance time, collect `decade_log.csv`), instead of you
   playing for an hour per experiment.

## Machine

| | Requirement | Why |
|---|---|---|
| CPU | **x86-64** Windows 10 or 11, 64-bit (not Windows on ARM) | The game is a 32-bit x86 process; the debugger patches its machine code (MinHook detours, INT3 tracer). Emulated x86 (Parallels/UTM on Apple silicon) makes those measurements unreliable. |
| GPU | Any real GPU with Direct3D 9 (NVIDIA, AMD, or an Intel iGPU) | The renderer is Direct3D 9. Software rendering may run but is slow and untested. A VM needs GPU passthrough or Hyper-V GPU-P; a cloud instance needs a GPU SKU. |
| Size | 4 cores, 8 GB RAM, 80 GB free disk | Game about 2.5 GB, Visual Studio Build Tools about 8 GB, logs and saves. |
| Display | A fixed 1920x1080 (or 1280x720) desktop, never locked or asleep | The game must run in an interactive desktop session (see below). |

Options, best first:
1. A spare PC or mini PC on your network (simplest, real GPU).
2. A Windows VM on your own hypervisor with GPU passthrough.
3. A cloud Windows GPU instance (for example AWS `g4dn.xlarge`; stop it when idle). Use a snapshot or image after setup.
4. Not recommended: Windows ARM in Parallels/UTM on this Mac. CrossOver is installed here and could run the game for a quick experiment, but results
   under Wine (timing, threading) are not trustworthy for verification; I can try it for function coverage if you want a free first step.

Treat it as a throwaway machine: no personal accounts, no password reuse, nothing sensitive on it. Take a snapshot when it is ready so it can be reset.

## Access (what I need to reach it)

- **OpenSSH Server** on the box, key-only login for a dedicated local account (for example `claude`), no password login. I run commands
  there over SSH.
- **Reachable without opening ports to the internet**: Tailscale (or your existing VPN / LAN) so I connect to a private address. No
  inbound port forwarded from the internet. Windows Firewall: allow SSH (22) only on the Tailscale/LAN interface.
- **Register it in the Claude desktop app as a saved SSH connection** (name, host, default folder). `list_start_targets` currently shows no
  saved SSH connections, so none exists yet. With that I can start a session on the box itself, with its own copy of this repository.
  If you would rather not do that, a plain SSH host works too: I run commands from this Mac with `ssh claude@<host> ...`.
- The `claude` account is a **standard user** (not an administrator). You do the one-time installs below as an administrator.
  The injector and the game run as `claude`, so no admin rights are needed afterwards.

## The part that is easy to get wrong: an interactive desktop

A game cannot render from an SSH session: SSH logons run in a non-interactive session with no desktop. The game and the injector have to
run inside the logged-in desktop of the `claude` user, and I start them from SSH through a scheduled task.

1. **Auto-logon** the `claude` account to the console at boot (Sysinternals `Autologon64.exe`), so the desktop always exists.
2. Disable the lock screen, screen saver, display sleep and sleep (Settings, or `powercfg /change monitor-timeout-ac 0` and
   `powercfg /change standby-timeout-ac 0`).
3. **Do not use Remote Desktop to look at it.** Disconnecting RDP can lock the session and break Direct3D. To watch it, use the
   hypervisor console, a physical monitor, or Tailscale plus a console-session tool such as Sunshine/Moonlight or TightVNC (which attach
   to the real console session).
4. Windows Defender: add exclusions for `C:\Games`, `C:\dev` and the build folders. Injecting a DLL into a suspended process looks like
   malware to real-time protection. Keep the machine off the public internet.
5. I will provide a small helper, `tools/winbox/run_interactive.ps1`, that runs a command in the console session via
   `schtasks /create /ru claude /it ...` and returns its output and a screenshot. You do not need to write it.

## Software to install (as administrator)

Use `winget` in an elevated PowerShell. Reboot once at the end.

```powershell
winget install --id Git.Git -e
winget install --id Python.Python.3.12 -e
winget install --id Kitware.CMake -e
winget install --id Microsoft.PowerShell -e
winget install --id Tailscale.Tailscale -e
winget install --id AutoHotkey.AutoHotkey -e                # sends F8/F9/F10 and clicks for scripted sessions
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.22621"
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Set-Service sshd -StartupType Automatic; Start-Service sshd
```

- **vcpkg**: `git clone https://github.com/microsoft/vcpkg C:\dev\vcpkg; C:\dev\vcpkg\bootstrap-vcpkg.bat`, then set the machine
  environment variable `VCPKG_ROOT=C:\dev\vcpkg`. The debugger's `vcpkg.json` pulls in MinHook for `x86-windows`.
- **Sysinternals** (`Autologon`, `Procmon`, `procdump`) under `C:\dev\sysinternals`.
- **SSH keys**: put the public key I give you (or one of yours that I will use) in `C:\ProgramData\ssh\administrators_authorized_keys`
  only for administrators; for the `claude` account use `C:\Users\claude\.ssh\authorized_keys`. In `sshd_config` set
  `PasswordAuthentication no`. Set the default shell to PowerShell 7 or leave `cmd`; either works.
- **Game runtime**: the DirectX 9 June 2010 redistributable (`d3dx9_*.dll`) and OpenAL (`oalinst.exe`), since the executable imports `d3d9.dll`
  and `OpenAL32.dll`.

## The game

- Your own copy of **The Movies: Stunts & Effects**, patched to the 2006 build: `version.inf` says `ExtVersion=1.2`, `IntVersion=17.0`,
  `QA=4135`. Install it to **`C:\Games\TheMovies`** (no spaces, owned by `claude`).
- **`MoviesSE.exe` must be byte-identical to the one the Ghidra analysis used**, or every address in `Addresses.hpp`,
  `coverage_functions.txt` and the docs is off:
  - size 12,230,656 bytes, SHA-256 `48f909d7f89051ff0d3277f7dc0aa7c65cd1c92015542fcbc3d5f86700b1566a`
  - check with `Get-FileHash C:\Games\TheMovies\MoviesSE.exe -Algorithm SHA256`. If you use a no-CD or other modified exe, the hash will
    differ and I need to know before building anything.
- Run it once as `claude` from the desktop: create a studio, get past the intro, confirm it renders and plays sound. If it will not start,
  try the Windows XP SP3 compatibility mode and "disable fullscreen optimizations" on `MoviesSE.exe`, and tell me what you changed.
- **Saved games** from several stages, copied into the user's game save folder: an early 1920s studio, a 1930s studio with a few stars
  (genre saturation and technology bonuses active), a 1960s+ studio with stunts unlocked, and one with a movie about to be released.
  Name them so I can tell them apart. You already have some in `~/SaveGames/0`.

## Ready check

Send me the output of these from the Mac. They show the box is usable before I spend time on it:

```bash
ssh claude@<host> "powershell -NoProfile -Command \"cmd /c ver; python --version; cmake --version | Select -First 1; git --version; (Get-FileHash C:\\Games\\TheMovies\\MoviesSE.exe -Algorithm SHA256).Hash\""
ssh claude@<host> "query user"          # the claude user must show an Active console session
ssh claude@<host> "dir C:\\dev\\vcpkg\\vcpkg.exe"
```

Then, with the `claude` desktop showing, I will launch the game through the scheduled-task helper and check the process stays up with
a window. If that works, I can do everything in "What I would do with it".

## Cost and care

- A cloud box costs by the hour: stop it when we are not testing and keep the disk. A snapshot after setup makes a reset a minute's work.
- Logs and extracted files I pull back are game-derived. They go under `data/` (gitignored); nothing from the game gets committed.
- If something in this list does not fit your setup (different hypervisor, no GPU, only an ARM machine), tell me what you have and I will
  adjust the plan instead of you adapting the machine.
