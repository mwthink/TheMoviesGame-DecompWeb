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
 Game_MainLoop             0x00447C30   operator_new(0xCC) -> Game_Constructor, then ticks Game_TickOneFrame
  Game_Constructor         0x004291C0
   Game_StartupSequence    0x004289E0   (really 0x4289E0..0x4291A0; Ghidra exported only the first ~95 lines)
     CVar registration, Game_Bootstrap (0x4244A0, a long list of registrations), object setup
     0x004290D5            WFrontEnd_GetOrCreate(mainObject+0xC8 != 0)   0x00695DA0
       operator_new(0x718); WFrontEnd_Constructor 0x00695460; singleton in DAT_0104DAFC
 WFrontEnd_Tick            0x006921C0   from the first frame: the menu (FRONTEND_RESUME / NEW / LOAD / OPTIONS / CREDITS / QUIT ...)  (docs/FRONTEND.md)
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

**The skip flag is polled, not messaged.** Once per frame, before the update, `CIntroScreenManager_PollSkipKeys` (0x45DF30, called
`Input_CheckGlobalShortcuts` in the Ghidra export) calls `GetAsyncKeyState` for Esc (0x1B), Space (0x20) and Enter (0x0D). If the game
window is in front and one is down, and the latch `DAT_00F88F3C` is clear, it sets `manager+0x14` and the latch. The latch clears on a frame where none is held
in a foreground window, so a held key skips one screen, not all of them. The window procedure (0x542380) only records key state
(the 256-byte table at `0x104C7F0`) and forwards characters to an input singleton; it has nothing to do with the intro. The animated
logo has its own check (`FUN_009EC720`: Esc or Space, no Enter). Ported as `IntroSequence::PollSkipKeys`; not exercised in a run, since
`GetAsyncKeyState` needs a real key press.

## Measured: boot1 (Wine/CrossOver, coverage tracer injected before `WinMain`)

Setup (boot1): `TheMoviesInjector.exe --launch` as in WINE_CROSSOVER.md, no input sent. Registry: `Skip Front End=0` (so the intro runs),
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
  manager was destroyed. So when the intro runs to the end, `LH_MasterGameLoop` returns 0 (the window-close case is close1, below).
- **Image mode is what the registry predicts.** `GD: Level=0` and no `LogoScreen_Initialize`, `LH_State_IntroSplashScreen` or movie
  functions were called, matching the `DAT_0105BE08 == 0` branch. The manager class is `CIntroScreenManager` (the Ghidra name
  `GameStateManager` is ours).
- **The first splash lasts 3 s**, matching `splashMs`.
- **The menu is not part of the intro.** `WFrontEnd` is created at the end of `Game_StartupSequence`, which `Game_Constructor` runs
  as the first thing `Game_MainLoop` does. `Game_StartupSequence` is mostly `Game_Bootstrap` (0x4244A0, 18 KB, ~18.5 s of the 20.9 s).
  Timestamps are first calls, in Wine on Rosetta:

  | t (s) | step |
  |---|---|
  | 33.020 | `Game_StartupSequence` starts: CVar registration (`FUN_009ABD80`, `CVarSystem_Register_STUBBED`) |
  | 35.434 | `Game_Bootstrap` starts: about a hundred subsystem inits, each registered with a progress handler (`FUN_0098FA50` / `FUN_0098F9E0`) and then called in turn |
  | 35.77 to 42.06 | **6.3 s** in the init called just before `ContentUnlock_Constructor`: `FUN_008770e0` (now `SWFCache_LoadConfig`, reads the `swfcache` entries) |
  | 42.08 to 48.21 | **6.1 s** in `FUN_00490E80` (now `Preload_LoadList`, reads the `preload` list; the mesh loader `LH_LoadMeshBinary` fires inside it) |
  | 49.21 to 50.96 | 1.75 s in `FUN_006A4050` (UI tuning: `FadeDuration`, `DropIconRange`...) |
  | 52.48 to 53.63 | 1.15 s in `FUN_0048FFA0` (campaign year loading) |
  | 53.924 | `Game_Bootstrap` returns; `FUN_005E16D0`, `FUN_0053D440`, `FUN_00424080`, `FUN_009A1560` |
  | 53.925 | `WFrontEnd_GetOrCreate` (0x4290D5) |
  | 60.941 | `FUN_00421090`, then `WFrontEnd_Tick` at 60.947 |

  Those four inits account for about 15 of the 18.5 s; the rest are tens of 0.01 to 0.6 s steps. An earlier version of this section
  called the 11.9 s after the first `FUN_005434B0` "a stall" after `Game_Bootstrap`; that was wrong: `Game_Bootstrap` itself runs until
  53.924 s and the `FUN_005434B0` stubs are first reached inside it.

  The call site passes `(mainObject+0xC8 != 0)`. That field is the `-download <value>` command-line switch (see "Command line").

