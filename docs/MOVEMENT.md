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
`TMCharacter_UpdateLocomotionStateFromSpeed` (`00599630`) maps under 0.3 to 0 (stroll), under 0.7 to 1 (walk), else 2 (run). That mapping applies only while the byte at `+0x5E4` is clear (`TMCharacter_SetLocomotionLock`, `00598F00`); while it is set the state stays at 3 (turning) or 5 (standing) [read].

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

**Grid** [read]. Occupancy is a 256 x 256 grid of 2-unit cells, cell = round((world + 256) / 2) (the rounding is in `0x0046BFD0`). The route finder that runs on it is described in "Getting from A to B" below.

## Getting from A to B (the original)

The destination is not chosen by the movement code. A **desire** picks an action, the action belongs to a **prop**, and the prop supplies the point to walk to. Everything below the prop is generic
and the same for every kind of desire. Evidence labels as in `CLAUDE.md`; addresses are in `tools/ghidra_names.csv`.

```
desire urgency  ->  CActivity (action, tied to a prop)          CLASS_NOTES.md 3ar, FLM_FORMAT.md 2
  CActivity_CreateRunner picks the runner state from CActivity+0x240:
     0  EnRoute            walk to the prop's goal            (Queueing instead when the prop has a queue)
     1  Turning            face the prop's heading
     2  ReadyAndPuppet     the interaction scene drives the character
  EnRoute -> Turning -> ReadyAndPuppet; a cancel or the scene's end sets 3
```

