# The gameplay camera

What the camera the player has while managing the studio does, read from `MoviesSE.exe` (decompile plus disassembly) and ported twice: C++ in
`src/game/camera/GameCamera.{hpp,cpp}` (tests: `src/tests/CameraTest.cpp`) and TypeScript in `web/src/camera/GameCamera.ts` (tests:
`web/tests/camera.test.ts`). Both carry `orig: 0x...` addresses; the web app uses the TypeScript one (the dev menu selects it, `docs/WEB.md`).

Status: the **normal** state (the in-lot camera) is ported. Nothing has been compared with the running game frame by frame; what *is* checked against
the game's own numbers is listed under "Checked".

## Structure

One manager object (`Camera_Constructor`, 0x41B730; size 0x33C; global `DAT_00f87aa0`) holds a state machine. A state is a record built by
`Camera_StateMachine_Transition` (0x41A610) from the `[section]` of `data\ui\camera.ini` that has its name, plus callbacks. The state ids
(`Camera_RegisterDebugStates`, 0x41C240, the `MT_CAMERA_CASE_*` names):

| id | name | section | notes |
|---|---|---|---|
| 0x462 | NORMAL | `normal` | the in-lot camera: **ported** |
| 0x48A | MAP | `plan` | the build/plan view: fixed heading, no zoom or scroll (`zoomspeed 0`, `maxvelocity 0`) |
| 0x4B2 | FOLLOW | `follow` | follows a character (`TMCharacter`); leaves the state when the user scrolls or rotates |
| 0x4DA | FOLLOWBUILDING | `follow` | same for a building |
| 0x502 | MOVEASSET | | not read |
| 0x52A | DEBUG | `debug` | complete code, unreachable in retail (the console variable that would enable it is stubbed: `cam_allowfreecam`, `CVarSystem_Register_STUBBED`) |
| 0x552 | STATIC | `normal` | not read |
| 0x57A / 0x5A2 | DELETE / DELETE_ALL | | pop states |
| 0x5CA | (a `.cam` playback state) | | plays a recorded camera path `<name>.cam` for a `CSet`; not read |
| 0x61A | RESETPOSITION | | not read |
| 0x642 | MOVIEMAKER | `normal` | not read |
| 0x66A | FREECAM | `freecam` | complete code, unreachable in retail |

`Camera_Tick` (0x419E50) runs every frame for the current state; `cam_store`, `cam_recall`, `cam_reload` are registered console commands (stubbed in
retail like the other console variables).

### `camera.ini` (`Camera_LoadStateSettings`, 0x417010)

```
wheelscale = 10          # the code keeps 1000 / wheelscale  (DAT_00e4e410)
pushdistance = 10        # the code keeps its square         (DAT_00e4e414)
[normal]
  startfocus = -0.68345982,13.165312,1.6   heading = 0,57,-70   fov = 0.8   zoomcurve = 2.0   cameraspeed = 300
  rotationspeed = 0.4   zoomspeed = 0.5   acceleration = 150   maxvelocity = 40   damping = 0.001   startzoom = 0.25
```

State record offsets and the defaults the reader substitutes when a value is missing or 0: `+0x20` heading, `+0x2C` startfocus, `+0x40` fov (0 -> 1),
`+0x44` cameraspeed (-> 300), `+0x48` rotationspeed (-> 2), `+0x4C` zoomspeed (-> 2), `+0x50` wheelspeed (-> 1), `+0x54` zoomcurve (no default),
`+0x58` exclusive, `+0x5C` acceleration (-> cameraspeed), `+0x60` maxvelocity (-> 30), `+0x64` damping (-> 0.2), `+0x78` startzoom. In normal,
`cameraspeed` is only the default of `acceleration`; `rotationspeed` and `zoomspeed` are gains (see Tick).

## Camera state (manager offsets)

