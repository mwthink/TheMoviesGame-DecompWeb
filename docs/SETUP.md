# Setting up a machine

What you need to work on the project, where this machine's paths go, and how to rebuild everything that is not in the repository.

## You need

- **Your own copy of *The Movies* with *Stunts & Effects*, patch 1.2.** Every address in the docs refers to `MoviesSE.exe` with SHA-256
  `48f909d7f89051ff0d3277f7dc0aa7c65cd1c92015542fcbc3d5f86700b1566a`. On a Mac it runs under CrossOver (`WINE_CROSSOVER.md`).
- **Node 22.18 or newer** for the web app (`WEB.md`); **Python 3** (standard library only) for the tools.
- For reverse engineering: Ghidra (12.x), and `objdump` (Xcode command line tools on macOS) for `tools/attribute_classes.py`.
- For the debugger DLL: a Windows machine with 32-bit MSVC (`WINDOWS_TEST_BOX.md`). Nothing in it builds on the Mac.

## This machine's paths: `local.env`

Copy `local.env.example` to `local.env` at the repository root (gitignored) and set `OTM_GAME_DIR` to the game folder, the one holding `MoviesSE.exe`
and `Data/pak`. The web dev server and tests (`web/localPaths.ts`) and the Python tools (`tools/local_paths.py`) read it; an environment variable of the
same name wins. Saved games and StarMaker stars default to the folders the game itself writes (`~/Documents/The Movies/Saved Games`,
`~/Documents/The Movies/StarMaker`).

Nothing in the repository names a particular machine, save or star. Tests that need a save find one by what it is (`web/localPaths.ts`, `SAVE_ROLES`: a
fresh studio on 1 January 1920, a Quick Start on 22 January 1960) and skip when there is none.

## Game files for the tools

The tools read extracted files from `data/game_data/` (`OTM_GAME_DATA` overrides it); the web app needs none, it reads the archives directly.

```
python3 tools/pak_extract.py extract "<game>/Data/pak" data/game_data releasing_movies.ini stunts.ini global.ini experience.ini awardsbonuses.ini timeline.csv
python3 tools/fetch_assets.py "<save>.jad" "<game>/Data/pak"          # every ini, mesh and texture one save needs (about 2 minutes)
```

The StarMaker tools and tests also use `data/game_data/sm_assets` (`mannequin_sm.anm`, `sm_generic.msh`, `generic_facialskin.msh`, `fe_*.anm`, `eyes.dds`, head
textures, `mup_*.dds`, `hair_*`, `starmaker.ini`; extract with `--tree` where names collide with thumbnails) and stars saved in the editor.

## Local-only state, and how to rebuild it

| What | Where | Rebuilt by |
|---|---|---|
| Ghidra project for `MoviesSE.exe` | outside the repo | import the exe, auto-analyse, then `ApplyNames.java` with `tools/ghidra_names.csv` (`ANALYSIS_TOOLS.md`) |
| Ghidra project for `StarMaker.exe` | outside the repo | the same with `tools/starmaker_names.csv` (`STARMAKER.md` section 2) |
| Decompiler export | `data/ExportDecompiled/`, `data/ExportDecompiledStarMaker/` | `ghidra/scripts/ExportDecompiled.java` |
| Extracted game files | `data/game_data/` | `tools/pak_extract.py`, `tools/fetch_assets.py` |
| Runtime logs (traces, `decade_log.csv`, screenshots) | `data/runtime/<run>/` | a run on the box or under Wine (`tools/winbox/mac/pull_logs.sh`) |
| Generated reports | `docs/generated/` | the tools in `ANALYSIS_TOOLS.md` (`rtti_dump.py`, `attribute_classes.py`, `progress.py`, ...) |
| Character viewer data | `viewer/data/` | `tools/export_person.py`, `tools/export_character.py` (`ANM_FORMAT.md`) |

`tools/ghidra_names.csv` and `renames.csv` are the record of the naming work: keep them current, and back up a Ghidra project (`cp -R`) before applying names to it.

## Tools by task

```
# saved games (SAVE_FORMAT.md, SCRIPTS.md, CHARACTERS.md)
python3 tools/jad_dump.py "<save>.jad"                     # summary; --class CStar, --lists, --map [--svg f.svg]; two saves = a diff
python3 tools/jad_dump.py "<save>.jad" --terrain out.png --footprints <ini+msh dir> --roofs <dds dir> --ground <land dds dir> --crop -64,-8,64,72
python3 tools/script_dump.py "<save>.jad" [--project ID]     # scripts and their state
python3 tools/script_quality.py "<save>.jad" "<game>/Data/pak"
python3 tools/save_cast.py "<save>.jad"                      # people, heads and costumes

# models, textures, animation (MSH_FORMAT.md, ANM_FORMAT.md)
python3 tools/msh_dump.py data/game_data/meshes/*.msh
python3 tools/anm_dump.py <file.anm>
python3 tools/export_person.py "<game>/Data/pak" --save "<save>.jad" --list    # --person ID / --all builds viewer/data/

# text and rooms
python3 tools/lhts.py "<stringdatabase.lhts>" --grep ROOM_
python3 tools/list_rooms.py "<game>/Data/pak" "<stringdatabase.lhts>"

# StarMaker (STARMAKER.md)
python3 tools/render_star.py <star folder> <assets dir> <out.png> [--expr FRAME[:INTENSITY]] [--yaw DEGREES] [--size N]
python3 tools/render_expression.py <dir with generic_facialskin.msh, fe_<head>.anm> <head.dds> <out.png> <frame[:intensity]>
python3 tools/starmaker_sliders.py <sm_assets> <starmaker.ini> <star.hd of an all-default star> <test star.hd> <info.sm of the test>

# interface movies (FRONTEND.md)
python3 tools/pak_extract.py extract "<game>/Data/pak" data/pak_ui '*.mfl' --tree
python3 tools/swf_dump.py <file.mfl> [--calls]
python3 tools/mfl_callbacks.py data/pak_ui

# reverse engineering (ANALYSIS_TOOLS.md)
python3 tools/rtti_dump.py ; python3 tools/attribute_classes.py --exe "<game>/MoviesSE.exe" ; python3 tools/progress.py
python3 tools/callgraph.py --build && python3 tools/net_map.py && python3 tools/p4api_map.py
python3 tools/steady_state.py data/runtime/<run>/coverage_log.csv ; python3 tools/analyze_this_log.py data/runtime/<run>/coverage_this.csv
python3 tools/check_ai_decide.py data/runtime/<run>/decade_log.csv

# before every commit
python3 tools/audit_firewall.py
```
