# Reimplementation layout and workflow

Goal: a readable C++ reimplementation, organised by subsystem and class, not by original address or per function.

## Layout (under `src/` (new, in this repo), headers beside sources)

```
src/
  core/        MV:: / LH:: / PKStrings: strings, arrays, lists, memory, file IO, logging 
  engine/      renderer, SWF/LSWF, audio (vorbis), input, scene objects (MV::Object, FS::CObject)
  ui/          TM::W* windows, bubbles, HUD (WWindow, WInterface, WAdvMovieMaker...)
  game/
    studio/    CLot, TMRoom, TMFloorPlan, TMFixedAsset, builders
    staff/     CStaff, jobs, traits, experience   
    movie/     scripts, scenes, quality, success, stunts (see FINDINGS.md)
    economy/   finances, awards, decades
```

One `Class.hpp/.cpp` pair per class or tightly related group. Struct and enum definitions go in headers first;
bodies come after types are recovered. Classes come from `docs/generated/rtti_classes.json` (RTTI names = module names).

## Rules

1. Every reimplemented function carries `// orig: 0xVVVVVVVV` (the Ghidra VA); append `verified` once checked against the
   running game (e.g. through the DLL hooks): `// orig: 0x004A1230 verified`.
2. Behaviour-equivalent, not instruction-equivalent: real names, struct fields instead of pointer arithmetic, loops instead of gotos.
3. Rename in Ghidra as you go, then refresh `tools/ghidra_names.csv` (see DECOMP_PIPELINE.md).
4. Findings go in FINDINGS.md; formulas first, code second.
5. **Open question:** this repo currently commits `ExportDecompiled/` (full decompiler output). Decide whether reimplemented code
   is written by hand from the notes (recommended) and whether the export stays in the public repo.

## Progress tracking

```
python tools/progress.py
```
Writes `docs/generated/progress.csv` (address, name, class, status) and `progress.md` (per-class counts).
Status: `unnamed` -> `named` -> `reimplemented` -> `verified`, derived from names in `ghidra_names.csv` and the `orig:` tags in `src/`.

## Building and testing `src/`

Portable C++17, no external dependencies (the injected debugger in `debugger/` is the only Windows/32-bit part).

```
cmake -S src -B build/src && cmake --build build/src && ctest --test-dir build/src --output-on-failure
```

A module takes already-gathered numbers (cast performance, script quality, ...), not game objects, so its formulas can be tested
on their own; reading those numbers out of the game's classes comes with the class that owns the data. Tests check the worked
examples and measured values in `docs/` (see `src/tests/MovieQualityTest.cpp`). Add a source file to `src/CMakeLists.txt` with each module.
Put `verified` on a function only when a measurement from the running game reproduces its result, and say in a comment what was measured.

Status: `game/movie/MovieQuality` (`CQualityRating_Compute`, `CProject_ComputeFinalQuality` and the factor mappings) is the first module;
`CProject_ComputeFinalQuality` is verified against two measured movies, the rest is `reimplemented`.