| offset | meaning |
|---|---|
| +0x90 | view vector, focus - eye (refreshed at the end of every tick) |
| +0xD0 / +0xDC | eye / focus (x, y, z) |
| +0xE8 / +0xEC | fov of the state / lens factor (1; Shift + wheel changes it, 0.05..1) |
| +0xF0 | near-plane limit, 1..15 |
| +0x218 | angle about the vertical axis through the focus, radians, wrapped to [-pi, pi] (0 = the heading as configured) |
| +0x21C | zoom: 0 far, 0.8 close (+0x29C = 0.8) |
| +0x228 | edge scrolling has started |
| +0x280/84 | this frame's pan; +0x288/8C rotation accumulators; +0x298 zoom accumulator (all zeroed at the start of a tick) |
| +0x2A0/A4 | keyboard scroll velocity; +0x2A8/AC edge-scroll velocity |
| +0x2B8/BC | this frame's pan input; +0x2CC zoom input; +0x2D8 rotate input |
| +0x2C0 / +0x2C8 | key zoom / wheel zoom; +0x2D0 key rotation; +0x2D4 mouse rotation |
| +0x318 | rotation axis (0, 0, 1) |

The save stores `SL_CamPos` (eye), `SL_CamFoc` (focus), `SL_CamRot` (angle, always 0 in the saves seen) and `SL_CamZoo` (zoom) in the `CLot`
object (`SAVE_FORMAT.md`). The name `SL_CamZoo` is the save's truncated spelling of the zoom.

## The per-frame tick (`Camera_Tick`, normal state)

1. `dt` = the frame time, but never more than 0.05 away from the previous frame's value (`DAT_00f87a90`). Pan, rotate and zoom accumulators are cleared.
2. **Keyboard** (`Camera_AccumulateKeyboardInput`): with dx, dy = +-dt for the held scroll keys, `v += (dx, dy) * acceleration`, then `|v|` is capped at
   `maxvelocity`. With no key held `v *= pow(damping, dt)`. With the **Ctrl** keys held the scroll keys do not scroll: left/right add `dx * 60` to the
   key rotation, forward/back add `dy * 50` to the key zoom, and the velocity decays.
3. **Mouse** (`Camera_AccumulateMouseInput`):
   - *Edge scrolling* (needs the window focused and the option on): while the pointer is on the viewport border (x <= 0, x >= width, y <= 0 or y >= height)
     it starts only once the pointer's motion that frame has `|rel|^2 > pushdistance^2` (the pointer is read as relative motion, so a shove, not a slow
     approach), and continues while the pointer stays on the border. The velocity grows by `dt * acceleration` along the unit vector from the viewport
     centre to the pointer (y flipped), capped at `maxvelocity`; otherwise it decays by `pow(damping, dt)`.
   - *Drag rotation* (engine key 0x75): `rotation += (-dx / (0.1 * width)) * 0.5`; vertical motion matters only in the debug states.
   - *Wheel*: `zoomWheel += wheel / (1000 / wheelscale) * 0.1`, times `wheelspeed`. With a Shift key held (engine 0x3A/0x3B, tested in this function)
     the wheel instead changes the lens factor, `lens -= wheel * 0.0005`, at least 0.05; otherwise the lens relaxes back to 1.
4. `Camera_AccumulateExtraKeyInput`: engine keys 0x7F/0x80 and 0x7D/0x7E add -1/+1 to the keyboard velocity (device unknown, see below).
5. **Combine** (`Camera_CombineInputs`): with the Shift keys (0x3A/0x3B) held every velocity, key zoom/rotation and mouse rotation/wheel is **tripled**. Then
   `pan = dt * (edge + key velocity) * lens`, `zoomIn = dt * keyZoom + wheelZoom`, `rotateIn = (dt * keyRotate + mouseRotate) * lens`.
6. **Callbacks** (normal state): *pan* (`Camera_PanCallback`): the pan is rotated by `atan2(view.y, view.x) - 90 degrees` (so "forward" follows the view) and
   scaled by `1 - zoom`. *zoom*: `zoomAccumulator += zoomIn` unless the pointer is over a window. *rotate*: `angle += rotateIn`, wrapped to [-pi, pi].
7. `zoomAccumulator *= zoomspeed; zoom += zoomAccumulator`, clamped to [0, 0.8]. (`rotationspeed` multiplies the rotation accumulators that the next tick zeroes, so
   it has no visible effect in normal.)
8. Eye and focus move by the pan; `Camera_PlaceEyeNormal` (0x4162C0) re-derives the eye:
   ```
   eye    = focus - heading * (1 - zoom)                          # x, y, z
   fz     = focus.z - heading.z ;  focus.z = 1.6
   eye.z  = pow((eye.z - focus.z_old) / fz, zoomcurve) * fz + 1.6 - 2.7
   eye    = rotate eye about the vertical axis through the focus by `angle`
   eye    = focus + (eye - focus) * min((eye.z - 1.6) * 0.05 + 0.1, 1)
   nearLimit = clamp(14 * (eye.z - 1.6) / (fz - 1.6) + 1, 1, 15)   (the ratio is at least 1 - lens^2)
   ```