- **The command line.** Four switches, all read with `CmdLine_GetSwitch` (0x567860) from `WinMain`'s `lpCmdLine`, which `WinMain`
  also hands to `Game_MainLoop` and so to `Game_Constructor` and `Game_ParseCommandLine` (0x421A70):

  | switch | where | effect |
  |---|---|---|
  | `-safemode` | `WinMain` 0x543072 | window size 800x600 (0x320 x 0x258) |
  | `-reenter` | `Game_ParseCommandLine` | `Game+0x84` = 1 |
  | `-editor` | same | `Game+0x85` = 1; `Game_StartupSequence` then calls `TrailerEditor_Open` (`FUN_007843B0`) |
  | `-download <value>` | same | `Game+0xC8` = 1, value (at most 100 characters) assigned to the global string `DAT_00E57B40`; `Game_StartupSequence` then calls `WFrontEnd_GetOrCreate(1)`, sets `DAT_0104DAE0` and calls `WFrontEnd_ExternOnline` (`FUN_0068F550`) on the front end, which opens the online screen |

  `DAT_00E57B40` is read by `FUN_006C31A0`, `FUN_006C7240`, `FUN_006C73C0`, `FUN_006D5B00`, `FUN_006D6690` and `FUN_004217B0`, none of
  which has been read. None of the switches was used in boot1 or close1.
  The parser's quirks (a `-` counts anywhere, even mid-word; the value is the next token even if it starts with `-`; keys are
  case-sensitive; every occurrence is scanned and the last value wins) are ported in `src/game/boot/CommandLine.*` and tested, but
  from reading the code only: it has not been run against the real binary.
- **The "load a save at start-up" branch is dead.** `0x4290B0` reads `DAT_00E4E604` and, if nonzero, loads a save via
  `Savegame_LoadAndRestoreGame` instead. `DAT_00E4E600` is a string whose initial bytes in the executable are an empty buffer (size 0)
  and the only other reference to it is its static destructor, so nothing ever assigns it: the branch cannot run in this build.

## Intro timing (Wine `+file` trace)

The first-call log cannot time the splashes, so a second plain run (no injector) recorded Wine's file trace with millisecond
timestamps (`tools/boot_reads.py`; the summary is in `data/runtime/boot1/intro_reads.txt`). The splash images come out of the pak by
index, so their names never appear; the evidence is the spacing of the asset reads. Between the intro's first read burst and the
game's own start-up the reads fall at (seconds from process start):

| t | gap since previous | reading |
|---|---|---|
| 18.64 | | intro manager built, first splash loaded |
| 21.75 | 3.11 | second splash loaded |
| 24.76 | 3.02 | third |
| 30.20 | **5.44** | fourth |
| 34.28 | **4.08** | `Game_MainLoop` / main object start (62 reads) |

Total 18.64 to 34.28 = 15.6 s, against 15.4 s in boot1 (a different run, with the tracer instead of the file trace), so the length is
repeatable. The first two intervals are the model's 3 s plus a short load. The last two exceed 3 s by 2.4 s and 1.1 s, which is the
whole of the 3.4 s excess over 4 x 3 s.

This is an inference, not a measurement of each state: it assumes each burst is one splash's load, in the model's order. What it
supports is that **the 3 s display time is right and the extra time sits in the transitions out of the third and fourth splashes
(load, free, teardown), not in the state machine.** In the original the deadline is `GetTickCount() + 3000` taken after the image
load returns, so a slow load stretches the gap between loads without lengthening the display. `IntroSequence` models the display
deadline only, and leaves load time to the platform layer; that is consistent with this, so the code is unchanged.

Not settled: which splash is which (an image-name trace would say), why the third and fourth transitions are slow (a large DDS
decode and upload under Rosetta is the obvious candidate), the skip flag, the legal notice (state 5), and whether the Windows box
shows the same gaps.

## Game_Bootstrap's two halves

`Game_Bootstrap` (0x4244A0..0x4289E0) is two things back to back.