**The goal** [read]. `StateEnRoute_Update` (`00429DF0`) asks the prop for its goal through the prop's entry-point sub-object (`prop + 0x50`, virtual slot `+0xC`): a point and a heading, and false cancels the
action. A prop with a queue (`CActivity_CreateRunner`: the prop's slot `+0xE0` returns a queue object) gets `StateQueueing_Update` (`00429960`) instead: the goal is the character's entry point in the queue
(`CQueue_GetOrCreateEntryPointPosition`), and the character waits there until the front is free. Where a prop's goal comes from (its explainer ini and entry points) is **not read yet**.

**EnRoute per tick** [read]:
1. No prop, or the prop's goal call fails: `TMCharacter_CancelAction`.
2. Character position equal to the goal point: in position. Clear the locomotion lock, set the target heading (`+0x478`) to the goal's heading and the start heading (`+0x47C`) to the current one (`+0xC4`),
   log "StateEnRoute we are in position" and go to Turning. (The exact float equality only works because the mover ends on the goal point exactly [inferred].)
3. Within a short distance of the goal (squared distance under `DAT_00D18554`): tell the prop (its slot `+0xA4`, probably "someone is arriving") [inferred].
4. Clear the lock (so urgency picks stroll / walk / run), choose the mover (below) and hand it the goal and heading (`ActivityState_SendGoalToMover`, `00429890`).

**Turning** (`StateTurning_Update`, `00429640`) [read]. If the heading difference is large enough: locomotion state 3 (turn on the spot), the turn time is the elapsed time over the turn clip's frame count, the heading is
`Angle_LerpShortest` between start and target by that fraction; at 1 the heading is set, the activity state becomes 2, locomotion state 4 and the prop's interaction scene starts
(`Prop_GetPuppetSceneName` -> character vtable `+0x160`, `TMCharacter_PlayInteractionScene`). A small difference skips the turn. The turn clips are chosen elsewhere (`TMCharacter_PlayTurnAnimation`, above).

**ReadyAndPuppet** (`00429D90`) [read]: each tick it keeps the character in locomotion state 4; when the character's finished flag (`+0x15C`) is set the runner is marked finished and the puppeted flag cleared.
`CActivity_Tick` (`00402C40`) also sends `ai_stop` to the scene after a time limit and cancels an activity whose prop has the "gone" flag (`prop + 0x2B1`) before it reached state 2.

### The mover

The runner never moves the character itself. The character (`TMCharacter` constructor `0059E500`) owns two movers and `TMCharacter_GetMover` (`00598E20`) returns the one selected by `+0x5E0`:

| Mover | At | What it is |
|---|---|---|
| **Path agent** (`PathAgent_*`, 0xB8 bytes, `004ACD10`) | `+0x5D8` | follows a route over the lot grid; used while far from the goal |
| **Steering module** (`SteeringModule_*`, 0xDC bytes, `005094D0`, registered as `AVCSteeringModule_TM`) | `+0x5DC` | final approach near the goal; its internals are **not read** |

`StateEnRoute_PickMoverMode` (`004298D0`): the steering module (mode 1) when the character is within a set distance of the goal and the flag at `+0x724` is set, else the path agent (mode 0).
`TMCharacter_SetMoverMode` (`005990F0`) only switches after a counter (`+0x5F8`) has passed 20 ticks, so the mover does not flip back and forth [read].

**Path agent** [read]. It keeps a route as a vector of 2D points stored **last point first** (`+0x60` to `+0x64`), its own position (`+0x84`, `+0x88`), speed (`+0x04`), the goal (`+0x94`, `+0x98`),
a pending request id (`+0xAC`) and a throttle tick (`+0xB0`). Each call (`PathAgent_UpdateRoute`, `004AD750`, slot 0):
1. A goal within about one step of the agent's position is taken directly. Otherwise, if a finished path for the pending request exists (`PathQueue_FindResult`) its points become the route (trimmed to start near the agent).
2. If there is no route, or the goal moved, or the route ran out, and the throttle tick has passed (a global tick counter, `DAT_0104CDF4 + 0x3C`), a new request goes to the path queue (`PathQueue_Enqueue`).
3. `PathAgent_UpdateSpeed` (`004AB440`): speed grows by an acceleration per tick up to the character's speed for its current state (character vtable `+0x140`, the gait speed above), never under a fixed fraction of it;
   near the prop of its activity (the prop's flag `+0x2B3`) it eases down toward a lower speed.
4. `PathAgent_PopReachedWaypoints` (`004AC670`) drops points the agent is within about one step of.
5. `PathAgent_StepAlongRoute` (`004ABC50`): move the agent's position toward the last point by its speed; take the heading from that direction and smooth the character's heading toward it by 0.35 per tick
   (`Angle_LerpShortest`); push away from every other character within 6 units (a separation force, stronger, blend 0.5, when someone is very close, otherwise blend 0.1; coincident characters are nudged by a tiny random
   offset); then set the character's position and heading (character vtable `+0x28`, `TMCharacter_PlaceAt`). The character is **placed**, not driven by the clip: the gait clip is chosen to match the speed afterwards.
6. Cells along the route get a flag (`PathAgent_SetRouteCellFlags`, `LotGrid_SetCellFlagsAtWorld` with flag argument 8), so other code can see which cells people are heading through [inferred use].

**Path queue** [read]. Routes are found on a **worker thread** (`PathQueue_StartThread`, `004ADE40`; `PathQueue_ThreadProc`, `004ADE00`): requests (id, start, goal) and results are two lists behind one critical
section; `PathQueue_Enqueue` (`004ACEA0`) signals the thread's event and returns the id at once, and the agent polls for the result on later ticks. A character therefore starts walking a few ticks after the
order, and a new request for the same id overwrites the old one.

**Route finder** [read]. `PathFinder_FindRoute` (`004AD040`) -> `Grid_FindPath` (`0046F310`):
- Start and goal are moved to the nearest free cell (`LotGrid_SnapToFreeCell`, `0046CB40`) using `LotGrid_IsCellFree` with mask `0x31`; a goal that is blocked is approached along the straight line in steps
  until a free cell is met.
- `Grid_AStarSearch` (`0046E500`): A* over the cells with 8 neighbours, a Manhattan-distance estimate, a heap as the open list, a window of the two cells plus 128 cells (clamped to the lot) and at most 65,526
  expansions. `Grid_BuildRouteFromNodes` (`0046F1F0`) walks the parent links back and turns each cell into a world point; a post-process (`0046EE40`, not read) follows.
- When the search fails and the goal is far, `PathFinder_FindRoute` retries with points part-way along the straight line and then fanned to either side (the direction turned a little more each time, the distance
  shortened by a fixed factor), and as a last resort returns a route of just the goal.

The cell flags tested by the mask are in the cell's second word (blocked bits in the low nibble and `0x20`, `0x40`, `0x80`, `0x100`, `0x200`, `0x400`); which game object sets which is **not mapped**
(`LotGrid_BlockPathCell`, `TMLandscape_SetPathCell` / `ClearPathCell` are the setters to read next).

### What this means for the web app

The shape is: *goal from a prop -> (queue) -> route request -> follow the route at the gait speed, placed each tick -> turn on the spot to the prop's heading -> start the prop's scene*. The web app already has the
route, the walker and the gaits; it lacks the prop goal, the turn step, the hand-over to a scene and the soft separation. The A* here is a plain grid search, so `NavGrid.ts`'s A* with smoothing is a fair stand-in
except for the 128-cell window, the nearest-free-cell snapping and the one-point fallback.

### Not read

The prop's goal (explainer ini, entry points, `prop + 0x50` slot `+0xC`), the steering module, `0046EE40` (route post-process), what sets the grid's blocked bits, the urgency formulas of the desires, and which desire the
character starts when several tie (`TMCharacter_TryStartAnyDesireAction`).

## The web app

- **Gaits** (`Gaits.ts`): the three clips of a person come from `defaultGaits` (by the costume's sex) and `gait.ini` (a built-in list of clip names when the archives lack it). The speed of a gait is
  `anmSpeed` = stride over clip length, so feet do not slide. Three female clips (`walk_female.anm`, `walk_female_2.anm`, `walk_fem_bored.anm`) hold no frames in the layout the reader knows;
  such a gait uses its nearest working neighbour's clip and speed.
- **Grid** (`NavGrid.ts`): the lot's rectangle is walkable except under each placed model's footprint (`b15_02`, turned and moved as placed). Cells are 2 units, as the game's. Routes are
  A* over the cells with line-of-sight smoothing (a stand-in for the game's finder).
- **Walker** (`Walker.ts`): turns toward the next waypoint at 4.5 rad/s [guess], walks only when within 50 degrees of it, moves at the gait's speed. No turn clips are played yet.
- **Animation**: while a person walks, `PersonAnimator.setOverride` plays the gait clip; when they stop it returns to their room scene's idle.
- **Desires** (`web/src/sim/ai/DesireAgent.ts`, docs/DESIRES.md): people who are outdoors can act on the crap and buyfood desires: the most urgent one above a threshold picks the cheapest prop that offers it,
  the person walks to its goal, turns to its heading and uses it for a while. A person with an activity does not wander. Off by default (dev menu, Movement).
- **Wander** (`Wander.ts`): a [guess] stand-in for the game's desire-driven AI: people who are outdoors (no room scene, standing on open ground) wait 2 to 8 s, then stroll to a point 6 to 30 units
  away. Off by default; the dev menu's Movement section turns it on.
- **Orders**: click a person, then right-click the ground; the dev menu picks the gait. A person who is picked up stops, and stands where they are put down.

## Not done

Turn clips, the game's own route finder (read, not ported), its collision rules, walking through doors and between rooms, people avoiding each other (the path agent's separation push), speed changes with urgency, the idle clip (id 41) between trips, the steering module, and every desire but crap and buyfood.
