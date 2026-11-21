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
- **Status: built and wired in, not yet run against the game.** First run: use `run_coverage.ps1`, press F9 at the main menu,
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

## What this does not do yet

- No object code is produced or linked (`/Zs` only); calling-convention rewriting at call sites (`__thiscall`) is not done.
- Struct layouts are skeletons: fields are not typed, only sizes and vtables are known.
- Data (vtables, string tables, static initialisers, resources) is not reconstructed.

## Refreshing names from Ghidra

`tools/rename_priority.py` now prefers `tools/ghidra_names.csv` (address,name for every function in the live Ghidra project) over the stale `ExportDecompiled/index.csv` + `renames.csv`. To refresh it: call the Ghidra MCP `list_functions` tool (the result is saved to a JSON file of `"<name> at <addr>"` lines), convert it to `tools/ghidra_names.csv`, then run `python tools/rename_priority.py`. Last refresh: 60,838 functions, 31,030 still named FUN_*.
