# Decompilation bring-up tools

Three tools that move the project from "35,000 functions of Ghidra pseudo-C" towards something that can be compiled and run.
All scripts are in `tools/`, all generated output is in `docs/generated/` and `gen/` (regenerate, do not edit).

## 1. First-call coverage tracer (`src/hooks/CoverageTracer.cpp`)

Answers: *which functions does the game actually run to reach the main menu, to load a save, to play a month?*

- Plants an INT3 on the first byte of every function listed in `coverage_functions.txt` (35,039 entries; built by
  `tools/gen_function_list.py` from the Ghidra export, `library_map.csv` and `renames.csv`). A vectored exception handler
  logs the first entry of each function (sequence, microseconds, thread, phase, RVA), restores the byte and continues, so every
  function costs one exception per run. Functions already detoured by MinHook (first byte `E9`) are skipped.
- Output: `coverage_log.csv` next to `MoviesSE.exe`; `coverage_summary.txt` (functions per phase) on F10 or eject.
- Hotkeys while the game runs: **F9** marker (new phase; the next phase lists only *newly reached* functions),
  **F8** re-arm everything + marker (the next phase lists its *complete* function set), **F10** summary.
  Automatic markers: `GAME_CLOCK_STARTED` when a game is loaded and `MONTH_n` at each game month.
- Start-up coverage needs the DLL in before `WinMain`: `TheMoviesInjector.exe --launch MoviesSE.exe TheMoviesDebugger.dll`
  starts the game suspended, parks the main thread on a `jmp $` at the entry point, injects, waits for the DLL's
  `TheMoviesDebugger.InitDone` event, restores the entry bytes and resumes. `tools/run_coverage.ps1` does the whole thing
  (copies the function list in, launches, removes the list again when the game exits).
- The list file's presence is what enables the tracer, so normal injection sessions are unaffected.
- **Status: run on the Windows test box** (see "Running the game on the Windows test box" below for the results: 9,458 distinct functions reached over two game years, a steady-state set of about 3,800). To repeat: use `run_coverage.ps1`, press F9 at the main menu,
  load a save, F8 once the game is running, play a month, quit.

Suggested reading of the log: functions with phase 0 = boot + main menu; phase 1 = load a game; later phases = gameplay.
Join `rva` with `gen/functions.json` or `docs/generated/rtti_classes.json` to see which classes and files that code belongs to.

## 2. RTTI skeleton (`tools/rtti_dump.py`, `tools/globals_table.py`)

- `docs/generated/rtti_classes.json`: 2,066 classes found through MSVC RTTI (2,009 with vtables): demangled name, every vtable
  (VA, `this` offset, slot function addresses with their Ghidra names), base classes with offsets, constructor candidates and an
  object size (1,095 classes get an exact size from `operator_new(size)` followed by the constructor call; the rest get a lower
  bound from the highest field offset the constructor touches).
- `docs/generated/classes.h`: C skeleton, one `<class>_vtbl` struct per primary vtable (slots named from the renames), a struct per
  class with the size as a comment, and `_vtbl_atN` structs for secondary (multiple inheritance) vtables.
- `docs/generated/globals.csv` / `globals.h`: 11,303 referenced globals with section (.data / .bss / .rdata), use counts and a
  guessed type (votes over the casts and uses Ghidra left behind: float/char/short/int, pointer when dereferenced or indexed,
  aggregate when its address is taken). The type is a guess; the `type_votes` column shows the evidence.

## 3. Header shim and source generator (`tools/ghidra_shim.h`, `tools/generate_sources.py`)

- `ghidra_shim.h` maps Ghidra's pseudo-types (`undefined4`, `float10`, `code`...) and helper macros (`CONCAT31`, `SUB41`,
  `CARRY4`, x87 intrinsics...) onto real C for MSVC x86. `__thiscall` becomes `__fastcall` (same register for `this`, different
  stack layout: fine for compile checks, **not** an ABI match; real replacements still need a hand-written ABI wrapper).
- `generate_sources.py` reads `ExportDecompiled/` and writes `gen/`: `decl_all.h` (a prototype per function from its own signature),
  `types_gen.h` (incomplete struct typedefs for the type names it meets), `globals_extra.h` (externs for identifiers the last
  compile check could not resolve), and 344 source files of at most 120 functions each. FID-identified CRT/STL/ATL functions
  (622, tagged "Library Function") are left out and listed in `gen/library_functions.csv`. The queued renames are applied.
  Mechanical fixes only: C++ names become safe identifiers, `void` returns are widened to a 32-bit value (Ghidra often types
  functions as `void` although callers use EAX), `stackNNNN` temporaries and SEH try-level bookkeeping are neutralised,
  Ghidra's `x._1_3_` partial-register accesses become shifts and masks.
