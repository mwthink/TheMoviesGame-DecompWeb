# Analysis tools: tracing, class attribution and naming

How the project reads `MoviesSE.exe`: Ghidra for the static side, the debugger DLL for the running game, and scripts that join the two. Scripts are in
`tools/` and `ghidra/scripts/`; everything they generate goes to `docs/generated/` or `data/` (gitignored, because it holds names and numbers taken from
the game). Regenerate rather than copy.

## Names: the one durable record

`tools/ghidra_names.csv` (address, name) is every function name in the live Ghidra project; `renames.csv` holds the evidence for each name a person or
an agent chose. A Ghidra project can be rebuilt from the binary plus these two files, so they, not the project, are what must not be lost.

- **Apply names to a project**: `ghidra/scripts/ApplyNames.java` (headless:
  `analyzeHeadless data/ghidra/MoviesSE TheMovies -process MoviesSE.exe -noanalysis -scriptPath ghidra/scripts -postScript ApplyNames.java <abs path to tools/ghidra_names.csv> [dry] [create]`).
  Copy an existing project first (`cp -R`), dry-run, apply, and check that a second dry run reports 0 changes. On a freshly analysed project add `create`: about
  1,280 named addresses have no function after auto-analysis, and `create` makes them (a dry run never creates, so it still lists them). One address
  (`CStar_GetMoodAnimationName`, 0x58F540) stays without a function after that.
- **Refresh the CSV from a project**: export the function list (`name at address` lines) and convert it to `tools/ghidra_names.csv`, then run
  `tools/rename_priority.py`.
- **Export the decompiled C** for grep: `ghidra/scripts/ExportDecompiled.java` writes `data/ExportDecompiled/` (`index.csv` plus `decomp_NNNN.c`). Re-export after
  a batch of names so the export carries them. `tools/apply_renames.py` applies `renames.csv` to an existing export.
- **Read a few functions closely**: `ghidra/scripts/DecompileAddrs.java <out> <addr>... [--callers] [--asm]` (the decompiler loses stack-passed float
  arguments; `--asm` shows the real order) and `FindRefs.java <addr>...` (every reference to an address, the way to find the code that uses a string).

## The debugger DLL and the first-call tracer

`debugger/` builds `TheMoviesDebugger.dll` and `TheMoviesInjector.exe` (32-bit MSVC, MinHook). It runs on the Windows test box and under CrossOver
(`WINDOWS_TEST_BOX.md`, `WINE_CROSSOVER.md`). Besides its hooks (`GameHooks`, `DecadeTracker`: the logged values that `verified` tags rest on, written to
`decade_log.csv`), it has a first-call coverage tracer (`debugger/src/hooks/CoverageTracer.cpp`):

- It plants an INT3 on the first byte of every function in `coverage_functions.txt` (about 35,000 entries, built by `tools/gen_function_list.py` from the
  export index, `library_map.csv` and `renames.csv`). A vectored exception handler logs the first entry of each function (sequence, microseconds, thread,
  phase, RVA), restores the byte and continues: one exception per function per run. Functions already detoured by MinHook are skipped.
- The list file's presence enables it, so normal sessions are unaffected. Output: `coverage_log.csv` next to the game; `coverage_summary.txt` on F10.
- Hotkeys: **F9** a marker (the next phase lists only newly reached functions), **F8** re-arm everything plus a marker (the next phase lists its complete
  set), **F10** a summary. Automatic markers: `GAME_CLOCK_STARTED` when a game loads, `MONTH_n` each game month (whole months of the game clock; a Quick Start
  starts at `MONTH_23503`, January 1960).
- **`this`-class mode** (`coverage_this.txt` present): for every method that runs, the vtable behind ECX, i.e. the real class of `this`. It keeps functions armed
  with the trap flag, which Rosetta does not implement, so it works only on the box.
- Start-up coverage needs the DLL in before `WinMain`: `TheMoviesInjector.exe --launch MoviesSE.exe TheMoviesDebugger.dll` starts the game suspended, parks the
  main thread on a `jmp $` at the entry point, injects, waits for the DLL's `TheMoviesDebugger.InitDone` event and resumes. `tools/run_coverage.ps1` does it all.

Reading the logs: `tools/steady_state.py <coverage_log.csv>` (per-phase sets; the steady-state set after an F8 re-arm), `tools/analyze_this_log.py
<coverage_this.csv>` (class evidence from the `this` log), `tools/rename_priority.py <coverage_log.csv>` (unnamed functions the game really runs, ranked by class).

### What the traces showed

Quick Start, then two game years (1960.0 to 1962.04), on the box, no crash:

