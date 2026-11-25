# The reimplementation: rules and modules

The game is being rebuilt as the web app in `web/` (`WEB.md` covers the app, its rendering and how to run it). This page holds the rules that keep
the rebuild faithful to the original, and the state of each simulation module. The goal and next steps are in `STATUS.md`.

## Rules

1. **Behaviour, not structure.** The original binary is the source of truth for what the game *does*. The code is organised by system, with real names,
   typed fields and plain control flow; it does not mirror the original's classes, addresses or calling conventions.
2. **Parity first, bugs included.** Where the original has a bug or an oddity that affects play, reproduce it and mark it with a `quirk:` comment that says
   what the original does and what a fix would be. Fixes come later and on purpose, behind a setting where they change play.
3. **Every ported function carries `orig: 0xVVVVVVVV`**, the address in `MoviesSE.exe`, so code, docs and Ghidra stay joined. Add `verified` (`orig:
   0x004A1230 verified`) only when a measurement from the running game reproduces its result, and say in a comment what was measured. Logged values from the
   game are kept as test fixtures.
4. **Formulas come from the decompiled code and the docs.** Where they disagree, the comment says so (examples: the genre-fit factor is not a relationship
   factor; the public-interest imbalance term is one-sided in the code but symmetric in the older notes).
5. **32-bit floats.** The original computes in `float` (with x87 intermediates). Use `Math.fround` where a value is stored as a `float`, so long runs do not
   drift from the original.
6. **Modules take plain numbers, not game objects.** A formula is a function of already-gathered inputs (cast performance, script quality, ...), so it can be
   tested on its own; reading those inputs out of the game state comes with the system that owns the data.
7. **Libraries are not ported.** zlib, Ogg Vorbis, the Perforce client and the Lionhead middleware are replaced by the platform or a small dependency
   (`LIBRARIES.md`). The online services are left out (`NETWORK.md`).
8. **No game files in the repository**, and none served by the app: it reads the player's own install. Test fixtures are numbers and small records, not
   extracted files. `tools/audit_firewall.py` checks before every commit.

## Modules

| Module | What it does | Checked |
|---|---|---|
| Movie quality | `CQualityRating_Compute`, `CProject_ComputeFinalQuality`, the crew, set, star-relationship and genre-experience mappings | final quality **verified** on two measured movies |
| Movie success | `CProjectSuccess_Recompute`, public interest and marketing, cast star ratings, genre popularity, boredom, the movie star rating, `CProjectIncome` creation and payout, genre trend and saturation | success, rating, income, AI and player public interest, marketing D, genre popularity and trend, boredom **verified** against logged values |
| Actor performance | the actor record (`QualityCalc_ActorPerformance`), mood and genre-fit factors, star chemistry, likeness, the stunt performance factors | follows the code; no measurement isolates it |
| Movie estimate | chains quality, success and revenue from plain inputs and compares marketing levels | reproduces the marketing table of `MOVIE_SUCCESS.md` 3w |
| Tuning loader | fills the quality, success, actor and award-bonus tuning and the genre events from `releasing_movies.ini`, `global.ini`, `stunts.ini`, `awardsbonuses.ini`, `timeline.csv`; missing keys keep the default and are reported | every default equals the shipped value |
| AI studio | the release decision (desire from mean/RMS success difference, the 0.5 to 2 year ramp, the 0.5 threshold) | **verified** against 211 logged decisions |
| Studio rating | five weighted components with a clamp after each, and the decayed reputation | **verified** against 27 logged rows (money and star-power components not yet) |
| Staff | traits (diminishing-returns gain), the experience table, genre experience per take; the stunt roll (the game's random generator), injuries, stunt XP and training; how a star's nine rating components combine; their tuning from `experience.ini`, `stunts.ini`, `global.ini`, `awardsbonuses.ini` | follows the code (`STUNT_SYSTEM.md`, `STARS.md` 3aa-3ac) |
| Boot | the command line (`-safemode`, `-reenter`, `-editor`, `-download`) and the intro splash sequence | the intro order, against one Wine run |
| Front end | the main menu's state machine, event handler and tables; the nine start options; the starting-layout file parser | follows the code (`FRONTEND.md`, `NEW_GAME.md`) |
| Camera | the in-lot gameplay camera: `camera.ini`, input, pan, zoom, rotation, eye placement, near plane, the lot clamp | the eye it derives from a save's camera equals the saved eye, in eight saves |
| Character | the StarMaker appearance code: `.anm`, skinned `.msh`, `.hd` morphs, the face rig (43 sliders, expressions), `info.sm` read and write, makeup / hair / iris rules. Plans and geometry, no pixels yet | against stars saved in the real editor: a nine-slider star vertex for vertex (RMS 0.05 mm), `info.sm` byte for byte |

Where each module lives and how to test it: see "Code" below.

Still to do for the quality and success chain: reading the inputs out of the game state (traits, cast, boredom objects), the genre-fit inputs (an actor's
distance from the genre's ideal), the stunt take score and the take records, and the `[pr]` hype adders (`CProject_AddStarPressHype`, `AddMoviePRHype`).

## Code

The modules are in `src/` (portable C++17, `cmake -S src -B build/src && cmake --build build/src && ctest --test-dir build/src --output-on-failure`), being
ported to TypeScript under `web/src/sim/` (`STATUS.md`, next steps).

## Progress

`tools/progress.py` counts functions per class as unnamed, named, reimplemented (an `orig:` tag exists) or verified, and writes `docs/generated/progress.md`.
