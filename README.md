# The Movies (2005) — Reverse Engineering Notes

Fan reverse-engineering notes for **The Movies** and **The Movies: Stunts & Effects** (Lionhead Studios, published by Activision, 2005–2006).

This is an ongoing effort to understand how the game's simulation actually works under the hood — mechanics like genre popularity, the radio/news system, save-file structure, and various asset formats (`.msh`, `.lug`, `.pak`) — done by statically analyzing the shipped `MoviesSE.exe` in Ghidra and cross-checking the results against the real game data files.

Write-up is being redone from scratch — check back soon.

## What this is

- Original analysis: function/class identification, algorithm and data-structure documentation, decompiled-code excerpts (a handful of lines at a time, for illustration), and short quoted strings used as evidence (debug asserts, embedded source paths, error messages).
- A description of how various game systems and file formats work, including the saved-game format (`docs/SAVE_FORMAT.md`) and the `.msh` model format (`docs/MSH_FORMAT.md`).

## What this is *not*

- No copies of the game binary, Ghidra project/database, or any extracted game assets (audio, textures, meshes, full data files) are included in this repo.
- Not affiliated with, endorsed by, or sponsored by Lionhead Studios, Activision, or their successors. All trademarks and copyrighted game content belong to their respective owners; this repo only contains original analysis and commentary about that content.

## Tools used

- [Ghidra](https://ghidra-sre.org/) for static analysis/decompilation of the executable.
- `reshoot.exe`, archive-extraction tool for pulling real data files (`.csv`/`.ini`/`.lhts`) out of the game's `.pak` archives to verify inferences made from the disassembly.
- Claude to help me write these notes and talk through complicated parts of this disassembly.

## Repository layout

```
docs/          findings and format write-ups (MOVIE_*.md, STUNT_SYSTEM.md, FLM_FORMAT.md, SAVE_FORMAT.md, MSH_FORMAT.md, REIMPLEMENTATION.md, DECOMP_PIPELINE.md)
FINDINGS.md    older findings notes (being rewritten)
renames.csv    proposed function names, library_map.csv, fable_matches.csv
tools/         analysis and generator scripts (Python/PowerShell); tools/ghidra_names.csv = live Ghidra names;
               jad_dump.py (saved games, terrain and placement renders), msh_dump.py / dds.py (models and textures), pak_extract.py (archives);
               tools/winbox/ = scripts for the Windows test box (build, launch, trace, drive the game);
               tools/wine/ = patch_laa.py, for running the game under CrossOver/Wine on the Mac (docs/WINE_CROSSOVER.md)
ghidra/        Ghidra scripts (the Ghidra project itself is local: *.gpr / *.rep, gitignored)
debugger/      TheMoviesDebugger: injected DLL + injector (CMake), used to verify findings at runtime
src/           the readable reimplementation (portable C++17): core/, game/movie, game/staff, apps/ (otm_movie_calc), tests/
data/          LOCAL ONLY, gitignored: ExportDecompiled/, game_data/ (extracted ini/csv), runtime/ (traces from the test box)
gen/, docs/generated/   LOCAL ONLY, gitignored: generated sources and reports
```

The game install (`The Movies/`) is kept outside the repo, next to it. **Start with `docs/HANDOVER.md`** (state, commands, next steps);
see `docs/REIMPLEMENTATION.md` for the module layout and workflow.
