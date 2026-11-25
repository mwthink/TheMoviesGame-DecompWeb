# Auto-animated models (the waving flags) and the game clock

How the original animates scenery that moves on its own, and how the web app does it. Evidence labels: **[read]** = seen in the decompile, **[data]** = game
files, **[guess]** = a choice made where the evidence ran out. Code: `web/src/formats/Anm.ts`, `web/src/sim/anim/AutoAnimation.ts`,
`web/src/sim/core/GameClock.ts`; the tests are `web/tests/sim/autoAnimation.test.ts` and `gameClock.test.ts`.

## What is animated

A model is **auto-animated** when it is skinned and `data\animations\high\autoanimated\` holds `aa_<model>_v00.anm` (and `_v01` ... for variants) for it.
[data] In the archives: the flag prop `p_flag` and the lot gate `lot_gate` (each one flag on a pole, 7 bones, 55 frames), the horse and dog props (6 and 8
variants), a flying-saucer crane and the facility models `fac_wardrobe`, `fac_research`, `fac_publicity_office`, `fac_postproduction`, `fac_catering0`,
`fac_casting_office`. The `.msh` flag (`flags & 0x800` of the loaded mesh, `Mesh +0xe4`) marks them for the object code. The web app animates every model that
has a clip fitting its skeleton (same bone count and parents); today that is the flags.

The flag's cloth is one skinned primitive (49 vertices, material with `flag.dds`); the model's skeleton has 7 bones (`root`, `first_1/2`, `second_1/2`,
`third_1/2`) and the clip has 7 channels with the same parents.

## What drives it [read]

| Function | Name | What it does |
|---|---|---|
| `009820A0` | `Object_StartAutoAnimation` | When an object whose mesh has the flag is first handled: load its clips (`Mesh_EnsureAutoAnimSet`), pick one at random (`Object_PlayRandomAnimation`), mark the object started (`+0x9c |= 0x20000`) |
| `009DA570`, `00A72A60`, `00A71DE0` | `Mesh_EnsureAutoAnimSet`, `AutoAnimSet_GetOrLoad`, `AutoAnimSet_Constructor` | Cache of clip sets by model name; the clips are `aa_%s_v0%d.anm` for d < 11 and `aa_%s_v.anm` after |
| `00980250` | `Object_PlayRandomAnimation` | `Random_IntInRange(0, clipCount)`, clamped, then plays that clip with "loop forever" |
| `009A3A80` | `AutoAnimated_StepAll` | For every playing auto-animated object: `AnimInstance_SetFrame(currentTime + DAT_0105becc)`; if the time wrapped (new < old) `Object_PlayRandomAnimation` again |
| `009A5090` | `Frame_PresentationUpdate` | Once per **rendered frame**: calls `AutoAnimated_StepAll`, then stores `DAT_0105becc = timeGetTime() - DAT_0105be98`, the real milliseconds of the last frame |
| `00A03180` | `AnimInstance_SetFrame` | `time % Anim_GetLengthMs()`; detects the wrap |
| `0059EE40` | `Anim_GetLengthMs` | 100 ms per frame minus 100; if flag bit 1 is set only every third frame counts: `((n - 1) / 3 + 1) * 100 - 100`, at least 100 |
| `00985EB0` | `Anim_GetFrameAtTime` | the fractional frame `(n - 1) * t / length`, blended with the next frame (the last frame equals the first) |

**The answer to "is it tied to game-loop ticks?": no.** The flags move by the real elapsed milliseconds of each *rendered* frame (`DAT_0105becc`, which a frame-pacing routine in the
UI code also nudges within 5..99 ms), from the per-frame presentation update. The 10 Hz simulation tick
(`Timestep_NextTick`, `MAIN_LOOP.md`) and the game speed (`+0x38`) are not involved, so **a paused game keeps its flags waving** and fast-forward does not
speed them up. The flag clips are 55 frames with flag bit 1 set: 1800 ms per loop. After each loop a new random clip is chosen (the flags have one clip, so
it repeats).

Not read: how `DAT_0105becc` is limited when the window is minimised, and which function sets mesh flag `0x800` while loading (the web app does not need it).

## The pose

`.anm` channels are the model's bones in order; rotations are Euler angles per frame (`ANM_FORMAT.md`). The skinning follows the costume skinning
(`MSH_FORMAT.md`): a vertex is moved by each of up to four bones, blended by the weights.

- **[guess] The clip is applied relative to its own first frame, on top of the model's bind pose** (`PoseMode "rebased"`). The flag clips' frame-0 pose is
  *not* the bind pose: the clip's bone offsets (0.485, 0.476, 0.525) differ from the model's (0.547, 0.519, 0.467) and applying the clip's local rotations and
  translations as they are puts the cloth 0.8 units below the pole. Rebased, frame 0 equals the model as built (checked in the test) and the cloth swings
  about 0.5 units sideways, which looks like a flag in the wind. `PoseMode "absolute"` applies the clip as it is, for comparison with the original by eye.
- Every instance of a model shares one animator, so all the flags of a lot wave in step; the original gives each object its own clip and phase.
- The web app steps it from `GameView.tickGame()` with `engine.getDeltaTime()`, independent of the toolbar's speed.

## The game clock and the toolbar

`GameClock` is the original's fixed-timestep driver and calendar:

- [read] `Timestep_NextTick` (`00566B10`): an accumulator takes `frame time * game speed` and yields a tick for every 0.1 s it holds. Pause = speed 0.
- [read] `GameClock_AdvanceTick` (`0043B760`): each tick adds `1 / ticksPerDay` to the date (days at 365 per year, `SAVE_FORMAT.md`); a new whole day advances the
  weekday and recomputes `ticksPerDay` (`GameClock_UpdateTicksPerDay`, `0043B800`).
- [guess] **`ticksPerDay`**: the decompile lost the x87 result. Known: constants 4, 20, 1900, 1960, 0.05776; constant from 1960; exponential before. The port uses 20 from
  1960, 4 up to 1900 and a geometric blend between. The real value, and which way it runs, is open: measure the date advance in the running game (`CLASS_NOTES.md`).
- [guess] The toolbar's three speeds are 0, 1 and 3 times; the original's speed buttons have not been measured.
- The month names use plain 31/28/31... days (no leap days) because the date is 365 days per year; [guess] that the original's month lengths are these.

Toolbar (`web/src/ui/GameToolbar.ts`): pause, play, fast, the date and the cash. The cash is the save's header value and does not change yet (there is no
simulated economy); the date advances with the clock. Staff panel (`web/src/ui/StaffPanel.ts`): the people of the player's studio read from the save
(`CStaff` and `CStar` whose `PEmployer` is the `CStudioPlayer`), grouped by their staff slot group's `StaffCareer`.