- `compile_check.py` runs `cl /TC /Zs` over every file (about 7 seconds) and writes `docs/generated/compile_report.md/json`:
  functions with no error, error-code histogram, and the identifiers still undeclared. `header_diag.py` shows header errors
  with the offending line (they must stay at zero, otherwise MSVC's 100-error limit hides everything else).

Typical loop: `generate_sources.py` -> `compile_check.py` -> `generate_sources.py` (picks up new externs) -> `compile_check.py`.

**Current result: 32,957 of 34,413 functions (95.8%) pass a syntax/type check.** The remaining errors are mostly type mismatches
from guessed global types (C2440), float `%` (C2296), pointer arithmetic on unknown-size types and a few hundred
decompiler artifacts. A passing function is *syntactically valid C*, not a behaviourally verified one.

## Running the pipeline on macOS (Apple Silicon)

`tools/toolchain.py` replaces the old MSVC-only helper. On Windows it still drives `cl /Zs`; elsewhere it runs
`clang --target=i686-w64-mingw32 -fsyntax-only` against the MinGW Win32 headers (`brew install mingw-w64`). The target is
32-bit x86 on purpose: the pseudo-C stores pointers in `int`, so an arm64 build would change every cast. Nothing is linked or run.

```
python3 tools/generate_sources.py          # data/ExportDecompiled -> gen/
python3 tools/header_diag.py gen           # must print "errors shown: 0"
python3 tools/compile_check.py --jobs 8    # ~1 minute; writes docs/generated/compile_report.md
```

Differences from the MSVC run, all handled in the tools: clang errors where MSVC warns about argument-count mismatches,
so promotion-safe functions get an unprototyped declaration (`T f();`) in `decl_all.h`; `-Wno-return-mismatch` and the
pointer/int conversion warnings are switched off; called-but-undeclared CRT names (`_free`, `_malloc`, thunks) are declared
as functions; `(*DAT_x)(...)` import slots are retyped as `code *`. Error "codes" are clang's `-W` flag or a slug of the message.

**Result on macOS (i686 syntax check): 31,730 of 34,487 functions (92.0%) pass.** The rest are mostly globals typed as byte arrays but used as
`float`/`double`, calls whose argument count disagrees with the inferred signature of a function with `float`/narrow
parameters, and pointer/float casts. Next milestone (arm64 object code) needs a 64-bit-clean pointer strategy.

### Native arm64 object code

```
python3 tools/build_arm64.py [--fresh]     # ~2 minutes; --fresh forgets earlier stubs and re-derives them
```

Generates `gen/`, syntax-checks it with `clang --target=arm64-apple-macos`, replaces every function that still fails with a
`GHIDRA_STUB()` trap (name list: `docs/generated/failed_functions_arm64.txt`, with addresses in `gen/stubbed_functions.csv`),
compiles all 344 sources to Mach-O arm64 objects in `build/arm64/` and archives them as `libthemovies.a`.
macOS has no `windows.h` and MinGW's `long` is 32-bit, so `tools/win32_slice.py` cuts the Win32/CRT declarations the sources
actually use out of the i686 MinGW headers into `gen/win32_compat.h`, with `long` rewritten to `int` and `#pragma pack` kept.

Reading the reports: `compile_report_arm64.md` re-checks sources whose failing functions were already replaced by stubs, so its
headline is ~100% by construction. The line below it ("never failed") is the real pass rate (about 92%, the same as the i686 check).

Current result: **34,487 functions defined, 2,762 of them stubbed (8.0%)**, 19.2 MB library. 15,157 symbols are still undefined:
mostly data/code labels (`DAT_`, `PTR_`, `LAB_`: the globals have no storage yet), Win32/DirectX imports and CRT functions.
This is a build of the code, not a runnable game: pointers are 64-bit while the code keeps them in 32-bit `int`s, `this` is not
passed in ECX, and there is no data segment. Next: storage for the globals, import/CRT shims, then a 32-bit address-space strategy.

## Class attribution (`tools/attribute_classes.py`)

About 30,000 functions are still `FUN_*` and most of the rest are named without a class, so nothing can be grouped into modules or
used for class layout recovery. The tool attributes functions to classes from several kinds of evidence and measures how reliable
each combination is by hiding known labels and trying to recover them.

```
python3 tools/attribute_classes.py --exe "<game>/MoviesSE.exe"      # about 20 seconds; needs objdump (macOS: Xcode tools)
```

Evidence: the function's own name or vtable reference; RTTI virtual slots and constructor candidates; machine code that stores a
class's vtable pointer into `this` (97% right); address adjacency (the linker keeps one source file's functions together: 88-96% right
when the nearest labelled functions on both sides agree and are close, only 50% when just one side is known); and callers that pass
ECX = `this`. `objdump` disassembles the PE directly; each function is scanned once for `this` aliases, calls that forward `this`,
vtable stores and touched field offsets. A method cannot touch a field beyond the class size when RTTI knows it exactly.
What did **not** work as evidence (each measured by hiding known labels, so it is not used): string literals and constants (23-45%
right once vtable addresses are excluded), global variables (28-50%), call-graph callees and callee-set similarity (31-35%),
field-offset profiles (about 70% but only a few dozen functions), function-pointer tables other than vtables (63-77%, few functions),
functions whose address is taken by code (33%), members passed as `this + offset` (almost no cases), and `this` passed as a
stack argument to static helpers (10%). Shared strings, ini keys and constants are used by unrelated classes, and most unattributed
methods have no unique link to their class that static analysis can see.

