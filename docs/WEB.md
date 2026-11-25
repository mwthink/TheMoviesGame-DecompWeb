# The web version (`web/`)

Status: loads a saved game and draws its ground and buildings. A splash screen, a main menu, a Load Game screen, and a world view: the textured terrain
with its road and sidewalk, the lot's front gate (arch, pillars, flag, walls), the gatehouse and every other placed facility and prop. Shown on the fresh
1920 studio (3 placed assets) and on a Quick Start 1960 studio (285 placements, 53 distinct models). Nothing simulates yet: the world is a still picture you
can look around with the default orbit camera or the **game camera** (a port of the original's in-lot camera, `docs/CAMERA.md`), with a menu bar along the top
and a dev menu at the bottom right.

## Goal and approach

The aim is a version of the game that runs in a browser, not only a new renderer: simulation, scenes, UI, audio and saves as well. The original
is a 2005 Direct3D 9 game with online features that no longer work (`NETWORK.md`); the web version leaves those out.

Decisions so far:

- **Stack:** TypeScript, [Babylon.js](https://www.babylonjs.com/) (`@babylonjs/core`, imported per module so the bundler can drop unused parts),
  Vite, [fflate](https://github.com/101arrowz/fflate) for zlib. Babylon was chosen over three.js for the built-in particles, picking, audio and
  inspector. The call was close (the engine does not touch the simulation, UI or audio code), so keep Babylon types out of everything except
  `src/world/WorldScene.ts`, `shaders.ts` and `GameView.ts`.
- **Menus are DOM, not engine GUI.** The original menus are Flash movies (`FRONTEND.md`); the web version rebuilds them as HTML/CSS overlays on top
  of the canvas.
- **No game assets in the repo or on any server.** The same rule as everywhere else (`tools/audit_firewall.py`). The app reads the player's own game
  install in the browser, a slice at a time, and decodes what it needs in memory. Nothing is converted to files or cached yet.
- **The Python tools are the oracle.** The TypeScript readers are ports of `tools/pak_extract.py`, `msh_dump.py`, `dds.py` and `jad_dump.py`; the tests
  compare them with numbers those tools print for the same files.

## Running it

```
cd web
npm install
npm run dev        # http://localhost:5173 (port is fixed; the dev server fails if it is taken)
npm test           # the simulation and parser tests (the ones that need the game archives or a save skip when absent)
npm run movie-calc -- --help   # the movie quality / success / box-office calculator (REIMPLEMENTATION.md)
npm run typecheck  # tsc --noEmit, strict
npm run build      # typecheck, then the production bundle in web/dist/
```

Requires Node 20.19 or 22.12 or newer (Vite's requirement; the tests run `.ts` files directly, which needs Node 22.18 or newer; developed on 24).

**Try it quickly:** `npm run dev`, open `http://localhost:5173/?autoload`. In dev the server also serves the game archives and one save from this machine
(`vite.config.ts`, `/__local/...`, read-only, byte ranges; paths from `local.env` or the environment, `web/localPaths.ts`: the archives of `OTM_GAME_DIR`,
and `OTM_SAVE` or else the first save in the game's Saved Games folder). `?autoload` uses them and skips the menus; `?autoload=quick` (any part of a file name, case-insensitive) picks another `.jad` from the same folder (the server lists them all); the Load Game screen has a "Use local files" button for the same.
This endpoint exists only under `npm run dev`; the production build has none.

**Run the dev server from a terminal** when it has to read game files. Some sandboxed launchers (an editor's or an agent's preview server) cannot read
`~/Documents` or a CrossOver bottle and their reads hang; a server started from a terminal can.

In a normal browser, **Load Game** asks for the game folder (the one with `Data/pak` inside; Chromium's folder picker, which remembers the choice, or the
older `webkitdirectory` fallback elsewhere) and a `.jad` saved game. The archives are read in slices from disk, never uploaded.

## Flow

```
splash  --(3 s, click or any key)-->  main menu  --(Load Game)-->  Load Game  --(Load)-->  world view
                                          ^                           |                       |
                                          +-------- Back -------------+                       |
                                          +------------------------ Esc -----------------------+
```

| Screen | File | Notes |
|---|---|---|
| Splash | `src/screens/SplashScreen.ts` | Title card, fades in. Advances after `SPLASH_MS` (3000 ms) or on click or key. |
| Main menu | `src/screens/MainMenuScreen.ts` | Eight entries, listed in the `items` array. An entry is enabled only if it has an `action`; only **Load Game** is. |
| Load Game | `src/screens/LoadGameScreen.ts` | Pick the game folder and a `.jad`, then Load: opens the archives, parses the save, loads the world data, hands it to the game view. Shows progress and errors. |
| World view | `src/screens/GameView.ts` | A Babylon `Engine` and `Scene` on the page canvas, the menu bar and the dev menu. Default camera: drag = orbit, right-drag = pan, wheel = zoom. Game camera (chosen in the dev menu): WASD / arrows scroll, wheel zoom, Ctrl + arrows rotate, middle-drag rotate, Shift = 3x, pointer shoved against the window edge scrolls. Esc returns to the menu. |

## Code layout

```
web/
  index.html            one <canvas id="game-canvas"> and one <div id="screens"> that the DOM screens are mounted into
  vite.config.ts        dev-only local-files endpoint (see above)
  src/main.ts           screen switcher; the dev-only ?autoload shortcut
  src/style.css         all styling; body[data-screen="game"] shows the canvas, the other screens are .screen overlays
  src/screens/          Screen interface + splash, menu, load game, game view
  src/assets/           ByteSource (File, HTTP range), Pak (archives + index), inflate (fflate), hash, sources (folder pickers), remembered (IndexedDB)
  src/formats/          Ini, Csv, Dds (DXT1/3/5 decode), Msh (static models), Jad (saved game: placed assets, landscape), Rob (outside-the-lot scenery)
  src/sim/              the simulation, ported from the game (docs/REIMPLEMENTATION.md): movie, staff, studio, ai, boot, frontend, sandbox, character
  src/world/            WorldData (loads and prepares everything; no engine types), WorldScene (builds the Babylon scene), shaders
  src/camera/           GameCamera (the game's gameplay camera, no engine or DOM types, docs/CAMERA.md), CameraInput (DOM events -> its per-frame input)
  src/ui/               DOM overlays above the canvas: MenuBar (fixed to the top; `toolbar` is the empty slot for the game's toolbar), DevMenu (fixed bottom right)
  tests/                node:test files and helpers; tests/sim/ for the simulation; the ones that read the real game files skip without them
  tools/                command-line tools run with node (movie-calc)
  localPaths.ts         this machine's game install and saves, from local.env (Node only)
```

Things worth knowing before extending it:

- **Screens are built on demand** (`screens` in `main.ts`), so every visit starts fresh. The exception is `GameView`, which keeps its `Engine`
  between visits. `exit()` must undo everything `enter()` did (timers, `window` listeners, render loop).
- **`src/assets`, `src/formats` and `src/world/WorldData.ts` use no browser or engine API beyond `Blob`/`fetch`**, so the tests run them in Node. Keep it so, and
  write them in erasable TypeScript (no enums, no constructor parameter properties) because Node runs them without a compiler.
- **Pak access.** `PakIndex` reads each archive's header and entry table (a few hundred KB), then a file's chunk on demand. The Addon_* patch archives
  win over the base ones. Names repeat across directories (`fac_gatehouse.dds` is a thumbnail, `land_grass00.dds` a ground texture), so lookups pass a
  `dir`; the directory is recovered by hashing, as in `pak_extract.py`. Pak chunks and `zcmp` files carry padding after the zlib stream, which the
  browser's `DecompressionStream` rejects, hence fflate.

## How the world is drawn

- **Coordinates.** The game is right-handed with z up and the ground in x, y; Babylon is left-handed with y up. Game (x, y, z) becomes Babylon
  (x, z, y), which keeps the same top-down picture as `tools/jad_dump.py` (x right, y up). A placed asset's rotation is `rotation.y = -angle`.
  Because the mapping is a mirror, and Babylon's front-face convention is the opposite of Direct3D's, the triangle order from the file is used unchanged
  and back-face culling stays on (checked: the gatehouse is solid).
- **Terrain** (`WorldData.computeSplat`, `shaders.ts`). A flat 512 x 512 quad. The save gives three paint layers per vertex; they are composited into blend
  weights of up to 8 ground textures, stored as two 256 x 256 RGBA8 images (one texel per terrain vertex). The shader interpolates them bilinearly and
  blends the tiled textures. The 8 KB path bitmap becomes a nearest-filtered mask that shows the sidewalk texture on paved cells.
  The game draws terrain only inside x -192 to 192, y -128 to 256 (chunk enable flags, `SAVE_FORMAT.md`), so the quad is clipped to that, and the sidewalk tile is 4 units.
  A path cell (x, y) spans vertex x to x + 1, i.e. world `[2x - 256, 2x - 254]`, and **replaces** the ground paint (the game draws each ground texture only on cells that are not path cells; `SAVE_FORMAT.md`,
  "Corrections to the path-mask section").
  Ground textures tile every **12 world units** and the sidewalk every **4** (read from the draw routine's texture-matrix scales, 1/12 and 1/4).
- **Models** (`WorldData.loadWorldData`, `WorldScene.buildSources`). A model file is loaded and decoded once however many times the save places it
  (`MeshAsset`; a `Placement` points at one), and textures are decoded once per name. In the scene each model has one hidden source mesh per primitive, and every
  placed object is a frozen **hardware instance** of those (the shader includes Babylon's instancing chunks), so a hedge placed 40 times is one draw call per
  material. Materials are shared by (diffuse, lightmap) pair. One unlit shader per material: diffuse texture, times the lightmap (second UV set) times
  255/127 when the material has one, alpha below 0.5 discarded. This is `jad_dump.py --roofs` done on the GPU. Textures use REPEAT wrapping
  (Babylon's `RawTexture` clamps by default, and the models' UVs run far outside 0..1).
- **The lot's height.** The lot's z is 0 in the fresh-studio save but **1000** in all the Quick Start saves (every other object has z 0); the meaning is unknown, so the
  lot's meshes are placed on the ground whatever it says. (With z taken literally the gate floated 1,000 units up and was invisible.)
- **Outside the lot** (`src/formats/Rob.ts`, `WorldData.loadWorldData`). The visible fence, the gate, the road markings and the whole city around the lot are **data**:
  `data\landscape\outsidelot_high.rob` (and a thinner `_low` one), a text file with one object per line, `[name] [x y z] [angle] [scale]`, all in integer thousandths.
  The 415 lines (322 after dropping repeats and what the save already places) hold the concrete front wall, the wood side and back walls, corner posts, `lot_gate`,
  `lot_road_mark` (crosswalks and street markings), the cinema and shops across the road (the `p_debug*` meshes, which are real buildings under a development name), trees
  (`p_palm_tree02` at scale 0.65 to 0.73), hedges, planters, parking meters, benches, parked cars and street furniture. A name is a blueprint ini (its `mesh` key names the model) or a
  model's own name. `outsidelot_high.rob` is drawn for every `CLot`; the save's own gatehouse and billboard are not drawn twice. **Not drawn:** `osl_palmtree_02` and
  `osl_generaltree_01` (36 distant trees: no ini or model of those names; the game treats `osl_` names specially, `osl_treesprite_*` are likely their meshes).
  `data\city.ini` gives the cinema (46, -44) and the clinic (-36, -50) as gameplay positions (not used for drawing).
- **The fence the game's code builds** (`src/world/Perimeter.ts`, test `perimeter.test.ts`) is now only a fallback, and probably not what you see in the game: `CLot_BuildPerimeterWallAndGate`
  (0x469290) creates its wall objects and then calls `Object_RemoveFromScene` on each, then registers their footprints in the placement grid, so they look like invisible
  collision walls. Its front wall agrees with the .rob to the decimal (concrete segments at x -164.6 to 128.8, y 2.2), which is how both were checked. Its arithmetic, from
  the disassembly: the lot is `lotSize()` = 313.35 x 220 (`CLot_LoadSizeTiers`, 0x4675f0, snaps `lot.ini [size]` tier 2 = 300,224 to the 20-unit wall grid); two anchors
  A = (-44.6, 2.2) and B = (28.75, 2.2) (the constructor's defaults, the ends of the gate mesh) start the front wall, which runs 6 segments left of A and 6 right of B; sides
  of 11 segments, a corner post at the far right, a back wall closed with a filler piece: 50 wall segments, spanning x -164.6 to 148.75 and y 2.2 to 222.2. The footprints of
  everything the Quick Start save places span x -162.1 to 145.9, inside it. The lot's z is 0 in the fresh-studio save but **1000** in the Quick Start saves; its meshes go on
  the ground whatever it says. A and B are saved as the camera fields `SL_CamFoc` / `SL_CamZoo`, so a loaded game might rebuild this from other values.
- **Textures** are found under `data\textures\` (`WorldData.findTexture`): the main folder plus subfolders such as `lightmap\`, `props\`, `backdrops\` and `ui\logos\`;
  same-named thumbnails under `thumbs\` are never picked. DDS images are decoded on the CPU to RGBA and
  uploaded with generated mipmaps, so S3TC support in the GPU or browser is not needed. (Memory: 4 bytes per pixel instead of 0.5 to 1. Fine at this size.)
- **Cameras.** Two, switched in the dev menu (the default is the first). The **default** is a plain Babylon orbit camera placed south of the lot looking north. The **game camera**
  is `src/camera/GameCamera.ts`, a port of the original's normal-state camera (`docs/CAMERA.md`): it starts where the save had
  the camera (`SL_CamFoc` / `SL_CamRot` / `SL_CamZoo`, read in `Jad.ts`; the eye it computes matches the saved `SL_CamPos`), scrolls with acceleration, maximum velocity and damping
  from `data\ui\camera.ini`, zooms along the game's curve, rotates, and is kept inside the lot rectangle (`lotBounds` in `Perimeter.ts`) by testing where the screen's corners and top
  centre land on the ground. `GameView` runs it every frame and copies its eye, focus, horizontal field of view and near plane (far is 300) into a Babylon `FreeCamera` (game (x, y, z) -> Babylon (x, z, y)).
  Not ported: the other camera states (plan, follow, ...), pivot compensation while rotating, ground-grab dragging, the cutaway; see `docs/CAMERA.md`. Pointer limits in a browser:
  the original reads relative device motion, a page cannot, so an edge "shove" is the pointer's motion on arriving at the window edge (`CameraInput`).
- **Hover cutaway and room labels.** Pointing at a building that has named rooms (`room_*` mesh parts whose name has a key in the string database) swaps it for a cutaway copy that drops everything above 2.5 units
  (`CUT_HEIGHT`, the value `jad_dump.py --cutaway` uses; the game's own is not read) and writes each room's text on its floor (`GameView`: DOM labels projected each frame). Each such model is built twice
  (`WorldScene.buildSources(..., cut)`: its own materials with a `cutHeight` uniform), the cutaway instances start disabled, and hover (a throttled pick, 100 ms) swaps the enabled sets. The text comes from
  `Data/text/<language>/stringdatabase.lhts` (+ the add-on's), read by `src/formats/Lhts.ts` (a port of `tools/lhts.py`) from the game folder the player picked (or the dev server's `/__local/text/`); without it rooms have no labels.
  Fire rooms show their three possible texts joined ("Fire/Can It/Reject"); the game picks one at run time (`SAVE_FORMAT.md`). Labels are plain white text at each floor polygon's area-weighted centre. Shader gotcha: Babylon splits shader text at
  semicolons, so a `//` comment containing one breaks the line and the shader fails to compile.
- **Dev menu and menu bar.** `DevMenu` (bottom right, collapsible) holds the camera selector and read-only state: fps, the camera in use, and for the game camera its eye, focus, zoom,
  angle, fov, near/far, scroll velocities, edge-scroll state, the lot clamp's push and the lot rectangle. New controls and state rows go there (`DevMenu.show()` takes sections of
  name -> text). `MenuBar` is the 32 px bar fixed to the top of the game view; the toolbar will go into its `toolbar` element. Both are plain DOM in a `.hud` layer, shown only on the game screen.

## Checked

- `npm test` (91 tests; the simulation's are in `tests/sim/`, listed in REIMPLEMENTATION.md; the camera's in `tests/camera.test.ts`). The world view's: the case-folding hash; the ini reader; the pak index (the patched `facility_gatehouse.ini` comes from the Addon archive, thumbnails are
  not picked for textures); DDS decoding of DXT1, DXT3 against `tools/dds.py` (sums over every pixel); the gatehouse mesh against `tools/msh_dump.py` (31
  textures, 30 materials, 22,773 vertices, 10,997 triangles, the collision chunks and room parts, vertex sums); the save (the three placed assets, the
  landscape's texture names, 8,897 path cells, layer sums); the world loader (every ground texture found, blend weights sum to 255, no warnings).
- A Quick Start save (22 January 1960, 285 placements): every ini, mesh and texture is found with no warnings, and the 285 placements share fewer than 60 models
  (test 8; skipped when the save is absent).
- In the browser (Chromium, with the dev-server files): the world loads in a few seconds; the top-down view has the same layout as
  `jad_dump.py --terrain` for the same save; the gatehouse, gate, flag, walls and billboard are solid and textured; orbit works.
  Not compared pixel by pixel with the original game, and not tried: Safari, Firefox, the folder pickers (they open native dialogs), other saves,
  the production build, touch input.

## Known gaps

- **Materials.** Reflection, environment and sky textures (`refl_*`, `envmap*`, `gen_*`) are not drawn, so glass and mirrored surfaces are missing. The
  other flag dwords of a material and the second texture layer are not decoded. All materials are treated as opaque with an alpha cut-off.
- **No shadows or dynamic light, no sky.** Lighting is only the baked lightmaps (which assume a 2x gain; unconfirmed). The world ends at 256 units where
  the terrain does, against the clear colour.
- **Ground.** `land_alpha.dds` (a ragged edge vignette; its use in the draw code is not read) is not used. The terrain is flat because no height data was found.
- **Not drawn:** facility interiors and room floors, the other lot meshes, anything but the assets in the save (no people, litter, cars).
- **Saves:** only the placed assets and the landscape are read. Money, staff, films and everything else in `.jad` is ignored.
- **Performance:** the Quick Start lot is 1,621 instances of about 300 source meshes and 1 M vertices; loading takes about 3 s in Node (decoding is the cost) and the
  scene ran at about 30 fps in a software-rendered Chromium (not a measure of a real GPU). Not profiled. Possible next steps: merge static geometry per
  material, thin instances, and caching decoded textures.

## Next steps

1. Compare with the original: run the same save in the game under Wine, have the debugger DLL log the camera matrix, and diff screenshots from that viewpoint.
2. Draw the rest of the lot: `lot_road_mark.msh` (how the game uses it is not read), then check the other facilities and ornaments against the original.
3. The rest of the game camera (`docs/CAMERA.md`, "Not ported"): the plan, follow and move-asset states, pivot compensation, ground-grab dragging, and the cutaway; confirm the mouse button
   mapping, the wheel unit and the rotation sign against the running game (the dev menu shows angle and zoom to compare).
4. The simulation, ported to TypeScript (`STATUS.md`, `REIMPLEMENTATION.md`; `Math.fround` keeps it comparable with the original's 32-bit floats), run headless at the
   original's 10 Hz tick (`MAIN_LOOP.md`), then driven from the world view.
5. UI: rebuild the Flash menus as DOM using the decoded movies as the spec (`FRONTEND.md`), or try Ruffle on the `.mfl` files first.
6. Caching decoded assets (OPFS/IndexedDB) so a reload does not re-read and re-decode, if load time starts to matter.
