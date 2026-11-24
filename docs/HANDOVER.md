# Handover: where the project stands and how to continue

Written 2026-11-21 for the next person or agent. Read this first, then the doc each section points to. The 2026-11-21 sections were true at
commit `165a811`. **Updated 2026-11-24** with the save-game, script, terrain/placement, model/texture, animation/character and function-naming
work (rows and sections marked *(2026-11-24)*); counts below were refreshed at commit `aa8a60d`.

## What this is

A reverse-engineering and reimplementation project for *The Movies* (2005) / *The Movies: Stunts & Effects* (`MoviesSE.exe`, patch
1.2, SHA-256 `48f909d7f89051ff0d3277f7dc0aa7c65cd1c92015542fcbc3d5f86700b1566a`). The repository holds notes, tools and original code,
never the game or its assets (`tools/audit_firewall.py` enforces that; run it before every commit). The goal of `src/` is a readable
portable C++ reimplementation, written from the decompiled code and the documented formulas and checked against the running game.

## State at a glance

| Area | State |
|---|---|
| Ghidra | 60,838 functions; 30,677 still `FUN_*` after the 75 names added on 2026-11-24 (`renames.csv` has the evidence) and 23 character-appearance names from the StarMaker analysis (`CharacterHead_*`, `CharacterModel_*`, `MakeupLayer_*`, `Mesh_*`, `Texture_Draw*`, `AnimInstance_EvaluatePose`; applied to the live project on 2026-11-24 after a backup in `~/ghidra-projects-backup-before-appearance-names`; table in `docs/STARMAKER.md` section 10). Names live in `tools/ghidra_names.csv`; apply them to a Ghidra project with `ghidra/scripts/ApplyNames.java` (headless: `analyzeHeadless <projectDir> TheMovies -process MoviesSE.exe -noanalysis -scriptPath ghidra/scripts -postScript ApplyNames.java <abs path to tools/ghidra_names.csv> [dry]`; the live local project had all 75 of the 2026-11-24 names applied and verified with a dry run). Another 34 networking names (`NetSocket_*`, `LHHttp_*`, `MV_Parse*`, `Net_*`) were applied to the live project on 2026-11-24 after a backup in `~/ghidra-projects-backup-before-network-names` (`docs/NETWORK.md`) |
| `src/` | portable C++17, 11 `ctest` groups + `otm_movie_calc` (game/movie, staff, studio, ai, boot, character); `tools/progress.py`: 45 functions reimplemented, 15 verified against logged game values |
| Class attribution (rerun 2026-11-24 after the new names) | `tools/attribute_classes.py`: 6,475 functions with a known class, +1,222 at >=85% (tier A), +2,800 at 70-85% (tier B), +598 family-level; 18,220 without evidence (before the rerun: 6,478 / 1,185 / 2,744 / 463 / 18,567). The comparison spans every name added since the 2026-11-21 run, not only the 75 new ones |
| Runtime tracing | first-call coverage tracer + this-class log run on a Windows test box: 9,458 distinct functions (27%) seen over 2 game years; steady-state set about 3,800 functions; 3,673 functions with an observed `this` class |
| Windows test box | set up, key login from the Mac, game runs windowed under software Direct3D (see `WINDOWS_TEST_BOX.md`, `DECOMP_PIPELINE.md`) |
| Wine on the Mac | the game runs under CrossOver (menu, Quick Start, gameplay, sound); loads are very slow (Rosetta). Debugger DLL: hooks and first-call coverage work there, `this`-class mode crashes (trap flag under Rosetta). See `WINE_CROSSOVER.md` |
| Saved games *(2026-11-24)* | `.jad` container parsed and field names resolved (`tools/jad_dump.py`, `docs/SAVE_FORMAT.md`), from three Wine saves. Terrain paint map, the path (pavement) bitmap, placed-asset positions decoded. Python only: nothing in `src/` yet, nothing loaded back into the game |
| Lot, placement, models *(2026-11-24)* | world-to-grid formula (2 units per cell, 256 x 256, origin at cell 128), the placement-footprint path in the code (`docs/MSH_FORMAT.md`), `.msh` header/materials/polygons/render geometry parsed (`tools/msh_dump.py`), DDS decoder (`tools/dds.py`), textured top-down render of a save (`jad_dump.py --terrain ... --ground --roofs`). Checked by eye against the running game: placement, rotation, ground blend, textures and lighting match |
| Scripts, characters, animation *(2026-11-24)* | script lifecycle in a save (writing, design, casting, rehearsal; `docs/SCRIPTS.md`, `tools/script_dump.py`, `tools/script_quality.py`), people and `.cos` costumes (`docs/CHARACTERS.md`, `tools/save_cast.py`, `tools/export_person.py`), `.anm` clips, skeletons and skinning (`docs/ANM_FORMAT.md`, `tools/anm_dump.py`), shown in the three.js viewer in `viewer/` (dev server `character-viewer` in `.claude/launch.json`) |
| `src/game/character/` *(2026-11-24)* | the StarMaker / character appearance code as tested C++ (`ctest`: `character`): face sliders and expressions on the skinned head, `info.sm`, makeup / hair / iris rules; see `docs/REIMPLEMENTATION.md` |
| StarMaker.exe *(2026-11-24)* | the character editor, imported into its own Ghidra project (`~/ghidra-projects-starmaker`, 1,317 names from `tools/starmaker_names.csv`) and matched to `MoviesSE.exe` function by function (`ghidra/scripts/FunctionHashes.java`, `tools/match_binaries.py`): about 89% of its code is shared engine code. **Decoded and checked against saved stars** (`docs/STARMAKER.md` sections 4 to 10): the star file `info.sm` (every field tied to a control), `star.hd` (the baked head: array A shape, B weight morph, C age morph), the 43 advanced face sliders (a face-rig animation `mannequin_sm.anm` + 4-weight skinning of `sm_generic.msh`, reproduced to 0.05 mm: `tools/starmaker_sliders.py`), the facial expressions (`.fan` index = frame of the head's `fe_<head>.anm` on `generic_facialskin.msh`, `tools/render_expression.py`), and the looks: makeup layers and draw order, hair texture / mesh with colour suffixes and the age grey, iris atlas cell, head and skin blend, weight and age (`tools/render_star.py`, `render_star_sheet.py`, `render_expression_gif.py`). Ported to C++ in `src/game/character/` |
| Function naming *(2026-11-24)* | 75 functions named from the decompiled code: movie cost accrual (`CProjectCosts_*`), quality/genre fit, AI star rating, terrain/path cells (`TMLandscape_*`), placement footprint (`LotGrid_*`, `Footprint_*`), FLM scene helpers, pak loading (`Pak*`), script quality. About 20 documented functions are still unnamed (`009fa970`, `009fe620`, `00a31bb0`, `00a44dd0`, `009db5f0`, `0051be40`, `00ab0150`, `00610190`, the `FINDINGS.md` loaders). Docs cite functions by name |
| Save/load code map *(2026-11-24)* | `tools/callgraph.py` (static call graph) and `tools/source_files.py` (original source file per function from embedded paths); the save pipeline end to end is in `SAVE_FORMAT.md` ("Where the save code sits"); 31 more functions named (`Savegame_*`, `Save_*`, `GameFile_*`, `File_*`, `SaveLoad_PumpRequests`). Header layout now exact |
| Not started | struct/type recovery, library function identification, anything beyond the movie/staff economy in `src/`, any real renderer/UI/engine work (the renders above are one-off Python/three.js views), `.flm` scene playback, the simulation outside movies and staff, building the generated C into a runnable binary (`DECOMP_PIPELINE.md`: only syntax checks and an arm64 library so far) |

## Documents

| File | Contents |
|---|---|
| `README.md` | layout, what is and is not in the repo |
| `docs/REIMPLEMENTATION.md` | module layout, rules (`// orig: 0xVA` tags, when to write `verified`), build and test, status per module, `pak_extract.py` |
| `docs/DECOMP_PIPELINE.md` | Ghidra-export to C pipeline, class attribution method and numbers, **running the game on the box and what the traces showed** |
| `docs/WINE_CROSSOVER.md` | running the game under CrossOver/Wine on the Mac: what it needed (LAA, ASF writer via WMP11, OpenAL), steps, performance |
| `docs/WINDOWS_TEST_BOX.md` | what the test box is and how it was set up (the plan, plus what turned out to be needed) |
| `docs/MOVIE_QUALITY.md`, `MOVIE_SUCCESS.md`, `STUNT_SYSTEM.md`, `TRAITS_AND_EXPERIENCE.md` | decoded formulas with data and measurements (MOVIE_SUCCESS.md also holds the star rating, AI studios, save format notes and much more: grep it) |
| `docs/SCRIPTS.md` *(2026-11-24)* | how a script is stored in a save and how script quality is computed |
| `docs/CHARACTERS.md`, `docs/ANM_FORMAT.md` *(2026-11-24)* | people and costumes in a save; `.anm` animations, skeletons, skinning and the viewer |
| `docs/STARMAKER.md` *(2026-11-24)* | `StarMaker.exe` (the character editor): what it is, how it was compared with MoviesSE (about 89% shared code), what it taught us so far (age/weight morph order, slider table, `.fan`, `head_shape.dat`), open questions |
| `docs/NETWORK.md` *(2026-11-24)* | the networking code in `MoviesSE.exe`: two stacks (the game's own HTTPLib/MV client behind `WOnlineScreen`, and the statically linked Perforce P4API client with its bundled zlib 1.0.4), how they were found, the layers, the dead server side, names, what is not decoded. Data: `net_map.csv`, `p4api_map.csv` (`tools/net_map.py`, `tools/p4api_map.py`) |
| `docs/FLM_FORMAT.md` | the `.flm` scene format |
| `docs/SAVE_FORMAT.md` *(2026-11-24)* | the `.jad` saved-game container, value encodings, what is in a save by class, terrain and the 2-unit grid, save names to ini/mesh/texture files, what is still unknown |
| `docs/MSH_FORMAT.md` *(2026-11-24)* | `.msh` models checked against real files: header, textures, materials, polygon chunks, render geometry, lightmaps, and the code path from a mesh polygon to the placement footprint |
| `FINDINGS.md` | older notes (radio/news, genre trend, audio engine, `.lug` loader), partly superseded |

## Build, test, tools (Mac, Apple silicon; Python 3 standard library only)

```
cmake -S src -B build/src && cmake --build build/src && ctest --test-dir build/src --output-on-failure
python3 tools/audit_firewall.py                       # before every commit
python3 tools/pak_extract.py extract "<game>/Data/pak" data/game_data releasing_movies.ini stunts.ini global.ini ...   # see REIMPLEMENTATION.md
build/src/otm_movie_calc --help                        # quality / success / revenue estimate, marketing comparison
python3 tools/attribute_classes.py --exe "<game>/MoviesSE.exe"     # needs objdump (Xcode); writes docs/generated/class_attribution*; re-labels P4API functions from p4api_map.csv
python3 tools/callgraph.py --build && python3 tools/net_map.py && python3 tools/p4api_map.py   # regenerate net_map.csv / p4api_map.csv (after any names change)
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
6. **Save-game reader** *(started 2026-11-24)*: the container, terrain, placed assets, scripts, people and many classes are decoded in `docs/SAVE_FORMAT.md` /
   `docs/SCRIPTS.md` / `tools/jad_dump.py`. Next: port the reader into `src/` with tests that read saves (three exist: `~/Documents/The Movies/Saved Games` from the Wine run; the
   fresh studio, a tutorial save and a tutorial save with a queued facility); make a save with player-built sets/props (where they are stored is unknown); check
   whether the game accepts an edited save (lists of object ids and counts must stay consistent; untested); look at a save with released movies, a later decade and
   the non-Wine game. Open details are listed at the end of `SAVE_FORMAT.md` (the ~17 KB after the terrain path bitmap, the runtime cell-grid flag bits,
   the meaning of the other mesh polygon chunks, ground tile scale 12 units and lightmap gain 2x which are assumed).
7. **Regenerate after the 2026-11-24 names** (Ghidra already has them, including the 23 character names): a fresh export with all names is ready in `data/ExportDecompiled_new` (72 files, finished 2026-11-24; the old `data/ExportDecompiled` is untouched): move it over `data/ExportDecompiled`, regenerate `gen/`, rerun `attribute_classes.py`, and name the ~20
   documented functions still left (see the Function naming row). Port the movie cost accrual (`CProjectCosts_AccrueUpdate` and helpers) into `src/` and check it against
   `PREPROD_COST` lines in `decade_log.csv`: that also settles whether pre-production wages are real cash out (`MOVIE_QUALITY.md`).
8. **StarMaker / character appearance, what is left** *(`docs/STARMAKER.md`, "still open" at the end of section 10)*: the two-texture blend (mode 0x25) of the eye makeup pair
   (the tools tint the shape with the colour's average); the constant ~1 mm shift in the baked head; the meaning of bit 0 of the blend flags (`model+0x38`); what `FUN_0043b3b0`
   does (vertex reorder into `.hd` order, used by the `star.hd` writer); the hair `a.dds` alpha maps and the `_nr.msh` hair variants; the `.fan` flag word (99, 998, 9998); the id word
   at `info.sm` 0x08 (a checksum, algorithm not read: `StarMaker_BuildInfoSm` calls `FUN_0042b9e0`); the real tick length of the expression envelope; the last six attribute rows' order.
   Researched, not built (`docs/STARMAKER.md` section 11; `InfoTextures.fas` is unused): the body / costume side (`.cos` texture layers, compositor `FUN_004707e0`), tattoo and nail layers, the UI code, and the 532 StarMaker-only functions.
   **Next port step:** DDS decoding and face-layer compositing in `src/` (so a star's face texture can be built in C++), then wiring `game/character` to the cast data of a save
   (`tools/save_cast.py`) so a person's face, makeup and expression can be built from a save; `verified` needs a run of the game's own functions (hooks) for the expression blend.
   Local-only files these tools and the `character` test read (none are in git): `data/game_data/sm_assets` (extracted `mannequin_sm.anm`, `sm_generic.msh`, `generic_facialskin.msh`,
   `fe_*.anm`, `eyes.dds`, head textures, `mup_*.dds`, `hair_*`, `starmaker.ini`; extract with `tools/pak_extract.py`, use `--tree` where names collide with thumbnails), the
   saved stars in `~/Documents/The Movies/StarMaker` (`OTM_STAR_DIR`), `data/ExportDecompiledStarMaker`, `~/ghidra-projects-starmaker`.
9. **Open decisions for the user**: whether the decompiler export (`data/identified_organized`) stays tracked; the licence of `src/`;
   the overall strategy (replace the original's functions from the inside through the injected DLL, versus building a standalone engine); how far
   to automate function-by-function reimplementation with a differential harness.

10. **Use the Wine setup** (`WINE_CROSSOVER.md`): (a) the debugger DLL runs under Wine (copied from the box); now compare one identical run (Quick Start, F9 per step, same game time) against the box, to learn whether
   Wine runs can be trusted for tracing, and replace the trap-flag re-arm in `CoverageTracer.cpp` so `this`-class mode works there;
   (b) have the user play there to produce save games for the save-game reader (item 6); (c) keep `verified` tags for box measurements until (a) agrees.

11. **Networking code, what is left** *(`docs/NETWORK.md`)*: (a) *(done 2026-11-24: the 34 names are in the live Ghidra project, backup
    `~/ghidra-projects-backup-before-network-names`, and in `tools/ghidra_names.csv`)*; (b) *(done: `attribute_classes.py` was run with the exe and the
    `P4API` re-label from `p4api_map.csv` works; 0x00ac1480 and 0x00ac14e0 are still labelled zlib, unresolved)*; (c) on the box,
    trace a played month and then the Online screen to confirm the static cone (`net_map.csv`) stays silent in play and lights up in
    the order UI, MV, HTTP, sockets; (d) decide what the reimplementation does with the Online screen (`net_map.csv` lists the UI
    functions that reach the library); (e) optional: the `Perforce::*` glue classes, the `X-MoviesContent-*` / `MV00xx` protocol.

## Save, terrain and model tooling *(2026-11-24)*

```
python3 tools/jad_dump.py "<save>.jad"                                        # summary; --class CStar, --lists, --map [--svg f.svg], two saves = diff
python3 tools/pak_extract.py extract "<game>/Data/pak" data/game_data/save_assets facility_gatehouse.ini ...   # inis, then the meshes and textures they name
python3 tools/fetch_assets.py "<save>.jad" "<game>/Data/pak"                      # extract every ini/mesh/texture a save needs (about 2 min)
python3 tools/msh_dump.py data/game_data/meshes/*.msh                         # textures, materials, polygon chunks, room parts
python3 tools/list_rooms.py "<game>/Data/pak" "<stringdatabase.lhts>"        # every room in the archives with the text the game draws on it
python3 tools/lhts.py "<stringdatabase.lhts>" --grep ROOM_                      # the localisation table (UI text keys)
python3 tools/jad_dump.py "<save>.jad" --terrain out.png --footprints <ini+msh dir> --roofs <dds dir> --ground <land dds dir> --crop -64,-8,64,72
python3 tools/script_dump.py "<save>.jad" [--project ID]                      # scripts and their state in a save (docs/SCRIPTS.md)
python3 tools/script_quality.py "<save>.jad" "<game>/Data/pak"               # recompute a script's quality from the save (Script_RecomputeQuality)
python3 tools/export_person.py "<game>/Data/pak" --save "<save>.jad" --list    # people with a costume; --person ID / --all builds viewer/data/
python3 tools/anm_dump.py <file.anm>                                         # decode an animation clip
```
Everything extracted lives under gitignored `data/game_data/`; renders go to `docs/generated/` (gitignored). The firewall audit passed after this work. Assets
needed per save are found from its `SourcePath` names (`docs/SAVE_FORMAT.md`, "From save names to game files"); a different save needs its own assets extracted.

## Known rough edges

- `tools/analyze_coverage.py` expects the old marker sequence and reports nothing useful for the current logs: use `steady_state.py`.
- The marker names `MONTH_n` count whole months of the game clock; 23503 was January 1960 for a Quick Start.
- `data/runtime/` holds the logs of the four runs of this session (gitignored); the numbers in the docs come from `run4`.
- `tools/winbox/setup_box.ps1` was run once on the box (SSH, power, exclusions, auto-logon, tools); `-Tools` fell over once on winget sources and
  was fixed by `--source winget`.
