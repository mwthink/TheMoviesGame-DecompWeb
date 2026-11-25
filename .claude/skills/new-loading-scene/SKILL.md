---
name: new-loading-scene
description: Create a new "new loading screens" scene definition (a held-frame 3D character in front of a blurred film-set backdrop, behind the original-style text box) in web/src/screens/loadingScenes.ts. Use when asked to add, design or tune a loading scene, a loading screen look, or its character, pose, set or camera.
---

# Creating a loading scene

A loading scene is plain data in `web/src/screens/loadingScenes.ts` (`LoadingScene`, listed in `LOADING_SCENES`). The Options switch "New loading screens" makes the real loading screen
pick one at random. How it is drawn is in `docs/LOADING_SCREENS.md`, "New loading scenes"; read that section and the file first. A scene is: a name, a `CharacterSettings`
(`LoadingCharacterFraming.ts`), a flat `background` colour (the fallback), and an optional `backdrop` (`BackdropSettings`: a set model and a camera inside it).

## The editor (use it when the person can run the app)

The character viewer's **Loading scene** section makes a scene without hand-writing numbers: pose a person in the viewer, set the side, size, turn, set and camera, press **Preview**, then
**Copy scene as code** and paste the result into `LOADING_SCENES` (docs/LOADING_SCREENS.md, "The scene editor"). If the person gives you that code, check it with the steps below
(typecheck, the scenes test), add it, and document it. The steps below are for writing or adjusting a scene by hand.

## Steps

1. **Ask what is not given.** The look the person wants (genre, mood, which set), the side the character stands on, and whether the pose should hold or loop. Do not invent a story; choose
   sensible defaults for the rest and say what you chose.

2. **The character.** Start from `DEFAULT_CHARACTER`.
   - `costume`: a `.cos` file the install has (`pak.find(name)`; the loading-screen lab lists them). `look`: a whole character pasted from the character viewer (`OTMCHAR1:` string,
     `CharacterCode.ts`) when the person made one; it overrides the costume's head, hair, age and variants.
   - `clip`: an idle-type `.anm` that fits the skeleton (`clipFits`), and `frame`: the stored frame to hold (`0` is the standing pose people are drawn in). Leave `frame` out to loop the clip
     (it keeps the renderer running during the load).
   - `side` ("left" or "right": the character stands at a quarter or three quarters of the window's width), `size` (share of the window's height, 0.85 default), `nudgeX`, `nudgeY`.
   - `turn` (degrees about the vertical axis). The model's front is not at the camera at 0: **45 faces the camera** for the male 50s costume, and a positive turn is towards his own right. A
     character standing on the right looked best at about 75, so that he faces the middle; on the left, 45. Re-check by eye for a new costume. Both signs have been wrong before.

3. **The set, if there is one.** Sets are `data\set\set_*.ini` (`mesh = set_saloon.msh`; the ini's `[scene] setid` and `docs/FLM_FORMAT.md` section 1b list them). The camera must be **inside** the
   model: outside the walls only planks are visible. To find the inside, parse the mesh in Node and print each primitive's centroid and size by texture (`parseMsh` in
   `web/src/formats/Msh.ts`, `pakIndex()` in `web/tests/helpers.ts`; run with `OTM_GAME_DIR` set in the shell, never written into a file), then pick an eye height of about 1.7 to 2.2 and a
   `look` point down the room. Coordinates are the game's (x, y, z up). `fovDeg` about 70; `blurPx` about 14 and `brightness` 1 (the set is drawn unlit, so it is dark).
   Reflection, lightmap and glass textures are skipped by `LoadingBackdrop`; if a new set looks wrong, look there first.

4. **Add it** to `LOADING_SCENES` (reuse a `BackdropSettings` constant when scenes share a set). Keep names short and distinct: `?loadingScene=<part of name>` on the dev page shows only matching scenes.

5. **Check it.**
   - `cd web && npm run typecheck && node --test tests/loadingScenes.test.ts` (the test checks every scene's character, colour and camera).
   - Looking at it needs the game files, which the desktop preview cannot read: ask the user to run `npm run dev` from a terminal, turn on Options > Game > New loading screens, start a load
     with `?loadingScene=<name>`, and say what to change. Screenshots are costly (`CLAUDE.md`): if you must look yourself, start a second dev server on another port with `OTM_GAME_DIR` in the
     environment, drive `LoadingBackdrop` / `LoadingView` on a test page in the browser pane, and take one small screenshot at the end. Stop that server afterwards.
   - Pitfalls already met: a canvas made before it has CSS size is 2 x 2 pixels (the loading screen adds its `scene` class first); a frame drawn before the shaders compile is black (the
     backdrop waits with `executeWhenReady`).

6. **Document and finish.** Update the scene list sentence in `docs/LOADING_SCREENS.md` ("New loading scenes") and, if the state changed, the Loading screens row of `docs/STATUS.md`. Run
   `python3 tools/audit_firewall.py`. Commit only when asked.

## Never

- Commit game files or anything extracted from them. A scene holds only names (costume, clip, mesh), numbers and colours, which are facts about the binary's data, not the data.
- Write a machine path, a save's file name or a star's name into the scene, a test or a doc (`CLAUDE.md`).
- Change the Options default: the original's pictures stay the parity behaviour; the new scenes are opt-in.
