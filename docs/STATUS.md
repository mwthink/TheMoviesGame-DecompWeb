# Status

Where the project stands and what comes next. This page describes the current state only; history is in git. Each system's own document has
the details and its open questions.

## The goal

**A playable, modern version of *The Movies* that runs in the browser and loads saves from the original game.**

- The original `MoviesSE.exe` (patch 1.2, SHA-256 `48f909d7f89051ff0d3277f7dc0aa7c65cd1c92015542fcbc3d5f86700b1566a`) is the **source of truth for
  behaviour, not for structure**. The reimplementation matches what the game does, not how its code is laid out.
- **Parity first, bugs included.** Known bugs of the original are reproduced and marked (`quirk:`, `REIMPLEMENTATION.md`), so they can be fixed later,
  deliberately. Improving on the original comes after parity.
- **Saves:** read the original's `.jad` files. Writing comes later; creating a new game needs a blank save of the same shape, so the save model keeps
  everything it reads, understood or not.
- **Platform:** the web app in `web/` (TypeScript, Babylon.js). The simulation is TypeScript too (`web/src/sim/`) and runs headless.
- **StarMaker** (the original's separate character editor) becomes part of the game, reached from the main menu.
- Left out: the dead online services (`NETWORK.md`). No game files are ever in the repository or served: the app reads the player's own install.

## Where the original game runs

| | Use |
|---|---|
| CrossOver on the Mac (`WINE_CROSSOVER.md`) | playing, making saves, the debugger DLL's hooks and first-call tracer |
| The Windows test box (`WINDOWS_TEST_BOX.md`) | everything above, plus the `this`-class tracer; the reference if a Wine measurement disagrees |

`ANALYSIS_TOOLS.md` describes the debugger, the tracer and the static tools.

## Reverse engineering

| | State |
|---|---|
| Functions | 60,838 in Ghidra; about 30,700 still `FUN_*`. Names and their evidence: `tools/ghidra_names.csv`, `renames.csv`. The 29 camera names (`CAMERA.md`) are in the CSVs but not yet applied to the live project |
| Libraries | zlib (two copies), libogg, libvorbis, the Perforce client and the Lionhead middleware shared with Fable located and largely named (`LIBRARIES.md`, `NETWORK.md`): not to be ported |
| Classes | 2,066 RTTI classes with vtables and sizes; about 10,000 functions attributed to a class with measured precision (`ANALYSIS_TOOLS.md`) |
| Runtime coverage | 9,458 functions seen over two game years of a Quick Start; a steady-state set of about 3,800 for managing a studio. **Making a movie has not been traced** |

## Systems

"Decoded" = documented from the code and data; "ported" = in `web/src/` with tests; "verified" = reproduces values logged from the running game.

| System | Docs | Decoded | Ported | Verified |
|---|---|---|---|---|
| Movie quality | `MOVIE_QUALITY.md` | yes | yes | the final quality, on two measured movies |
| Movie success, box office, marketing | `MOVIE_SUCCESS.md` | yes | yes | success, rating, income, public interest, marketing D, genre popularity and trend, boredom |
| AI studios | `MOVIE_SUCCESS.md` 5, 3m | release decision, AI movie quality and income | release decision | the decision (211 logged) |
| Studio rating | `STUDIO.md` 3aw | yes | yes | 27 logged rows (money and star-power components not yet) |
| Stars: rating, mood, grudges | `STARS.md` | mostly | the rating combination | no |
| Staff: traits, experience, stunts | `TRAITS_AND_EXPERIENCE.md`, `STUNT_SYSTEM.md` | yes | yes | no |
| Awards | `AWARDS.md` | ceremonies, score sources, bonus table | tuning only | partly (logged ceremonies) |
| Scripts | `SCRIPTS.md` | storage in a save, script quality | no (Python: `tools/script_quality.py`) | no |
| Scenes (`.flm`) | `FLM_FORMAT.md` | the format | no | no |
| Boot, intro, main loop | `BOOT.md`, `MAIN_LOOP.md` | yes | the intro sequence and command line | the intro order (one Wine run) |
| Main menu, new game | `FRONTEND.md`, `NEW_GAME.md` | the menu state machine, the start options, the starting layout | yes (logic, not the screens) | no |
| Game clock, toolbar, auto-animated props (flags) | `AUTO_ANIMATION.md`, `MAIN_LOOP.md` | the fixed timestep and the date step; the flag driver and clip timing | yes (clock, pause / play / fast; flags wave; the day pace and the flag pose are guesses) | no |
| Tooltips | `TOOLTIPS.md` | the single tooltip window, its delay and sizing | yes (bubble at the bottom right, hover stillness exact) | no |
| People in the world | `PEOPLE.md`, `CHARACTERS.md` | placement (world POSITION and MyAngle, z = floor height), the idle call | yes (saved people stand at their saved places and play their room scene's idle or a fallback idle; no movement yet) | by eye only |
| Options | `OPTIONS.md`, `FRONTEND.md` | the original's video, audio, game and online option screens (strings and registry keys) | yes (graphics: render size, sharpness, FXAA, FPS counter, full screen; game: level of help) | no |
| Character viewer | `CHARACTER_VIEWER.md`, `CHARACTERS.md`, `ANM_FORMAT.md` | costume, head, hair, skeleton, clips | yes (viewer screen in the app; face sliders / editing not yet) | by eye only |
| Loading screens | `LOADING_SCREENS.md` | one random picture of 17 per load with a baked-in text box; a random `FRONTEND_SPLASHSCREEN_<n>` tip in it | yes (picture + tip box + our progress bar; gallery in dev) | by eye only |
| Camera | `CAMERA.md` | the normal (in-lot) state | yes, in the web app | eye placement against eight saves |
| Saved games | `SAVE_FORMAT.md`, `CHARACTERS.md` | container, terrain, placement, many classes | the web app reads placement, landscape and camera | against the Python tools |
| Models, textures, animation | `MSH_FORMAT.md`, `ANM_FORMAT.md`, `PAK_FORMAT.md` | static models, DDS, `.anm`, skinning | the web app draws static models | by eye against the game |
| StarMaker / character looks | `STARMAKER.md` | the star file, sliders, expressions, makeup, hair, iris | geometry and plans (no texture compositing yet) | against stars saved in the editor |
| Audio | `AUDIO.md` | the `.lug` bank layout, the radio's clip queues | no | no |
| Networking | `NETWORK.md` | mapped, to be left out | — | — |

## Next steps

1. **Trace making a movie.** Play or script hiring, a script, casting, a shoot, post-production and a release under Wine or on the box, with an F9 marker per step,
   then per-phase function lists (`tools/steady_state.py`). Also stunts, build mode, research and an awards ceremony. This is the largest gap in the runtime picture.
2. **A differential harness.** Have the debugger log a function's inputs and result, turn the logs into test fixtures, and replay them against the port. That turns
   "reimplemented" into "verified" routinely instead of by a hand-built check each time. Start with what the logs already hold: `decade_log.csv` has
   STAR_RATING, STUDIO_RATING, PAYOUT, AI_DECIDE, RESEARCH, SALARY and STAR_CHART lines that are not yet checked.
3. **Wine against the box, once.** One identical run on both (Quick Start, F9 per step, the same game time) to confirm Wine measurements can be trusted for `verified`.
4. **The save model.** Grow the web app's `.jad` reader into the game state: every object and variable kept, decoded or not, so a save can later be written back and
   a blank save created for a new game. Open details are at the end of `SAVE_FORMAT.md`.
5. **A headless month.** Load a save, run the simulation at the original's 10 Hz tick (`MAIN_LOOP.md`) for a game month, and compare with a logged run.
6. **The movie cost accrual** (`CProjectCosts_AccrueUpdate` and helpers, named): port it and check it against `PREPROD_COST` lines; that also settles whether
   pre-production wages are real cash out (`MOVIE_QUALITY.md`).
7. **StarMaker in the game:** DDS face-layer compositing in TypeScript, then the editor screen from the main menu; the open details are at the end of `STARMAKER.md`
   section 10.
8. **The web app** (`WEB.md`, "Next steps"): compare the view with the original from the same camera, the rest of the lot, the other camera states, the menus.
9. **Names:** regenerate the decompiler export after the latest names, rerun `attribute_classes.py`, and name the documented functions still left unnamed
    (`009fa970`, `009fe620`, `00a31bb0`, `00a44dd0`, `009db5f0`, `0051be40`, `00ab0150`, `00610190`).

## Before the repository is made public

- Start from a fresh copy without this history: early commits (before this fork) tracked bulk decompiler output, `data/identified_organized/`, which must not be
  published. It is still tracked here; it is removed in the fresh copy.
- Choose a licence for the reimplementation.