Where the exact class is wrong it is mostly a base or derived class: 93 of the 126 misses for the best adjacency evidence in one test
were inheritance-related (for example `CSITTCondition` versus `CSITTConditionIsClass`, whose methods sit in the same source file).
So each combination of evidence is also calibrated for "the class or a base/derived class". Functions that reach 85% only at that
level get tier FA (70% tier FB): good enough to group functions into modules, not to name the class.

Result on the current project (30,775 `FUN_*` functions): 6,478 get their class from names/RTTI/vtable stores, **1,185 more are
attributed with at least 85% measured precision (tier A), 2,744 with 70-85% (tier B), and 463 more at family level (tier FA/FB)**;
1,338 look like template or library code and 18,567 have no reliable evidence. Checked out of sample with fresh random hidden
labels: tier A 85-93% exactly right (90-94% right or related), tier B 75-77% (86-89%), tier FA 91-96% right or related (33-38%
exactly right, as expected). The labelled functions used for the test are mostly virtual methods and constructors, so the
precision on plain helper functions may differ. Of the 15,664 unattributed functions in game code, about 10,100 are `__thiscall`
methods and 6,000 are static or free functions (many of which may belong to no class).

The strongest evidence that is still missing is dynamic: logging the vtable pointer behind ECX each time a method runs gives the
real class of `this` (and, across calls, the declaring base class) for every executed method. The coverage tracer already stops at
every function entry; adding that read needs the Windows test box.
Outputs (gitignored, they hold game-derived names): `docs/generated/class_attribution.csv` / `.md`, and
`class_attribution_names.csv` (address, `<Class>_sub_<addr>` for the tier A functions that are still `FUN_*`) for the Ghidra
ApplyNames script. Tier B is not turned into names; review it or add evidence first.

## Running the game on the Windows test box (what it took, and what the traces gave)

Tools: `tools/winbox/` (setup script, `run_interactive.ps1`, jobs in `tools/winbox/jobs/`). SSH logons have no desktop, so every job that
needs the game or the screen runs through a scheduled task in the logged-in console session. `launch_game.ps1` starts `MoviesSE.exe` with
`TheMoviesDebugger.dll` injected (`-Coverage` adds the first-call tracer and the this-class log), `new_game.ps1` clicks Game > Quick
Start > accept, `hotkey.ps1` presses the tracer hotkeys, `analyze_this_log.py` and `steady_state.py` turn the logs into class evidence
and the steady-state function set.

What stops the game from starting on a modern machine without a GPU (all found by running it):
- **Stale flags in `HKCU\Software\Lionhead Studios Ltd\TheMovies`.** The game writes `Game running:` = Yes at start and `OpenDx` = Yes
  just before opening Direct3D, and clears them on a clean exit / after Direct3D opened. A stale value shows the "did not shut down
  properly" prompt (Cancel/No continues) or the "old version of DirectX" dialog. The launch scripts delete both values first.
- **Fullscreen fails** when the display has a single mode (the Basic Render Driver: 1280x800 only): CreateDevice rejects 800x600 and
  1024x768 fullscreen. Setting the registry value `Fullscreen` to `0` gives a window, which works under WARP (software Direct3D).
