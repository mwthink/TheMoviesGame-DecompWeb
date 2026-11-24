# The Movies (2005) — Reverse Engineering Notes

Fan reverse-engineering notes for **The Movies** and **The Movies: Stunts & Effects** (Lionhead Studios, published by Activision, 2005–2006).

This is an ongoing effort to understand how the game's simulation actually works under the hood — mechanics like genre popularity, the radio/news system, save-file structure, and various asset formats (`.msh`, `.lug`, `.pak`) — done by statically analyzing the shipped `MoviesSE.exe` in Ghidra and cross-checking the results against the real game data files.

The write-ups live in `docs/` (start with `docs/HANDOVER.md`); `FINDINGS.md` holds older notes, mostly the radio/news system, the audio engine and the `.lug` archive loader.

## What this is

- Original analysis: function/class identification, algorithm and data-structure documentation, decompiled-code excerpts (a handful of lines at a time, for illustration), and short quoted strings used as evidence (debug asserts, embedded source paths, error messages).
- A description of how various game systems and file formats work: the movie quality, success and revenue formulas (`docs/MOVIE_*.md`), the saved-game format (`docs/SAVE_FORMAT.md`, `docs/SCRIPTS.md`, `docs/CHARACTERS.md`), the `.msh` model format (`docs/MSH_FORMAT.md`), `.anm` animations and skinning (`docs/ANM_FORMAT.md`) and the `.flm` scene format (`docs/FLM_FORMAT.md`).

## What this is *not*

- No copies of the game binary, Ghidra project/database, or any extracted game assets (audio, textures, meshes, full data files) are included in this repo.
- Not affiliated with, endorsed by, or sponsored by Lionhead Studios, Activision, or their successors. All trademarks and copyrighted game content belong to their respective owners; this repo only contains original analysis and commentary about that content.

## Tools used

- [Ghidra](https://ghidra-sre.org/) for static analysis/decompilation of the executable.
- `tools/pak_extract.py`, an archive reader for pulling real data files (`.ini`/`.csv`/`.lhts`, meshes, textures) out of the game's `.pak` archives to verify inferences made from the disassembly (the earlier `reshoot.exe` is no longer needed).
- Claude to help me write these notes and talk through complicated parts of this disassembly.

## Repository layout

```
docs/          findings and format write-ups: MOVIE_QUALITY / MOVIE_SUCCESS / STUNT_SYSTEM / TRAITS_AND_EXPERIENCE (formulas),
               SAVE_FORMAT / SCRIPTS / CHARACTERS (saved games), MSH_FORMAT / ANM_FORMAT / FLM_FORMAT (assets),
               REIMPLEMENTATION, DECOMP_PIPELINE, WINDOWS_TEST_BOX, WINE_CROSSOVER, HANDOVER (state and next steps)
FINDINGS.md    older findings notes, kept as a reference (radio/news, genre trend, audio engine, .lug loader)
renames.csv    proposed function names with evidence; library_map.csv, fable_matches.csv
tools/         analysis and generator scripts (Python/PowerShell); tools/ghidra_names.csv = live Ghidra names;
               jad_dump.py, script_dump.py, script_quality.py, save_cast.py (saved games, scripts, terrain and placement renders),
               msh_dump.py, dds.py, anm_dump.py, cos_dump.py (models, textures, animations, costumes),
               export_person.py / export_character.py (characters for the viewer), lhts.py, list_rooms.py (text and rooms),
               pak_extract.py, fetch_assets.py (archives); attribute_classes.py, progress.py (decompilation status);
               tools/winbox/ = scripts for the Windows test box (build, launch, trace, drive the game);
               tools/wine/ = patch_laa.py, for running the game under CrossOver/Wine on the Mac (docs/WINE_CROSSOVER.md)
viewer/        three.js character viewer (index.html, vendor/; viewer/data is generated, see docs/ANM_FORMAT.md)
ghidra/        Ghidra scripts (the Ghidra project itself is local: *.gpr / *.rep, gitignored)
debugger/      TheMoviesDebugger: injected DLL + injector (CMake), used to verify findings at runtime
src/           the readable reimplementation (portable C++17): core/, game/movie, game/staff, game/studio, game/ai, apps/ (otm_movie_calc), tests/
data/          LOCAL ONLY, gitignored: ExportDecompiled/, game_data/ (extracted ini/csv), runtime/ (traces from the test box);
               data/identified_organized/ (per-class decompiler excerpts) is the one tracked exception; whether it stays tracked is an open decision in docs/HANDOVER.md
gen/, docs/generated/   LOCAL ONLY, gitignored: generated sources and reports
```

The game install (`The Movies/`) is kept outside the repo, next to it. **Start with `docs/HANDOVER.md`** (state, commands, next steps);
see `docs/REIMPLEMENTATION.md` for the module layout and workflow.
