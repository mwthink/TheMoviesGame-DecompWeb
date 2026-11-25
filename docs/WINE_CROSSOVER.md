# Running the game under Wine (CrossOver on an Apple-silicon Mac)

Status: **works.** `MoviesSE.exe` (patch 1.2) starts, shows the menu, Quick Start loads a studio, the game plays, sound and mouse
work. Loading is slow (see "Performance"). The debugger DLL (`debugger/`) loads and its hooks and first-call coverage work (section "The debugger DLL under Wine"); the `this`-class mode crashes. The Windows test box
(`WINDOWS_TEST_BOX.md`) stays the reference for anything that gets tagged `verified`.

Tested with: CrossOver (the copy in `/Applications/CrossOver.app`), a MacBook Air with an M1, macOS 26. Wine runs as x86-64 under Rosetta 2;
the game is 32-bit and runs through Wine's WoW64 mode, also under Rosetta.

## What it took

Four things were needed. Only the third was a surprise.

1. **Large-address-aware flag.** The same fix as on the Windows box: without it the game crashes after a new studio loads. `tools/wine/patch_laa.py`
   sets the one header bit on a *copy* (it refuses any executable whose SHA-256 is not `48f909d7...566a`, and checks that exactly one byte differs).
   Keep the original; every address in the docs refers to it. Not strictly proven necessary under Wine (the unpatched exe was never run there), kept to
   match the box.
2. **Registry**: `HKCU\Software\Lionhead Studios Ltd\TheMovies`, value `Fullscreen` = `"0"` (REG_SZ), so the game runs windowed. The stale
   `Game running:` and `OpenDx` flags (see `WINDOWS_TEST_BOX.md`) did not come up in these runs; delete them if the "improper shutdown" dialog appears.
