# People in the world

How a saved person gets into the scene, and what the web app draws. Code: `web/src/formats/Jad.ts` (`SavedPerson`), `web/src/formats/Cos.ts`,
`web/src/sim/character/PersonModel.ts`, `web/src/world/WorldData.ts` (`loadPeople`), `web/src/world/WorldScene.ts` (`buildPeople`); tests `web/tests/sim/people.test.ts`.
Evidence labels as in `CLAUDE.md`.

## Placement [read] [data]

- **A person's `POSITION` and `MyAngle` are world coordinates**, the same space as placed buildings, also when they stand inside a building (`PInBuilding` is a
  link for the AI, not a frame of reference). Checked on a Quick Start save: a janitor in `room_staff_hire_janitor` at (-87.1, 33.0), a pre-production crew
  member whose `PInBuilding` building stands at (-51.5, 39.2) has (-38.7, 46.4). `LastPosition` equals `POSITION` in saves.
- **`z` is the floor height they stand on.** `TMCharacter_PlaceAt` (`00599C40`, the entry point for putting a person somewhere) takes a position and an angle;
  **when z is 0 it asks the world for the ground height** (`World_GetGroundHeight`, `00455410`, [inferred]), then stores the pair as the person's rest transform
  (`TMMobile_SetRestTransform`, `TMInWorld_SetPositionAndAngle` `00538840`) and sets the character's state field `+0x45c` to 2. Saved z is 0 for nearly everyone
  (one person at 0.35 in the sample, on a raised floor). The web terrain is flat, so z is used as saved.
- **Angle** is radians about the vertical, counter-clockwise from above, like buildings (`rotation.y = -angle` in the mirrored scene).
- **People at (0, 0) with no costume are not in the world** (the casting pool: wannabes not yet shown). Of 83 `CStaff`/`CStar`/`CWannabe` objects in a Quick Start
  save 44 are placed.
- **Idle:** `TMCharacter_ResetToIdlePose` (`0059A230`) plays animation id `0x29` (`TMCharacter_PlayAnimationById`, `00598F30`); the id -> name table
  (`AnimId_GetName`, `00447AA0`, table at `DAT_00F87FC0`) is built at run time and not read yet. `TMCharacter_LoadIdleAnimation` (`00599DD0`) loads a named idle clip
  (name at `+0x61C`) and records its length in frames (every third frame when the clip's flag bit 1 is set, as for `Anm`).

## What is drawn

Body, head and hair, in the skeleton's pose at the first frame of a stand-in clip (`idle_male_half1.anm`: arms hang by the sides). [guess] The stand-in is not what
the game shows: the real idle clip is id 0x29 and each person's current activity (the animation phase will replace this).

- **Costume:** `PCurrentCostume` -> a `CCostume` object with no tagged fields; the strings in its blob give the `.cos` file and the hair mesh (`readCostume`). The `.cos`
  (`Cos.ts`) names the body mesh; the body's own texture atlas is used, the costume's extra texture layers and attached meshes (hats, glasses) are not drawn yet.
- **Head:** `Head[0]` (stars and wannabes) or the default for the costume's sex (`head_f_white_jane.hd` for `f_*` costumes, else `head_m_white_joe.hd`; crew have no
  saved head). The `.hd` morphs `generic_head.msh`'s 996 vertices by weight (`WEIGHT` kg, 70 when absent) and age (`Birth` against the save's date), with
  `Head[1]` / `HeadMix` blended in (`morphedHead`). The eyeball primitive is protected from the morph as in `tools/export_person.py` (a deviation from the data).
- **Hair:** the costume blob's hair mesh, drawn with an alpha cut-off. No hair colour tint, no makeup, no skin tint (`STARMAKER.md` sections 9 and 10).
- **Lighting:** unlit (the texture is the colour); the game lights people with the lightmap of where they stand.
- Hovering a person shows their name in the tooltip bubble (`TOOLTIPS.md`).

## Next

The game loop, pathfinding and animation: find which activity each saved person is in (`InRoomName`, `TheActivity`), the animation id table, and how a character moves
(`TMMobile_*`, `TMCharacter_*`); then replace the stand-in pose.
