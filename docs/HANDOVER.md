# Handover: where the project stands and how to continue

Written 2026-11-21 for the next person or agent. Read this first, then the doc each section points to. Everything here was true at
commit `165a811`. **Updated 2026-11-24** with the save-game, terrain/placement and model/texture work (rows and sections marked *(2026-11-24)*).

## What this is

A reverse-engineering and reimplementation project for *The Movies* (2005) / *The Movies: Stunts & Effects* (`MoviesSE.exe`, patch
1.2, SHA-256 `48f909d7f89051ff0d3277f7dc0aa7c65cd1c92015542fcbc3d5f86700b1566a`). The repository holds notes, tools and original code,
never the game or its assets (`tools/audit_firewall.py` enforces that; run it before every commit). The goal of `src/` is a readable
portable C++ reimplementation, written from the decompiled code and the documented formulas and checked against the running game.

## State at a glance

| Area | State |
|---|---|
| Ghidra | 60,838 functions; 30,775 still `FUN_*`. Names live in `tools/ghidra_names.csv` (refresh from Ghidra, apply with `ghidra/ApplyNames.java`) |
| `src/` | portable C++17, 7 test executables + `otm_movie_calc`; `tools/progress.py`: 44 functions reimplemented, 12 verified against logged game values |
| Class attribution | `tools/attribute_classes.py`: 6,478 functions with a known class, +1,185 at >=85% (tier A), +2,744 at 70-85% (tier B), +463 family-level; 18,567 without evidence |
| Runtime tracing | first-call coverage tracer + this-class log run on a Windows test box: 9,458 distinct functions (27%) seen over 2 game years; steady-state set about 3,800 functions; 3,673 functions with an observed `this` class |
| Windows test box | set up, key login from the Mac, game runs windowed under software Direct3D (see `WINDOWS_TEST_BOX.md`, `DECOMP_PIPELINE.md`) |
| Wine on the Mac | the game runs under CrossOver (menu, Quick Start, gameplay, sound); loads are very slow (Rosetta). Debugger DLL: hooks and first-call coverage work there, `this`-class mode crashes (trap flag under Rosetta). See `WINE_CROSSOVER.md` |
| Saved games *(2026-11-24)* | `.jad` container parsed and field names resolved (`tools/jad_dump.py`, `docs/SAVE_FORMAT.md`), from three Wine saves. Terrain paint map, occupancy bitmap, placed-asset positions decoded. Python only: nothing in `src/` yet, nothing loaded back into the game |
| Lot, placement, models *(2026-11-24)* | world-to-grid formula (2 units per cell, 256 x 256, origin at cell 128), the placement-footprint path in the code (`docs/MSH_FORMAT.md`), `.msh` header/materials/polygons/render geometry parsed (`tools/msh_dump.py`), DDS decoder (`tools/dds.py`), textured top-down render of a save (`jad_dump.py --terrain ... --ground --roofs`). Checked by eye against the running game: placement, rotation, ground blend, textures and lighting match |
| Not started | struct/type recovery, library function identification, anything beyond the movie/staff economy in `src/`, any real renderer/UI/engine work (the render above is a one-off Python view), animation/skeleton/`.flm` playback, the simulation outside movies and staff |

## Documents

| File | Contents |
|---|---|
| `README.md` | layout, what is and is not in the repo |
| `docs/REIMPLEMENTATION.md` | module layout, rules (`// orig: 0xVA` tags, when to write `verified`), build and test, status per module, `pak_extract.py` |
| `docs/DECOMP_PIPELINE.md` | Ghidra-export to C pipeline, class attribution method and numbers, **running the game on the box and what the traces showed** |
| `docs/WINE_CROSSOVER.md` | running the game under CrossOver/Wine on the Mac: what it needed (LAA, ASF writer via WMP11, OpenAL), steps, performance |
| `docs/WINDOWS_TEST_BOX.md` | what the test box is and how it was set up (the plan, plus what turned out to be needed) |
| `docs/MOVIE_QUALITY.md`, `MOVIE_SUCCESS.md`, `STUNT_SYSTEM.md`, `TRAITS_AND_EXPERIENCE.md` | decoded formulas with data and measurements (MOVIE_SUCCESS.md also holds the star rating, AI studios, save format notes and much more: grep it) |
| `docs/FLM_FORMAT.md` | the `.flm` scene format |
| `docs/SAVE_FORMAT.md` *(2026-11-24)* | the `.jad` saved-game container, value encodings, what is in a save by class, terrain and the 2-unit grid, save names to ini/mesh/texture files, what is still unknown |
| `docs/MSH_FORMAT.md` *(2026-11-24)* | `.msh` models checked against real files: header, textures, materials, polygon chunks, render geometry, lightmaps, and the code path from a mesh polygon to the placement footprint |
| `FINDINGS.md` | older notes, partly superseded |

