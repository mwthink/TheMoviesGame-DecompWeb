# Open The Movies

A fan reimplementation of **The Movies** and **The Movies: Stunts & Effects** (Lionhead Studios, published by Activision, 2005–2006): a version of the
game that runs in a modern browser and loads saves from the original.

The original is a 32-bit Windows XP-era program on Direct3D 9, tied to old proprietary components and to online services that no longer exist; it is
hard to run on a current machine. This project reads how the original works (static analysis of `MoviesSE.exe` in Ghidra, checked against the game's
data files and against the running game) and rebuilds it. The original is the source of truth for **behaviour**, not for structure: match what it does
first, bugs included, then improve on it.

**Start with [`docs/STATUS.md`](docs/STATUS.md)** (the goal, the state of each system, next steps), then [`docs/SETUP.md`](docs/SETUP.md).

## Documents

| | |
|---|---|
| Project | [`STATUS.md`](docs/STATUS.md), [`SETUP.md`](docs/SETUP.md), [`REIMPLEMENTATION.md`](docs/REIMPLEMENTATION.md) (rules and modules), [`WEB.md`](docs/WEB.md) (the app) |
| Running the original | [`WINE_CROSSOVER.md`](docs/WINE_CROSSOVER.md) (CrossOver on a Mac), [`WINDOWS_TEST_BOX.md`](docs/WINDOWS_TEST_BOX.md), [`ANALYSIS_TOOLS.md`](docs/ANALYSIS_TOOLS.md) (debugger, tracing, class attribution, naming) |
| Program flow | [`BOOT.md`](docs/BOOT.md), [`MAIN_LOOP.md`](docs/MAIN_LOOP.md), [`FRONTEND.md`](docs/FRONTEND.md), [`NEW_GAME.md`](docs/NEW_GAME.md), [`CAMERA.md`](docs/CAMERA.md) |
| Simulation | [`MOVIE_QUALITY.md`](docs/MOVIE_QUALITY.md), [`MOVIE_SUCCESS.md`](docs/MOVIE_SUCCESS.md), [`STARS.md`](docs/STARS.md), [`AWARDS.md`](docs/AWARDS.md), [`STUDIO.md`](docs/STUDIO.md), [`STUNT_SYSTEM.md`](docs/STUNT_SYSTEM.md), [`TRAITS_AND_EXPERIENCE.md`](docs/TRAITS_AND_EXPERIENCE.md), [`SCRIPTS.md`](docs/SCRIPTS.md) |
| Files and formats | [`SAVE_FORMAT.md`](docs/SAVE_FORMAT.md), [`CHARACTERS.md`](docs/CHARACTERS.md), [`PAK_FORMAT.md`](docs/PAK_FORMAT.md), [`MSH_FORMAT.md`](docs/MSH_FORMAT.md), [`ANM_FORMAT.md`](docs/ANM_FORMAT.md), [`FLM_FORMAT.md`](docs/FLM_FORMAT.md), [`AUDIO.md`](docs/AUDIO.md) |
| StarMaker | [`STARMAKER.md`](docs/STARMAKER.md) (the character editor, to become part of the game) |
| Inside the binary | [`LIBRARIES.md`](docs/LIBRARIES.md), [`NETWORK.md`](docs/NETWORK.md), [`CLASS_NOTES.md`](docs/CLASS_NOTES.md) |

## Repository layout

```
web/        the game: TypeScript, Babylon.js, Vite (docs/WEB.md)
src/        the simulation modules in C++17, being ported into web/ (docs/REIMPLEMENTATION.md)
docs/       the documents above; docs/generated/ is local only
tools/      Python analysis and extraction tools (docs/SETUP.md lists them by task); tools/winbox/ drives the Windows test box; tools/wine/ patches the exe for CrossOver
ghidra/     Ghidra scripts: apply names, export, fingerprints, targeted decompiles (the Ghidra projects themselves are local)
debugger/   TheMoviesDebugger: an injected DLL and injector (MSVC x86) that hooks, logs and traces the running original
viewer/     a three.js character viewer (viewer/data is generated, local only)
renames.csv, tools/ghidra_names.csv     function names and their evidence: the record of the naming work
library_map.csv, fable_matches.csv, net_map.csv, p4api_map.csv     library and networking maps (docs/LIBRARIES.md, docs/NETWORK.md)
data/       local only: the decompiler export, extracted game files, runtime logs (docs/SETUP.md)
local.env   local only: this machine's paths (copy local.env.example)
```

## What this is not

- No copies of the game, its binaries, the Ghidra databases or any extracted game assets (audio, textures, meshes, data files). To play or develop you need
  your own copy of the game; the app reads it in your browser, on your machine.
- Not affiliated with, endorsed by or sponsored by Lionhead Studios, Activision or their successors. All trademarks and game content belong to their owners.

Built with [Ghidra](https://ghidra-sre.org/), [Babylon.js](https://www.babylonjs.com/), and Claude as a collaborator on the analysis, the notes and the code.