3. **The Windows Media ASF writer.** Without it the game stops at start-up with the dialog `Missing Windows Media Component`. Cause (from a Wine
   trace, `err:ole:com_get_class_object no class object {7c23220e-55bb-11d3-8b16-00c04fb6bd3d}`): that CLSID is the *WM ASF Writer* DirectShow filter,
   which the game creates on start-up (the executable also imports `wmvcore.dll`: `WMCreateProfileManager`, `WMCreateSyncReader`). Wine's builtin
   `qasf.dll`/`wmvcore.dll` do not register it. The fix:
   - Install **Windows Media Player 11** into the bottle (it carries the Windows Media Format 11 runtime, including a native `qasf.dll` that
     contains the filter). Installer: `wmp11-windowsxp-x86-enu.exe`, SHA-256 `ffd321a441a67001a893f3bde4bb1afba07d4d2c9659bfdb0fbb057e7945d970`,
     the URL winetricks uses (a Wayback Machine copy of Microsoft's download). Set the bottle to Windows XP first (`winecfg -v winxp`).
   - **Force the native DLLs**: `HKCU\Software\Wine\DllOverrides`: `qasf`, `wmvcore`, `wmasf`, `wmpasf` = `native,builtin`.
   - Re-register: `wine regsvr32 C:\windows\system32\qasf.dll`. Just installing WMP11 was not enough; the CLSID only appeared in `system.reg` after the
     override plus this step.
   A few WMP11 DLLs report `Failed to load DLL` during its setup (`licdll`, `regwizc`, `wmpeffects` first time, `msdxm.ocx`, Windows Media Connect, the
   portable-device types DLL). They are irrelevant for the game.
4. **OpenAL.** CrossOver does not ship `OpenAL32.dll`; the game needs it. Installer: `oalinst.zip` from openal.org (SHA-256
   `d165bcb7628fd950d14847585468cc11943b2a1da92a59a839d397c68f9d4b06`), run as `oalinst.exe /silent`. DirectX 9 `d3dx9_*` DLLs were already in the bottle.

Not needed: a no-CD or modified exe, DirectInput tweaks (the mouse behaved), msync/esync, a virtual desktop.

## Steps, as run

`CX` below is CrossOver's `bin` folder (`/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin` for a standard install), `BOTTLE` the bottle's name
and `WORK` a scratch folder outside the repository (the game and the bottle must never be committed; `tools/audit_firewall.py` checks). Once it runs, set
`OTM_GAME_DIR` in `local.env` to the game folder inside the bottle (`~/Library/Application Support/CrossOver/Bottles/$BOTTLE/drive_c/Games/TheMovies`).

```
# 1. a patched copy of the game
python3 tools/wine/patch_laa.py "<game>/MoviesSE.exe" $WORK/TheMovies/MoviesSE.exe      # then copy the rest of the install next to it
# 2. a bottle (win7 template = 32-bit WoW64 prefix; there is no win10_32 template), game inside it
$CX/cxbottle --bottle $BOTTLE --create --template win7
rsync -a "$WORK/TheMovies/" ~/Library/Application\ Support/CrossOver/Bottles/$BOTTLE/drive_c/Games/TheMovies/
# 3. windowed mode: import  [HKEY_CURRENT_USER\Software\Lionhead Studios Ltd\TheMovies] "Fullscreen"="0"   with  $CX/wine --bottle $BOTTLE regedit file.reg
# 4. OpenAL and Windows Media (downloads: see above, verify the SHA-256)
$CX/wine --bottle $BOTTLE oal/oalinst.exe /silent
$CX/wine --bottle $BOTTLE winecfg -v winxp && $CX/wine --bottle $BOTTLE wmp11.exe /q
# 5. native overrides (regedit file with the four DllOverrides above), then
$CX/wine --bottle $BOTTLE regsvr32 'C:\windows\system32\qasf.dll'
# 6. run
$CX/wine --bottle $BOTTLE --workdir 'C:\Games\TheMovies' 'C:\Games\TheMovies\MoviesSE.exe'
```
Stop it with `pkill -f MoviesSE` (and `$CX/wineserver -k`).

Gotchas: winetricks does not work with CrossOver's `wine` wrapper (it prints a banner on stderr that winetricks cannot parse): run installers by hand.
The wrapper's debug switches are `--cx-log FILE` and `--debugmsg CHANNELS`, not `WINEDEBUG`; its default channels include `+seh,+unwind`, which
flood the log and cost CPU, so do not leave tracing on when measuring.

## Performance

Gameplay is reasonable; **loading is very slow**. Measured (Quick Start, startup load to menu 47 s on this machine; no Windows-box number exists to compare):

- One thread is pinned at about 99% of a core (1.9 s system vs 33.8 s user CPU after the first minute): the load computes, it does not wait on files.
- `sample` over the Quick Start load: about 65% of busy samples are Rosetta-translated game code, about 33% Rosetta runtime helpers (the pattern of
  x87 or indirect-branch heavy code), under 3% Wine itself (`ntdll.so`, `win32u`, `wined3d`). So Wine tuning (msync, esync, renderer, file system) cannot
  help; only a faster x86 execution layer can. `WINEMSYNC=1` was set for that run and showed no visible effect.
- Not tried: Windows 11 ARM in a VM (its own x86 emulator may handle x87 better), Wine builds on other emulators.

## The debugger DLL under Wine

Tried with the DLL and injector built on the Windows box (`TheMoviesDebugger.dll`, `minhook.x32.dll`, `TheMoviesInjector.exe`; copy them
from the box's `debugger\build\RelWithDebInfo` with `scp` into the bottle's game folder; nothing is built on the Mac).
Run it like the box does, with the injector's `--launch` mode (starts the game suspended, parks the main thread, loads the DLL, releases it):

```
$CX/wine --bottle $BOTTLE --workdir 'C:\Games\TheMovies' 'C:\Games\TheMovies\TheMoviesInjector.exe' --launch 'C:\Games\TheMovies\MoviesSE.exe' 'C:\Games\TheMovies\TheMoviesDebugger.dll'
```
Output lands in the game folder inside the bottle (`.../drive_c/Games/TheMovies/`): `sessions/session_*/` (`debug.log`, `events.jsonl`, `strings.jsonl`), `decade_log.csv`,
`coverage_*.csv/txt`. For coverage, put `tools/coverage_functions.txt` next to the exe first.

| Feature | Under Wine/Rosetta |
|---|---|
| Injection (`--launch`) | works |
| All 50 `GameHooks`/`DecadeTracker` hooks | install without failure; events, state changes and `Scene_LoadFlm` names are logged |
| First-call coverage (`coverage_functions.txt` only) | works: 34,906 of 35,039 functions armed (133 skipped as MinHook-detoured, as designed), game runs normally |
| Hotkeys F9 (marker) and F10 (summary) | work (macOS may need Fn held); F8 (re-arm) and F11 (session export) not tested |
| `this`-class mode (`coverage_this.txt` present) | **crashes the game in its start-up code**: null call, EIP 0, return address `0x00ad2531` (the CRT entry at `0x00ad2451`, right after `call 0xada01f`) |

Why `this`-class mode fails (probable, not proven): `CoverageTracer.cpp` keeps a function armed by setting the CPU trap flag (`EFlags |= 0x100`) to single-step
one instruction after restoring the entry byte, then re-arming from the single-step handler. Rosetta 2 does not implement the x86 trap flag. The same DLL and
function list run fine without `coverage_this.txt` (no single-stepping). A fix would replace the single-step with another re-arm (a delayed re-arm from a helper
thread, or inline trampolines for the functions of interest); it needs the box to re-test afterwards. Not done.

Limits of what was measured: one Wine run reached 5,760 distinct functions (start-up, menu and a short load: phase 1 = 5,349, phase 2 after F9 = 411). That cannot be compared with the
box's 9,458 over two game years; a comparable run (Quick Start, F9 per step, same game time) on both has not been made. Until it is, keep `verified` tags for box measurements.

## What this does and does not give the project

See `STATUS.md`. Short version: a free local way to run, play and create save games; a way to run the debugger's hooks and first-call coverage tracer (not the `this`-class mode). It does not replace the Windows box for verification: Wine's timing and threading differ, and the box has native x86 speed.