## Build, test, tools (Mac, Apple silicon; Python 3 standard library only)

```
cmake -S src -B build/src && cmake --build build/src && ctest --test-dir build/src --output-on-failure
python3 tools/audit_firewall.py                       # before every commit
python3 tools/pak_extract.py extract "<game>/Data/pak" data/game_data releasing_movies.ini stunts.ini global.ini ...   # see REIMPLEMENTATION.md
build/src/otm_movie_calc --help                        # quality / success / revenue estimate, marketing comparison
python3 tools/attribute_classes.py --exe "<game>/MoviesSE.exe"     # needs objdump (Xcode); writes docs/generated/class_attribution*
python3 tools/analyze_this_log.py data/runtime/<run>/coverage_this.csv
python3 tools/steady_state.py data/runtime/<run>/coverage_log.csv
```
`tests/TuningLoaderTest` and `StaffTest` also check against the real game files when `data/game_data` holds them (`OTM_GAME_DATA` overrides
the folder); without them they report "skipped". `docs/generated/`, `gen/`, `build/`, `data/*` (except `data/identified_organized/`) are
gitignored: regenerate rather than copy.

## The Windows test box

Facts: Windows 11 Pro 24H2 (build 26100), one administrator account, no GPU (Microsoft Basic Render Driver / WARP), key login from the
Mac with the user's SSH key (the host and account are in the user's hands: set `BOX=<user>@<host>`), auto-logon so the console
desktop always exists. Tools and logs are under `C:\dev`; the game is `C:\Games\TheMovies` with the large-address-aware flag set on
`MoviesSE.exe` (original kept as `MoviesSE.exe.orig`). **Do not use a password for it** (one was shared in chat; use the key); do not
change its security settings (RDP, firewall, Defender, auto-logon): the user does that, `tools/winbox/setup_box.ps1` is the script.

Typical session (`tools/winbox/mac/README.md` explains each helper):
```
export BOX=<user>@<host>
tools/winbox/mac/sync.sh                                         # push scripts, debugger sources, coverage_functions.txt
tools/winbox/mac/wj.sh build build_debugger.ps1 ''               # MSVC x86 + vcpkg MinHook
TIMEOUT=3000 tools/winbox/mac/wj.sh cov launch_game.ps1 '-Coverage -Seconds 2400 -Tag cov' &    # game + tracer, keeps running
tools/winbox/mac/wj.sh ng new_game.ps1 '-Pause 5'                # menu > Game > Quick Start > accept (once the menu is up)
tools/winbox/mac/wj.sh hk hotkey.ps1 '-Key F8'                   # F8 re-arm (steady-state set), F9 marker, F10 summary
tools/winbox/mac/shot.sh now                                     # screenshot -> data/runtime/shots/now.png
tools/winbox/mac/pull_logs.sh run5                               # logs -> data/runtime/run5/
```
Stop the game with `Get-Process MoviesSE | Stop-Process -Force` on the box (the launch job does not kill it unless `-Kill`).

Things that cost time and are now solved (details in `DECOMP_PIPELINE.md`): stale `Game running:` / `OpenDx` registry flags show the "improper
shutdown" and "DirectX" dialogs (the scripts clear them); fullscreen fails on a one-mode display, so the registry value `Fullscreen` is `0`;
OpenAL had to be installed; without the large-address-aware flag the game crashes right after a new studio loads; the mouse is DirectInput
(relative motion, gain 1.5, needs the compatibility flags) so `lib_input.ps1` parks the cursor in a corner before every click; tracer hotkeys
need a held key (`hotkey.ps1`), not SendKeys; run jobs hidden (`run_interactive.ps1`), a visible console window covers the game.
SSH gotcha: a command string goes through cmd.exe first (`|`, quotes break); pass PowerShell as `-File`. winget needs `--source winget`
(the msstore source fails with a certificate error on this network).

Click coordinates in `new_game.ps1` and `lib_input.ps1` (`CornerX/CornerY`, gain) assume the default window placement on a 1280x800 desktop.
Read only the last screenshot of a scripted sequence (the user asked for that); open earlier ones only to work backwards from a wrong end state.

## Conventions

- Every reimplemented function carries `// orig: 0xVVVVVVVV`; add `verified` only when a measurement from the running game reproduces
  its result, and say what was measured (see `MovieSuccess.cpp` and its test).
- Formulas come from decompiled code and docs; where they disagree the comment says so (examples: the genre-fit factor is not a
  relationship factor; the public-interest imbalance term is one-sided in the code but symmetric in the old notes).
- Game-derived output (generated names, logs, extracted files) stays under gitignored paths. The `tools/audit_firewall.py` check must pass.
- Commit messages end with the `Co-Authored-By` line given by the harness; the user asks for commits explicitly (do not commit unasked).

## Next steps, in the order I would take them