- **9,458 distinct functions (27% of the 35,039 listed) ran**: 5,672 during boot, menus and loading, 2,994 in the first game month, then very few (146, 63, ...).
  After an F8 re-arm the next month lists 3,034 and the following months add 783 more: a **steady-state set of about 3,800 functions** for managing a studio.
  These runs did not make a movie, so the movie pipeline (script, casting, shoot, release) is not in that set yet.
- The calendar year boundary adds one to three functions. The Stunts & Effects unlock (April 1961) adds about 70 around research and 20 for the alert.
- 3,673 functions have an observed `this` class. Against functions whose class was already known, a single observed class is exactly right 80% of the time and
  within the inheritance family 84%; several observed classes give 44% / 71%.

## RTTI skeleton

`tools/rtti_dump.py --exe <MoviesSE.exe>` (default: `OTM_GAME_DIR`) writes `docs/generated/rtti_classes.json`: 2,066 classes found through MSVC RTTI (2,009 with
vtables), each with its demangled name, every vtable (address, `this` offset, slot functions and their names), base classes, constructor candidates and a size
(1,095 exact, from `operator new(size)` followed by the constructor; the rest a lower bound from the highest field the constructor touches), and
`docs/generated/classes.h`, a C skeleton with one vtable struct per class. `tools/globals_table.py` lists the 11,303 referenced globals with section, use counts
and a guessed type (votes over the casts Ghidra left; a guess, the `type_votes` column shows the evidence).

## Class attribution (`tools/attribute_classes.py`)

About 30,000 functions are still `FUN_*`, and most named ones have no class. The tool attributes functions to classes from several kinds of evidence and
**measures how reliable each combination is** by hiding known labels and trying to recover them.

```
python3 tools/attribute_classes.py --exe "<game>/MoviesSE.exe"      # about 20 seconds; needs objdump (macOS: Xcode tools)
```

Evidence used: the function's own name or vtable reference; RTTI slots and constructor candidates; machine code that stores a class's vtable into `this` (97%
right); address adjacency (the linker keeps one source file's functions together: 88-96% right when the nearest labelled functions on both sides agree and are
close, 50% with one side); callers that pass ECX = `this`. A method cannot touch a field beyond the class size when RTTI knows the size exactly.

Measured and **not** used (each by hiding labels): string literals and constants (23-45%), globals (28-50%), callees and callee-set similarity (31-35%),
field-offset profiles (about 70%, few functions), non-vtable function-pointer tables (63-77%, few), address-taken functions (33%), `this + offset` members (almost no
cases), `this` as a stack argument (10%).

Where the exact class is wrong it is mostly a base or derived class (93 of 126 misses in one test), so each combination is also calibrated for "the class or a
relative": functions that reach 85% only at that level get tier FA (70%: FB), good enough to group functions into modules, not to name the class.

Result after the latest names: 6,475 functions with a known class, **+1,222 at 85% or better measured precision (tier A), +2,800 at 70-85% (tier B), +598 at
family level**, 18,220 with no evidence. Out of sample: tier A 85-93% exactly right (90-94% right or related), tier B 75-77% (86-89%). The dynamic `this` log agrees:
tier A 90% consistent with it, tier B 88%. When `p4api_map.csv` is present the tool re-labels the Perforce client `P4API` (`NETWORK.md`).

Outputs (gitignored): `docs/generated/class_attribution.csv` / `.md`, and `class_attribution_names.csv` (`<Class>_sub_<addr>` for tier A functions still `FUN_*`)
for `ApplyNames.java`. Tier B is not turned into names.

## Call graph and source files

`tools/callgraph.py --build` writes a static call graph from the export; `tools/source_files.py` assigns functions to original source files from the embedded
assert paths. `tools/net_map.py` and `tools/p4api_map.py` regenerate `net_map.csv` / `p4api_map.csv` from them (run after names change).

## Comparing two binaries (`MoviesSE.exe` and `StarMaker.exe`)

`ghidra/scripts/FunctionHashes.java` writes fingerprints per function that survive a rebuild of the same source (a hash of the mnemonic sequence, and of mnemonics
plus operands with addresses and large numbers replaced). `tools/match_binaries.py` matches two such tables; its `--out` `matches.json` carries names between the
binaries (StarMaker's 1:1 matches with real names are `tools/starmaker_names.csv`; names found in StarMaker for shared code go back into
`tools/ghidra_names.csv`). Run it against a copy of the main project, or a separate project for the second binary. The numbers (89% shared) and the findings are in
`STARMAKER.md`. `tools/match_fable.py` did the same against Fable's published decompile (`LIBRARIES.md`).

## Progress

`tools/progress.py` joins `tools/ghidra_names.csv` with the `// orig: 0x...` tags in the reimplementation and writes `docs/generated/progress.md`
(unnamed -> named -> reimplemented -> verified, per class). Per-system status is in `STATUS.md`.
