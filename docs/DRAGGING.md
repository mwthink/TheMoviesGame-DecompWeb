# Picking people up and putting them down

How the original lets the player carry a character with the mouse, and what the web app does (`web/src/sim/ui/PersonDrag.ts` for the rules, `web/src/world/PersonDragger.ts` for the
scene, hooked up in `GameView`; tests `web/tests/sim/personDrag.test.ts`). Evidence labels as in `CLAUDE.md`. The class notes are in `CLASS_NOTES.md` ("TMMobile").

## The original [read]

A person is a `TMCharacter`, a `TMMobile` ("a character or object the player can pick up and drop"). Globals: `DAT_0104C6C8` is the object **in the hand**, `DAT_0104D524` the person the
player is carrying, `DAT_00F885F4` the object under the cursor; the mouse position is `DAT_0104CCE0/E4`.

| Step | Function | What it does |
|---|---|---|
| Press | `Input_OnMouseButton` (`00554400`) | a left press (button code `0x73`) stores the mouse position (`DAT_0104CD00/04`) and the time (`DAT_0104CCB4`); a release stores the release position |
| Click or hold | `TMInWorld_UpdateInputState` (`00539BE0`), `TMInWorld_UpdateClick` (`00539AF0`) | the button's release (`Input_WasKeyReleased`, `00553FD0`) is a **click** when it comes within **250 ms** of the press (`0xFA`; `UpdateClick` allows 350 ms, `0x15E`), calling the object's click handler; held longer it is a hold, which is what picks things up. The code that turns a hold into a pick-up call was not found; the hold flag is `+0x7B` / `+0x11B` |
| Pick up | `TMCharacter_BeginPlayerPickup` (`0059A980`) -> `TMMobile_BeginDrag` (`0053BD70`) | refuses if the object cannot be dragged, is already being dragged (state `+0x158` = 1 or 2) or if something is in the hand; stores the **rest position** (`+0x90..+0x98`); takes the person out of their room (`TMRoom_RemoveOccupant`, releases their slot); plays the pick-up sound (`PICKUP_INITIAL_MALE_<voice>` / `FEMALE_`) and the effect `PICK_UP_PLAYER_EFFECT`; starts a "held" animation from a name stored in the character (`+0x55C` / `+0x59C`; the clip was not identified) |
| Carry | `TMMobile_UpdateDragTargetFromCursor` (`0053ABE0`), `TMCharacter_SnapToDragTarget` (`00599A40`) | each tick the mouse ray is intersected with the ground plane (z = 0); a ray that does not point down, or hits farther than a limit (`100 * (...) + 30`), is clamped along the ray; the person's position is set to that point (height 2.5 on the ray, 0 as the person's own) and snapped to it, not smoothed |
| Hover | `TMMobile_UpdateHoverBob` (`0053A9E0`) | while held: height `+ 0.25 + 0.25 sin(ms * 0.0025)` and a sway of `0.3 sin(ms * 0.0016)` radians on the facing |
| Drop | `TMMobile_CanDropHere` (`0053A560`), `TMMobile_EndDrag` (`0053C260`), `TMMobile_PostPlaceEvent` (`0053BF40`) | the drop is checked against the room, the held object and the drop-icon explainer rules; on success the person is put in the room under the cursor (`TMMobile_SetOwnerAssetAndRoom`) and a `PLACE_<name>;<room>` event is posted; the hand and the carried-person globals are cleared (`TMCharacter_ReleasePickup`, `005997B0`) |
| Return | `TMMobile_UpdateDragMotion` (`0053A3A0`) | after a refused drop (state `+0x1F8` = 1 or 2) each 0.1 s tick moves the person toward the rest position by the smaller of the distance and **10 units**; within **2 units** they snap and the state returns to 0 |

## The web app

- **Press on a person and hold (250 ms) or move (6 px)** to pick them up; a short press is still a click (the dev menu's "Last click"). The orbit camera is held back while you carry.
- The person **follows the ground point under the cursor** exactly, hangs 0 to 0.5 units above it with the original's bob, and sways with its sway. The cursor shows a hand on a person and a closed hand while carrying.
- **Drop:** anywhere on the ground the world draws is allowed; the person stays and their saved position is updated in memory (not saved to disk: there is no saving yet). A drop outside the ground
  sends them back the way the original does (10 units per 0.1 s, snapping within 2).
- People keep playing their animation while carried (the original swaps in a held clip).

## Not done

- Rooms: the person is not put into the room under them, so their animation scene does not change and `PLACE_` events do not exist; `CanDropHere` (explainers, drop icons, room slot limits) is not ported.
- The pick-up sound and `PICK_UP_PLAYER_EFFECT`, the held animation, the dust puff on a drop (`TMMobile_SpawnDustPuff`), and dragging staff out of a room's slot.
- Time: the bob uses the browser clock, the return uses frame time; the original steps both on its tick.