1. **Trace the movie pipeline.** The steady-state run covers idle management only. Have the user play (or script) hiring, a script, casting,
   a shoot, post-production, release, with an F9 marker per step, then `steady_state.py`-style per-phase lists. Also exercise stunts, build mode,
   research and an awards ceremony (every five game years, 1965 for a 1960 start).
2. **Use `decade_log.csv`** (run logs in `data/runtime/`, or a fresh run) to verify more of `src/`: STAR_RATING, STUDIO_RATING, PAYOUT, AI_DECIDE,
   RESEARCH lines exist (about 1,600 SALARY and 430 STAR_CHART lines too). The trend/popularity check (96 of 96 lines within 6e-5) is done; the
   others are not.
3. **Verify the open questions with the box**: the public-interest imbalance term (release a movie with hype above 0.17 at marketing level 1-2 and
   compare the logged PI with `MovieSuccess`), mood/genre-fit/likeness values (new hooks needed: the DLL can log function arguments and returns),
   the stunt level factor (the decompile hides it).
4. **Fold the dynamic classes into the attribution** (`class_attribution_names.csv` for Ghidra's ApplyNames) and rerun after each longer trace;
   then identify library code (`library_map.csv`, zlib/ogg/vorbis, PK* audio/disk, CRT/STL) so it is not reimplemented.
5. **Struct/type recovery** for the classes the traces show (`CStar`, `TMCharacter`, `CStaff`, `CProject`, `TMRoom`, `WWindow`, `Scene`...):
   field offsets from the disassembly (`tools/attribute_classes.py` already scans `this` accesses), RTTI sizes, `docs/generated/classes.h`.
6. **Save-game reader** *(started 2026-11-24)*: the container, terrain, placed assets and many classes are decoded in `docs/SAVE_FORMAT.md` /
   `tools/jad_dump.py`. Next: port the reader into `src/` with tests that read saves (three exist: `~/Documents/The Movies/Saved Games` from the Wine run; the
   fresh studio, a tutorial save and a tutorial save with a queued facility); make a save with player-built sets/props (where they are stored is unknown); check
   whether the game accepts an edited save (lists of object ids and counts must stay consistent; untested); look at a save with released movies, a later decade and
   the non-Wine game. Open details are listed at the end of `SAVE_FORMAT.md` (the ~17 KB after the terrain occupancy bitmap, the runtime cell-grid flag bits,
   the meaning of the other mesh polygon chunks, ground tile scale 12 units and lightmap gain 2x which are assumed).
7. **Open decisions for the user**: whether the decompiler export (`data/identified_organized`) stays tracked; the licence of `src/`;
   the overall strategy (replace the original's functions from the inside through the injected DLL, versus building a standalone engine); how far
   to automate function-by-function reimplementation with a differential harness.

8. **Use the Wine setup** (`WINE_CROSSOVER.md`): (a) the debugger DLL runs under Wine (copied from the box); now compare one identical run (Quick Start, F9 per step, same game time) against the box, to learn whether
   Wine runs can be trusted for tracing, and replace the trap-flag re-arm in `CoverageTracer.cpp` so `this`-class mode works there;
   (b) have the user play there to produce save games for the save-game reader (item 6); (c) keep `verified` tags for box measurements until (a) agrees.

## Save, terrain and model tooling *(2026-11-24)*

```
python3 tools/jad_dump.py "<save>.jad"                                        # summary; --class CStar, --lists, --map [--svg f.svg], two saves = diff
python3 tools/pak_extract.py extract "<game>/Data/pak" data/game_data/save_assets facility_gatehouse.ini ...   # inis, then the meshes and textures they name
python3 tools/fetch_assets.py "<save>.jad" "<game>/Data/pak"                      # extract every ini/mesh/texture a save needs (about 2 min)
python3 tools/msh_dump.py data/game_data/meshes/*.msh                         # textures, materials, polygon chunks, room parts
python3 tools/jad_dump.py "<save>.jad" --terrain out.png --footprints <ini+msh dir> --roofs <dds dir> --ground <land dds dir> --crop -64,-8,64,72
```
Everything extracted lives under gitignored `data/game_data/`; renders go to `docs/generated/` (gitignored). The firewall audit passed after this work. Assets
needed per save are found from its `SourcePath` names (`docs/SAVE_FORMAT.md`, "From save names to game files"); a different save needs its own assets extracted.

## Known rough edges

- `tools/analyze_coverage.py` expects the old marker sequence and reports nothing useful for the current logs: use `steady_state.py`.
- The marker names `MONTH_n` count whole months of the game clock; 23503 was January 1960 for a Quick Start.
- `data/runtime/` holds the logs of the four runs of this session (gitignored); the numbers in the docs come from `run4`.
- `tools/winbox/setup_box.ps1` was run once on the box (SSH, power, exclusions, auto-logon, tools); `-Tools` fell over once on winget sources and
  was fixed by `--source winget`.
