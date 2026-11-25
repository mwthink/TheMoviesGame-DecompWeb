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
  (`AnimId_LoadClip`, `00447AA0`, table at `DAT_00F87FC0`) is filled from `data\gait.ini` by `AnimIdTable_InitFromGaitIni` (`MOVEMENT.md`). `TMCharacter_LoadIdleAnimation` (`00599DD0`) loads a named idle clip
  (name at `+0x61C`) and records its length in frames (every third frame when the clip's flag bit 1 is set, as for `Anm`).

## Animation

The save does not store what a person is doing. [data] Each person inside a room has `InRoomName` and `InRoomIdx`, and the game's **room scenes**
`data\scene\interactions\ai_<room>_<NN>.flm` (a few rooms: `ai_<room>.flm`) script them (`FLM_FORMAT.md`; the game plays a scene through `TMCharacter_PlayInteractionScene`,
`0x599480`). The web app takes the scene a person stands in and plays **the first pose-holding animation box reachable from the scene's first character**
(`Flm.ts` `firstAnimation`, [guess] for the graph walk: the link words of choice and settings boxes are not decoded, so every word equal to another object's id
counts as a link; walking, turning and the hiring celebration `hired_*` are skipped):

- A box that names a `.seq` plays a **playlist** (`Seq.ts`, `staff_idle.seq`: 7 fidget clips with weights 1, 1, 1, 1, 0.57, 0.09, 0.07, plus the base idle `idle_male.anm`).
  [guess] The player keeps the base idle for one to three loops between fidgets and picks the fidget by weight (the repeat is not read from anything).
- A box that names a `.anm` loops that clip.
- Variant: the person's `InRoomIdx` picks `_NN`, wrapped to the variants that exist; an unset index (saved as `0xFFFFFFFF`) uses the person's id. A room with no scene file
  uses the room name with its last word dropped (`room_staff_hire_janitor` -> `room_staff_hire`).
- **Fallback:** a person outside a room (the lot's wanderers and the unplaced), or in a room with no scene (`room_set`, `room_so_office`, `room_trailer_assign` in the
  Quick Start save), plays `idle_male.anm`. The dev menu's "People" section counts room-scene and fallback people; each person's `plan.source` says which file.
- Each person starts at a random point of their first clip so a room does not move in step.
- Time: people advance by game time (the speed buttons scale it, pause freezes them). [guess] The flags use real time (`AUTO_ANIMATION.md`); where the original steps
  character animation was not read.
- Cost: bodies, heads and hair are skinned on the CPU every frame (`skinVertices`, no allocation in the loop).

Not done: the room scenes' own movement (their walk boxes and path nodes; the AI interaction scenes at props are played, `DESIRES.md`), the game's blending between clips (a `.seq` has a blend time; the web app cross-fades every change of clip over a fixed 0.25 s, `MOVEMENT.md`), facial expressions, which stage of a long scene a
person is at (`TheActivity` is not saved).

## What is drawn

Body, head and hair. Before the animation starts (and in tests) they are in the first frame of `idle_male_half1.anm` (arms hang by the sides); in the app they play their plan (above).

- **Costume:** `PCurrentCostume` -> a `CCostume` object with no tagged fields; the strings in its blob give the `.cos` file and the hair mesh (`readCostume`). The `.cos`
  (`Cos.ts`) names the body mesh; the body's own texture atlas is used, the costume's extra texture layers and attached meshes (hats, glasses) are not drawn yet.
- **Head:** `Head[0]` (stars and wannabes) or the default for the costume's sex (`head_f_white_jane.hd` for `f_*` costumes, else `head_m_white_joe.hd`; crew have no
  saved head). The `.hd` morphs `generic_head.msh`'s 996 vertices by weight (`WEIGHT` kg, 70 when absent) and age (`Birth` against the save's date), with
  `Head[1]` / `HeadMix` blended in (`morphedHead`). The eyeball primitive is protected from the morph as in `tools/export_person.py` (a deviation from the data).
- **Hair:** the costume blob's hair mesh, drawn with an alpha cut-off. No hair colour tint, no makeup, no skin tint (`STARMAKER.md` sections 9 and 10).
- **Lighting:** unlit (the texture is the colour); the game lights people with the lightmap of where they stand.
- Hovering a person shows their name in the tooltip bubble (`TOOLTIPS.md`).

## Next

Movement: the room scenes' `MoveToBox` walks and path nodes (the interaction scenes at props play theirs, `web/src/sim/scene/`), the pathfinder, the animation id table (`AnimId_LoadClip`), the game's own blend, and the game loop's per-tick character update
(`TMMobile_*`, `TMCharacter_*`).

Movement (walking, gaits, routes) is in `MOVEMENT.md`.