9. `Camera_KeepInsideLot` (0x4167B0; a code label with no Ghidra function). It first sets the projection and near plane (`Camera_UpdateProjectionAndLookAt`:
   fov = `lens * fov`, **horizontal**; near = the distance along the view axis to the ground point at the bottom centre of the screen, never more than +0xF0, never below
   0.1; far 300, `DAT_00e4e418`). Then three ground points are found by casting rays through viewport pixels, with `a = view.z + 1` (view normalised) and
   `back = 0.5 * max(0, view.y_xy * (eye.z - 1.6))`:
   - lower left `(W (0.5 - 0.4a), H (0.75 + 0.25a))` meets the plane z = 1.53, margin `back`;
   - lower right `(W (0.5 + 0.4a), H (0.75 + 0.25a))`, z = 1.53, margin `back`;
   - top centre `(W / 2, H a)` on the ground, margin -1.

   Each point goes through `Camera_ClampPointToLot` (0x4166A0): the lot rectangle shrunk by 1.5 on every side, with the low-y limit moved out by `margin` (and not
   tested at all when margin < 0). The largest push per axis (ties keep the earlier one) is added to **both eye and focus**. So the limit is on what the
   screen shows, not on the focus: the lower corners may not leave the lot (a little more room at the front when facing +y and high), nor the top centre.
10. The lot rectangle (`CLot_ComputeWorldBoundsFromTier`, 0x467260): `minX = lot.x + anchorA.x - trunc(n / 2) * 20` with
    `n = trunc((tierWidth - (anchorB.x - anchorA.x) + 0.5) * 0.05)`, `maxX = minX + tierWidth`, `minY = lot.y + 2`, `maxY = minY + tierDepth`. For the tier 2 lot at the
    origin (313.35 x 220): x -164.6 .. 148.75, y 2 .. 222 (the fence has y 2.2 because its gate anchors sit at y 2.2). `web/src/world/Perimeter.ts` `lotBounds`.

## Input: which keys

The engine has its own key codes, filled from DirectInput scancodes by `Input_InitScancodeTable` (0xA95B30, index = DIK + 7): letters A..Z = 0x0B..0x24
(A = 0x0B), Ctrl 0x38/0x39, Shift 0x3A/0x3B, Alt 0x3C/0x3D, arrows 0x6B..0x6E (up, down, left, right). The four scroll actions (2..5) are bound by
`Input_SetDefaultKeyBindings` (0x5547E0) to **A, D, W, S** (0x0B, 0x0E, 0x21, 0x1D) and the **arrows**. So: scroll = WASD / arrows; **Ctrl + left/right** rotates,
**Ctrl + up/down** zooms; **Shift** triples every camera input; **Shift + wheel** changes the lens factor.