**1. The class registry (0x4244A0..0x428412): 126 save-game classes.** Each block does, in order: build the class's RTTI name
(`.?AVCAward@TM@@`, from a static string at `ecx+8`), `FUN_0098FA50(factory, &name)` (register the factory under that name; a counter
`DAT_00E6746C` numbers the classes), `FUN_0098F9E0(callback)` (add a pre-load callback to the list at `DAT_010584E8`, which
`Save_RunPreLoadCallbacks` walks; 21 distinct callbacks are shared among the 126 classes), then one static-init call. This is the table
`Save_LoadObjectByType` looks the RTTI name up in (SAVE_FORMAT.md). Each factory is `operator_new(size)`, a constructor, then a vtable
call; Ghidra's decompile of all 126 agrees with the size and constructor read from the bytes, and every constructor stores a vtable.
The static inits are either empty, push a descriptor onto the list at `DAT_010584C8`, or register a persistence name such as
`"PBonusManager"` or `"PDataLog"` through `FUN_0098FDD0`. `renames.csv` now has `<Class>_CreateInstance`, `<Class>_Constructor` (with the
object size in the evidence), `<Class>_StaticInit` and, for the callbacks used by one class only, `<Class>_PreLoadCallback`.

**2. The subsystem inits (0x428414..0x4289AF): 87 calls to 86 distinct functions** (`SWFCache_LoadConfig` is called twice), almost all one-shot: registering console commands (`dbg_money`, `ass_hide`,
`chr_hide`...), message ids (`MT_OBJECT_SELECT`, `MT_REVIEWS_*`...) and reading tuning keys (`gui`/`FadeDuration`, `studio`/`FundsHighlighting...`,
`trailers`/`territoryfactor`...). Sixteen were named from their strings in this pass (the evidence in `renames.csv` says so); 49 of the 86 are still `FUN_` or
`thunk_FUN_`, mostly with no distinctive string, and are left unnamed rather than guessed.

## Measured: close1 (window closed during the intro)

Same setup as boot1 (tracer injected, no input), then a non-forced `wine taskkill /im MoviesSE.exe` about 4 s after
`UpdateIntroSplashScreens` first ran. Wine's `taskkill` without `/f` posts WM_CLOSE to the process's top-level windows.

| t (s) | event |
|---|---|
| 23.17 | `UpdateIntroSplashScreens` (intro started), first image shown |
| 26.18 | first image freed (3.0 s later, as in boot1) |
| 31.736 | `CIntroScreenManager` destructor, then `MediaPlayer` teardown |
| 31.744 | `FUN_009B27D0`, the first of `WinMain`'s shutdown functions |
| 32.23 to 32.26 | the rest of the tail: `FUN_00A09770`, `FUN_009B4640`, `FUN_009A3BA0`, `FUN_00A0EF90`, `FUN_009B3730` |
| | `Game_MainLoop`, `Game_Constructor` and `WFrontEnd` are **never called**; the process ends |

So closing the window mid-intro makes `LH_MasterGameLoop` return nonzero, `WinMain` skips `Game_MainLoop` and shuts down. Together with
boot1 (finishing the intro returns 0 and `Game_MainLoop` runs) this fixes the return value in both cases. It is encoded as
`NextAfterIntro(IntroOutcome)` in `src/game/boot/IntroSequence.*`. The message reached the loop about 3 s after it was sent, which
fits a main thread that is busy loading the next splash (the slow transition in the section above). Closing at other points
(the first splash, the animation and movie variants) was not tried.

## The developer console

`CVarSystem_Register_STUBBED` (`005434a0`) is an empty stub in the retail build. Over 100 debug commands register through it (`sbx_*`, `awd_*`, `gnd_*`,
`sitt_*`, `ee_*`, `ass_*`) and do nothing. Their names are a list of what the developers could tweak at run time, and a candidate for a debug console in the
reimplementation.

## Open questions

1. **Resolved:** `LH_MasterGameLoop` returns 0 when the intro finishes and nonzero when the window is closed (boot1, close1).
   Not covered: closing during the animation or movie variants of the first two splashes.
2. **Resolved:** the skip flag is set by `CIntroScreenManager_PollSkipKeys`, which polls Esc, Space and Enter (see "The intro").
   Not run: a real key press under Wine has not been tried, so the Open Count gate on the Intel and ATI splashes is still untested.
3. **Resolved:** `WFrontEnd` is created at 0x4290D5 in `Game_StartupSequence` (see boot1). Other callers of `WFrontEnd_GetOrCreate`
   (`FUN_00687BC0`, `FUN_006D7AC0`, `FUN_006D7F50`, the debug console) were not reached; they are probably how the menu comes back
   after a game. `FUN_0068F550` and `FUN_007843B0` are now read: the Online button's handler and the trailer editor (FRONTEND.md).
4. **State 5's trigger** (locale 0xD via `FUN_009B4250`) is named from the asset only.
5. The first-run `MessageBoxW` in WinMain (`DAT_0105BE04`, `SM_FIRST_TIME_*`) is not modelled.
6. **Why `Game_Bootstrap` takes 18.5 s here.** The two big inits (`swfcache`, `preload`) are asset loading; whether that time is
   Rosetta and Wine overhead or the same on the Windows box is not known.
