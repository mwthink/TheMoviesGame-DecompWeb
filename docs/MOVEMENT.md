# Movement

How people move about the lot: what the original does (as far as read) and what the web app does (`web/src/sim/anim/Gaits.ts`, `Walker.ts`, `web/src/sim/nav/NavGrid.ts`,
`web/src/sim/ai/Wander.ts`, wired up in `web/src/world/WorldScene.ts` `buildPeople`; tests `web/tests/sim/movement.test.ts`). Evidence labels as in `CLAUDE.md`. Timing (speeds, turn rate)
is a first pass to be tuned by eye.

## The original

**Animation ids and `gait.ini`** [read][data]. The game names 48 animations by id (`A_MALE_WALK`, `A_FEMALE_STROLL`, `A_TURN_POS_10`, ...; the id-to-key list is the table at `DAT_00F87FC0`, filled by `AnimIdTable_InitFromGaitIni`; `AnimId_LoadClip`, `00447AA0`, loads an id's clip, and clips are reference counted: `Anim_AddRef` `00984680`, `Anim_Release` `00985DE0`).
`AnimIdTable_InitFromGaitIni` (`00446880`) reads `data\gait.ini`, which maps each key to a clip file (`A_MALE_WALK = walk.anm`), loads the clip and stores two things per id: the clip and
`DAT_00F87EF8[id] = stride * 0.1`, the clip's move speed in units per 0.1 s tick. `stride` is the first float of the `.anm` set header (`ANM_FORMAT.md`): the distance the clip moves
a character in one pass. `walk.anm` has stride 1.674 and lasts 1.0 s (31 frames, flag bit 1), so a walking man covers 1.67 units per second; `run_jog.anm` 2.53 in 0.8 s = 3.16 units/s;
`walk_female_middle.anm` 1.62; `walk_male_old.anm` 0.90 [measured from the files].

**Gaits** [read]. A character has three gait ids. `TMCharacter_SetDefaultGaits` (`00598C30`): a man strolls with id 9, walks with 0 and runs with 10; a woman strolls with 20, walks with 11
(12 when the flag at `+0x660` is set) and runs with 21. The locomotion state (`+0x4E8`) follows an urgency from 0 to 1 (`TMCharacter_UpdateMoveSpeed`, `+0x52C`):
`TMCharacter_UpdateLocomotionStateFromSpeed` (`00599630`) maps under 0.3 to 0 (stroll), under 0.7 to 1 (walk), else 2 (run).

**Choosing the clip** [read]. `TMCharacter_GetMoveSpeedForState` (`005996A0`) is the speed of the current state: `DAT_00F87EF8[gait id]` times a speed factor at `+0x4A8` (0 when standing, state 5). The gait slots are `+0x6E8` stroll, `+0x6EC` walk, `+0x6F0` run.
`TMCharacter_ChooseLocomotionAnimation` (`00599E70`) compares the character's current speed with that state speed and picks the slot: in the stroll state up to 1.125 times the speed plays the stroll clip, under 1.5 times
the walk clip, else the run clip; in the walk state up to 0.25 times the stroll clip, under 1.125 times the walk clip, else the run clip; in the run state up to 0.25 times the stroll clip, under 0.5 times the walk clip,
else the run clip. State 3 is turning on the spot; no speed (under 0.01) or states 4 and 5 play the idle clip. `TMCharacter_PlayAnimationById` (`00598F30`) stores the id (`+0x6F4`) and the time it started (`+0x6F8`) and sets the
clip through `TMMobile_SetCurrentAnim` (`00526890`).
Stars override the walk clip with their mood (`CStar_ChooseWalkAnimationByMood`, `0058F440`): drunk walks (ids 42 and 43 by sex, 44 very drunk) above the drunk thresholds, otherwise by a walk style: an ego walk (low, mid or high
ego pairs, ids 27 to 32), `CStar_PlayBoredWalk` (22, 23), `CStar_PlaySadWalk` (24, 25), `CStar_PlayHappyWalk` (26). Each also adds 0.01 to a small meter at `+0x18 + 4 * index` of a mood object, which looks like a usage
counter that caps at 1 [inferred]. The web app plays only the three gait clips.

**Turning** [read]. `TMCharacter_PlayTurnAnimation` (`00447AE0`) picks a turn-on-the-spot clip from the heading difference: under 5 degrees none, 5 to 12 the 10-degree clip, 12 to 36 the 22-degree
clip, above that the 45-degree clip; positive differences use ids 35 to 37, negative 38 to 40. The idle clip is id 41.

**Grid** [read]. Occupancy is a 256 x 256 grid of 2-unit cells, cell = round((world + 256) / 2) (the rounding is in `0x0046BFD0`). The game's own route finder was not located.

## The web app

- **Gaits** (`Gaits.ts`): the three clips of a person come from `defaultGaits` (by the costume's sex) and `gait.ini` (a built-in list of clip names when the archives lack it). The speed of a gait is
  `anmSpeed` = stride over clip length, so feet do not slide. Three female clips (`walk_female.anm`, `walk_female_2.anm`, `walk_fem_bored.anm`) hold no frames in the layout the reader knows;
  such a gait uses its nearest working neighbour's clip and speed.
- **Grid** (`NavGrid.ts`): the lot's rectangle is walkable except under each placed model's footprint (`b15_02`, turned and moved as placed). Cells are 2 units, as the game's. Routes are
  A* over the cells with line-of-sight smoothing (a stand-in for the game's finder).
- **Walker** (`Walker.ts`): turns toward the next waypoint at 4.5 rad/s [guess], walks only when within 50 degrees of it, moves at the gait's speed. No turn clips are played yet.
- **Animation**: while a person walks, `PersonAnimator.setOverride` plays the gait clip; when they stop it returns to their room scene's idle.
- **Wander** (`Wander.ts`): a [guess] stand-in for the game's desire-driven AI: people who are outdoors (no room scene, standing on open ground) wait 2 to 8 s, then stroll to a point 6 to 30 units
  away. Off by default; the dev menu's Movement section turns it on.
- **Orders**: click a person, then right-click the ground; the dev menu picks the gait. A person who is picked up stops, and stands where they are put down.

## Not done

Turn clips, the real route finder and the game's collision rules, walking through doors and between rooms, people avoiding each other, speed changes with urgency, the idle clip (id 41) between trips.