Not settled: engine keys 0x73, 0x74, 0x75 are three mouse buttons; 0x73 is the primary one in the UI code (clicks), so 0x73/0x74/0x75 are presumably
left / right / middle (DirectInput's button order). The camera rotates while 0x75 is held: **the middle button**, by that inference; a press of 0x74 (right) sets a
flag at +0x2DD whose use was not read. Engine keys 0x7D..0x80 are not in the scancode table (it ends at 0x72): another device. The web version leaves them unmapped.
The wheel unit of `DAT_00f87aac` was not traced; 120 per notch (Windows) is assumed, which gives 0.06 of zoom per notch.

## Checked

- **The eye placement against the game's own saves.** Eight saves from the game (three 1920 studios, five 1960 Quick Starts) store `SL_CamFoc`, `SL_CamZoo` and the eye `SL_CamPos`;
  `Camera_PlaceEyeNormal` reproduces the stored eye from focus and zoom to 1e-3 in every one, including the close zoom (0.582) where the pull-in factor drops below 1 and
  the far zoom 0 (three are fixed in `CameraTest` and `camera.test.ts` through `restore()`; the rest were checked once by script, and the web test reads one save). This verifies the eye/zoom/zoomcurve/heading arithmetic, not the input handling.
- The ini defaults and values against the real `data\ui\camera.ini`; the helpers by hand; the scrolling, damping, zoom and clamp behaviours by construction (checks derived
  from the formulas above, not from the game).
- In the browser (dev server, dev menu "Game camera"): the camera starts where the save had it, W scrolls, the wheel zooms by 0.06 a notch, Ctrl + arrows rotates,
  the clamp stops the view at the lot's edge, an edge shove scrolls and a slow approach does not. Not compared with the original's picture.

## Not ported, not read, unverified

- Other states (map/plan, follow, follow-building, move-asset, static, `.cam` playback, movie maker, debug, freecam) and the transitions between them.
- **Pivot compensation while rotating**: the tick keeps a stored ground point (`+0x22C`, found by `FUN_00415260`) fixed at the screen centre while a drag rotation runs, by shifting
  the focus (`FUN_00414F90` + the block after the callbacks). The port rotates about the focus, which sits at z = 1.6, near the ground point; the shift is small but real.
- **Ground grab** (`+0x2E8`, `+0x2EC`: drag the ground under the pointer with the primary button) and the cursor icons set by `FUN_009abd50`.
- The reset flag (`+0x2DC/+0x2DD`), tilt (`+0x28C`, `+0x294`: debug states only), `+0x2C4`, `+0x214` (copy of the zoom while below 0.5, use unknown), and six calls to `FUN_004137b0(dt)`
  (a cubic easing on a timeline object that the tick advances; its owner was not identified).
- `FUN_004233e0` (is camera input allowed: false while a modal window is up; the port assumes true).
- Keyboard rotation as decompiled is quadratic in the frame time (`rotateIn = dt * (60 dt) * lens`): about 57 degrees a second at 60 fps, four times that at 30 fps. Ported as read.
- The viewport aspect (`+0x108`) is assumed to be width / height; the fov is horizontal because the half height at the near plane is the half width divided by it (`Projection_SetFov`).
- Whether the lot's position (not 0, 0) shifts `minX` in the same way (`lot.x + anchorA.x`) is from the disassembly of 0x467260; every save seen has the lot at the origin.

## Functions named while reading this (also in `renames.csv`, `tools/ghidra_names.csv`)

`Camera_Constructor` 0x41B730, `Camera_LoadStateSettings` 0x417010, `Camera_Tick` 0x419E50, `Camera_AccumulateKeyboardInput` 0x414060, `Camera_AccumulateMouseInput`
0x418FE0, `Camera_AccumulateExtraKeyInput` 0x414260, `Camera_CombineInputs` 0x4198A0, `Camera_PanCallback` 0x4149F0, `Camera_ResetCallback` 0x414C90, `Camera_PlaceEyeNormal`
0x4162C0, `Camera_ClampPointToLot` 0x4166A0, `Camera_UpdateProjectionAndLookAt` 0x414F90, `Camera_RotateAboutPivot` 0x414360; math: `Math_WrapAngle` 0x4012C0, `Vec2_Normalize`
0x412C90, `Vec3_Normalize` 0x412E20, `Vec3_Cross` 0x4130D0, `Quat_Multiply` 0x413B10, `Quat_FromAxisAngle` 0x9A9BB0; view: `Projection_SetFov` 0x9A1950, `Projection_SetNear`
0x9A6070, `View_LookAt` 0x9A2830, `View_ScreenToWorldPoint` 0x9A1A20; input: `Input_IsKeyDown` 0x553F70, `Input_WasKeyPressed` 0x553FA0, `Input_IsActionDown` 0x554090,
`Input_SetDefaultKeyBindings` 0x5547E0, `Input_InitScancodeTable` 0xA95B30, `InputState_SetKey` 0xA0A790. Already named: `Camera_StateMachine_Transition` 0x41A610,
`Camera_RegisterDebugStates` 0x41C240, `TMInWorld_RayToPlane` 0x538EF0, `CLot_ComputeWorldBoundsFromTier` 0x467260. The CSVs have the names; they have **not** been applied to the
live Ghidra project (back it up first, `ANALYSIS_TOOLS.md`: `ApplyNames.java`). Code labels that Ghidra did not make functions (0x412750 apply pan, 0x4128A0 zoom callback, 0x414BF0
rotate callback, 0x4167B0 keep inside lot) can only be read with `objdump -d -M intel --start-address=... MoviesSE.exe`.
