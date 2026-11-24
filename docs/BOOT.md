# Boot: entry point to the main menu

Status: the path down to the intro splashes is read from the decompile and reimplemented in `src/game/boot/IntroSequence.*`
(tests: `src/tests/IntroSequenceTest.cpp`). One boot run under Wine was recorded (2026-11-24, `data/runtime/boot1/`, section
"Measured: boot1"). It confirms the order of the path but is a first-call log, so it cannot confirm each splash's timing. The
tests still check the model against the decompile, not against that run.

## The path

```
entry                      0x00AD2451   CRT startup (heap, mtinit, ioinit, cinit, GetCommandLine) then WinMain
 WinMain                   0x00542B20
   config + locale         stringdatabase.lhts, InitConfigRegistryPath, "Open Count"
   window                  class "The Movies"; fullscreen or 800x600 windowed
   renderer / audio init   FUN_009A6960 (exit(1) on failure), FUN_009A3480 ("ERROR_CANNOTSTART_3D"), audio thread, ...
   fork                    if (ShouldSkipFrontEnd() || LH_MasterGameLoop() == 0) Game_MainLoop();
 LH_MasterGameLoop         0x0045E720   intro splash sequence (this is NOT the menu)
 Game_MainLoop             0x00447C30   builds the 0xCC-byte main object (FUN_004291C0), then ticks Game_TickOneFrame
 WFrontEnd                 0x0068F1C0.. the menu (FRONTEND_RESUME / NEW / LOAD / OPTIONS / CREDITS / QUIT ... items)
```

`ShouldSkipFrontEnd` (0x004EF580) is the config int "Skip Front End", default 0.

## The intro (UpdateIntroSplashScreens 0x0045E3F0)

State at `GameStateManager+0x04`. `+0x14` is a "skip requested" flag, cleared on every state entry. `+0x15` = `Open Count > 1`.
`+0x16` = `DAT_0105BE08 == 0` (quality tier 0: still images instead of the logo animation and the video).

| state | shows | leaves when |
|---|---|---|
| 0 | | locale id 0xD: to 5, else to 1 |
| 1 Lionhead | tier 0: `ui/lionhead_splash.dds` 3 s. Else `LogoScreen_Initialize` (0x009ECDA0) | tier 0: skip or 3 s. Else `FUN_009EC720` (Esc or Space with the window in front, or fade >= 400) |
| 2 Activision | tier 0: `ui/activision_screen.dds` 3 s. Else `data/intro/atvi_logo.wmv` | tier 0: skip or 3 s. Else the movie finishes (a skip stops it first, vtable +0x1C) |
| 3 Intel | `ui/intel_splash.dds` 3 s | 3 s, or skip only if `Open Count > 1` |
| 4 ATI | `ui/ati_splash.dds` 3 s | same |
| 5 legal | `legal/chineselegal.jpg` 12 s | skip or 12 s, then to 1 |
| 6 | | done |

`LH_MasterGameLoop` pumps messages around it: WM_KILLFOCUS and WM_SYSKEYUP are dropped, WM_CLOSE and WM_QUIT end the loop.

## Measured: boot1 (Wine/CrossOver, coverage tracer injected before `WinMain`)

Setup: `TheMoviesInjector.exe --launch` as in WINE_CROSSOVER.md, no input sent. Registry: `Skip Front End=0` (so the intro runs),
`Open Count=18`, `GD: Level=0`, and the stale `Game running:` cleared first (it is what brings up the "improper shutdown" dialog;
killing the game sets it again, so clear it before every run). Read with `tools/boot_trace.py`. Note the log's address column is
an RVA (VA - 0x400000).

| t (s) | event |
|---|---|
| 0.165 | `WinMain` |
| 0.293 | `LoadSkipFrontEndSetting` |
| 17.593 | `ShouldSkipFrontEnd`, then `LH_MasterGameLoop`, then `GameStateManager_Constructor` (in that order) |
| 17.606 | `UpdateIntroSplashScreens`, `FUN_0045E090` (show image) |
| 20.622 | `FUN_0045E1D0` (free image), first call: 3.016 s after the first image |
| 33.017 | `CIntroScreenManager` destructor, then `MediaPlayer` teardown |
| 33.018 | `Game_MainLoop`, then `FUN_004291C0` (main object) |
| 33.020 | first UI window classes (`WSplashHTML`, `WHTML`, `WWindow`...), `Game_Bootstrap` at 35.434 |
| 53.926 | first `WFrontEnd` function (`FUN_00695460`); `WFrontEnd_Tick` at 60.947 |

What this settles:
- **The fork is as read.** `ShouldSkipFrontEnd` returned 0, `LH_MasterGameLoop` ran, and `Game_MainLoop` followed it directly once the
  manager was destroyed. So when the intro runs to the end, `LH_MasterGameLoop` returns 0 (open question 1, for the normal path; a
  window close is still unobserved).
- **Image mode is what the registry predicts.** `GD: Level=0` and no `LogoScreen_Initialize`, `LH_State_IntroSplashScreen` or movie
  functions were called, matching the `DAT_0105BE08 == 0` branch. The manager class is `CIntroScreenManager` (the Ghidra name
  `GameStateManager` is ours).
- **The first splash lasts 3 s**, matching `splashMs`.
- **The menu is not part of the intro.** `WFrontEnd` first appears 21 s after `Game_MainLoop`, behind the main object, the UI window
  classes and `Game_Bootstrap` (0x4244A0, a good candidate for where the front end is created; open question 3, still untraced).

What it does not settle:
- **Total intro time disagrees with the model.** The intro ran 17.606 s to 33.017 s = 15.4 s; four 3 s splashes would be 12 s. Either
  loading each image under Rosetta adds about 1 s each (the 3 s deadline starts after the load), or there is an extra step. A
  first-call log cannot tell. A full-call trace of `FUN_0045E090` / `FUN_0045E1D0`, or a run on the Windows box, would.
- The Activision, Intel and ATI transitions individually, the skip flag, and the legal notice (state 5) were not exercised.

## Open questions

1. **`LH_MasterGameLoop`'s return value.** Ghidra shows `unaff_EBX >> 24`, i.e. nothing useful. boot1 shows a normal finish returns
   0 (then `Game_MainLoop` runs). What a window close during the intro returns is unobserved, so `ChooseBootPath` still only models
   the skip setting.
2. **Who sets the skip flag (`+0x14`).** Not found; presumably a key handler in the window procedure (`LAB_00542380`). The
   reimplementation exposes it as `RequestSkip()`.
3. **Where `WFrontEnd` is created.** No direct caller of its constructor (`FUN_00690690`) exists in the decompile, so it goes
   through a vtable or factory. Candidates: `FUN_004291C0`, the `Game_TickState*` handlers, `FUN_004F3B20` / `FUN_004F98F0`.
4. **State 5's trigger** (locale 0xD via `FUN_009B4250`) is named from the asset only.
5. The first-run `MessageBoxW` in WinMain (`DAT_0105BE04`, `SM_FIRST_TIME_*`) is not modelled.

To close 3: look at who calls `FUN_00695460` / constructs `WFrontEnd` between 33.0 s and 53.9 s in boot1 (start from
`Game_Bootstrap`). To close 1: close the window during the intro in a run and see whether `Game_MainLoop` still follows.