- **OpenAL32.dll** must be installed (Creative's `oalinst.exe`, signed).
- **Large-address-aware flag** on `MoviesSE.exe` (`tools/winbox/jobs/patch_laa.ps1`, `editbin /LARGEADDRESSAWARE`): without it the
  game crashed with an access violation in a `rep movsl` copy right after a new studio finished loading (PCGamingWiki documents this
  crash). Only four header bytes change (flag and checksum); the original is kept as `MoviesSE.exe.orig`, SHA-256 `48f909d7...566a`.
- **Mouse**: the game reads the mouse through DirectInput. Absolute cursor positioning is ignored, only relative motion counts (about
  1.5 screen pixels per unit), and the cursor is clamped to the window, so a scripted click first parks the cursor in a corner. The
  compatibility flags "disable fullscreen optimizations" and the high-DPI override are needed for it to work at all.
- The "first time you are running" notice appears at every start (OK only); the helper presses it.

What the traces showed (new-game Quick Start, then 2 game years: 1960.0 to 1962.04, no crash):
- **9,458 distinct functions (27% of the 35,039 listed) were reached** (the log has 12,789 lines because a re-arm with F8 logs the
  functions again): 5,672 during boot, menus and loading, 2,994 in the first game month, then very few: 146, 63, ... After a re-arm
  (F8) the next month lists 3,034 functions and the following months add 783 more: the **steady-state set of about 3,800
  functions** the game runs while it manages a studio (`tools/steady_state.py`). Of the 30,775 unnamed functions, 8,094 (26%) are now
  known to run.
- The calendar year boundary (January 1961 and 1962) added one to three functions: nothing runs only at new year. The Stunts &
  Effects content unlock (April 1961) added about 70 functions around the research system and a further 20 for the alert.
- **Class of `this`** (`coverage_this.csv`): for every method that ran, ECX's vtable pointer. 3,673 functions have an observed class.
  Against functions whose class was already known: single-class observations are right 80% of the time exactly and 84% within the
  inheritance family; several different classes give 44% / 71% (the closest-common-base guess is weak). The static attributions are
  confirmed independently: tier A 90% consistent with the dynamic class, tier B 88%.
- Start-up facts: the game clock starts at 1960.0 for a Quick Start; `MONTH_n` markers are whole months since year 0 of the clock.

## Comparing two binaries (`MoviesSE.exe` and `StarMaker.exe`)

`ghidra/scripts/FunctionHashes.java` writes one line per function with fingerprints that survive a rebuild of the same source (a hash of the mnemonic sequence, and one of the mnemonics plus operands with addresses and large numbers replaced), so functions can be matched between two builds without addresses or names. `ghidra/scripts/DecompileAddrs.java` decompiles chosen functions, their callers and optionally the disassembly (the decompiler loses stack-passed float arguments in both binaries; the instructions show the real order). `ghidra/scripts/FindRefs.java <addr>...` lists every reference to an address with its containing function: the way to find the code that uses a string (find the string's virtual address in the file, then ask for its references; used to locate the StarMaker UI, save and makeup code from tooltip and file-name strings; wide strings are UTF-16 in the exe). `tools/match_binaries.py` matches the two fingerprint tables, and its `--out` `matches.json` carries names between the two binaries (the 1:1 matches with real names became `tools/starmaker_names.csv`; names found in StarMaker for shared code go back into `tools/ghidra_names.csv`). Before changing a live Ghidra project copy it (`cp -R`), dry-run `ApplyNames.java` first, and check a second dry run shows 0 changes. Commands, the numbers (89% shared) and the findings are in `docs/STARMAKER.md`. Run them headless against a copy of the project, or a separate project for the second binary, so the main Ghidra project is not touched.

## What this does not do yet

- No object code is produced or linked (`/Zs` only); calling-convention rewriting at call sites (`__thiscall`) is not done.
- Struct layouts are skeletons: fields are not typed, only sizes and vtables are known.
- Data (vtables, string tables, static initialisers, resources) is not reconstructed.

## Refreshing names from Ghidra

`tools/rename_priority.py` now prefers `tools/ghidra_names.csv` (address,name for every function in the live Ghidra project) over the stale `ExportDecompiled/index.csv` + `renames.csv`. To refresh it: call the Ghidra MCP `list_functions` tool (the result is saved to a JSON file of `"<name> at <addr>"` lines), convert it to `tools/ghidra_names.csv`, then run `python tools/rename_priority.py`. Last refresh: 60,838 functions, 31,030 still named FUN_*.
