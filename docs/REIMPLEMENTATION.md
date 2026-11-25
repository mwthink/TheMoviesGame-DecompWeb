# Reimplementation layout and workflow

State, commands and next steps for a new contributor: `docs/HANDOVER.md`.

Goal: a readable C++ reimplementation, organised by subsystem and class, not by original address or per function.

## Layout (under `src/` (new, in this repo), headers beside sources)

```
src/
  core/        MV:: / LH:: / PKStrings: strings, arrays, lists, memory, file IO, logging 
  engine/      renderer, SWF/LSWF, audio (vorbis), input, scene objects (MV::Object, FS::CObject)
  ui/          TM::W* windows, bubbles, HUD (WWindow, WInterface, WAdvMovieMaker...)
  game/
    studio/    CLot, TMRoom, TMFloorPlan, TMFixedAsset, builders
    ai/        AI studio decisions (when a studio releases a movie)
    studio/    the studio rating and decayed reputation
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
`tuning_loader` also checks against the real game files when `data/game_data` holds the extracted files (`tools/pak_extract.py`, below); without
them it runs only its inline checks and ctest reports it as skipped. Set `OTM_GAME_DATA` to another directory to use files from elsewhere.
Put `verified` on a function only when a measurement from the running game reproduces its result, and say in a comment what was measured.

Status (all under `game/movie/`, each with a test in `src/tests/`):
- `MovieQuality`: `CQualityRating_Compute`, `CProject_ComputeFinalQuality`, the crew / set / star-relationship / genre-experience mappings.
  `ComputeFinalQuality` is verified against two measured movies.
- `MovieSuccess`: `CProjectSuccess_Recompute`, public interest and marketing, cast star ratings, genre popularity, boredom, the movie star
  rating, `CProjectIncome` creation and payout, genre trend and the saturation decay value. The functions reproduced by logged game values
  (success, rating, income, AI and player public interest, marketing D, genre popularity and trend, boredom factor) are `verified`.
- `ActorPerformance`: the actor record (`QualityCalc_ActorPerformance`), mood and genre-fit factors, star chemistry, likeness and the stunt
  performance factors. Nothing there is verified (no measurement isolates it); it follows the decompiled code.

- `TuningLoader`: fills `QualityTuning`, `SuccessTuning`, `ActorTuning`, `AwardBonusTuning` and the audience-taste genre events from
  `releasing_movies.ini`, `global.ini`, `stunts.ini`, `awardsbonuses.ini` and `timeline.csv`. Missing keys keep the default and are listed
  in a `LoadReport`. Checked against the installed game's files: every default in the headers equals the shipped value
  (`max_from_ideal` is 0.5).

- `game/ai/AiStudio`: the AI studio's release decision (desire from the group's mean/RMS success difference, the 0.5-2 year ramp, the 0.5
  threshold). **Verified** against 211 logged decisions (`tools/check_ai_decide.py`, `tests/AiStudioTest.cpp`).
- `game/studio/StudioRating`: the studio rating (five weighted components with a clamp after each) and the decayed reputation.
  **Verified** against 27 logged studio rows (`tests/StudioRatingTest.cpp`); the money and star-power components are not yet.
- `game/staff/Traits`: the trait map with the diminishing-returns gain, the experience table, and the genre experience a take gives.
  `game/staff/Stunts`: the stunt roll (success chance, the game's random generator), injuries, stunt XP and stunt-school training.
  `game/staff/StarRating`: how a star's nine components combine, and how films feed the movies and performance components.
  `game/staff/StaffTuningLoader` fills their tuning from `experience.ini`, `stunts.ini`, `global.ini` and `awardsbonuses.ini`. These follow
  the decompiled code and the documented numbers (`docs/STUNT_SYSTEM.md`, `docs/MOVIE_SUCCESS.md` 3aa-3ac) but nothing is verified against
  the running game; the stunt roll, for example, has only been observed as "a failure sets `ai_stunt_fail`".
- `game/character/` (new): the character appearance code, from the StarMaker analysis (`docs/STARMAKER.md`): `core/Inflate` (zcmp / zlib),
  `AnmFile` (v12 animations), `MshFile` (render primitives with the 4-weight skin records, the skeleton), `HeadFile` (`.hd` morph files and
  `ApplyHdMorph`), `FaceRig` (the face skeleton posed from an animation and skinned onto the head: the 43 StarMaker face sliders, `a + 1.99 * v`,
  and the facial expressions, `fe_<head>.anm` frame x intensity), `StarFile` (`info.sm` read and write, byte for byte), `Appearance` (makeup layer
  file names, the layer draw order, hair colour suffixes, the age grey overlay, the iris atlas cell, the `.fan` reader). It produces plans and
  geometry, no pixels (decoding and compositing the DDS layers is not ported; `tools/render_star.py` does it in Python). Tested in
  `tests/CharacterTest.cpp`: the inline parts always run; the file parts need the extracted `sm_assets` and saved stars in `OTM_STAR_DIR`
  (`~/Documents/The Movies/StarMaker`). **Checked against saved stars made in the real editor:** the nine-slider "CrazySliders" star is reproduced
  vertex for vertex (457 of 457 vertices move, RMS error 0.05 mm on 4.2 mm of signal, maximum 0.23 mm), the all-default star from
  `head_m_white_joe.hd` to 1.2 mm, and `info.sm` is rebuilt byte for byte. Not `verified` in the game sense (no run of the game's own functions);
  the expression blend (linear towards the bind pose) is the port's choice, not read from the game.
- `game/camera/GameCamera` (new): the in-lot gameplay camera (the manager's *normal* state), from `Camera_Tick` and the functions it calls (`docs/CAMERA.md`): `camera.ini` settings, keyboard / edge / drag /
  wheel input, pan, zoom, rotation, eye placement, the near plane and the lot clamp. Pure state and arithmetic: the caller passes in the observed input and the lot rectangle. Tested in
  `tests/CameraTest.cpp`; **checked against the game's own numbers** in that the eye it derives from a save's `SL_CamFoc` / `SL_CamRot` / `SL_CamZoo` equals the saved `SL_CamPos` (eight saves),
  not `verified` as a whole (the input handling and the clamp have not been compared with a run of the game). The web app uses the TypeScript twin (`web/src/camera/`).
- `game/movie/MovieEstimate` and the command line tool `otm_movie_calc` chain quality, success and revenue from plain inputs and compare
  marketing levels. It reproduces the marketing table of `docs/MOVIE_SUCCESS.md` 3w exactly (with the symmetric imbalance reading, see there):

```
build/src/otm_movie_calc --quality 0.62 --hype 0.31 --tech --stars 0.7 --compare-marketing
build/src/otm_movie_calc --script 0.6 --stars 0.7,0.5 --hype 0.3 --marketing 3     # one movie, every intermediate value
```

`core/` holds new helpers for the reimplementation, not ports of the game's own `MV::` / `LH::` / `PKStrings` classes: `Strings`, `File`,
`Ini` (the game's .ini dialect: sections, `key = value`, `#` comments, keys before the first section, trailing `;`) and `Csv`.

Still to do for the quality/success chain: reading the inputs out of the game's classes (traits, cast list, boredom objects), the
genre-fit score inputs (an actor's difference from the genre's ideal), the stunt take score and the take-by-take records, and the
`[pr]` hype adders (`CProject_AddStarPressHype` / `AddMoviePRHype`).

## Extracting game data (macOS/Linux, no Windows tools)

`tools/pak_extract.py` lists and extracts files from the `.pak` archives (format notes in its docstring; versions 5 and 6, not the
older version-4 `premium_costumes` archive). Extracted files are game assets, so put them under `data/` (gitignored):

```
python3 tools/pak_extract.py extract "<game>/Data/pak" data/game_data releasing_movies.ini stunts.ini global.ini
```

The `Addon_2704_*` archives (the 2006 patch) override `MISC0000`, so the extractor takes the newest archive for each name.

