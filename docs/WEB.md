# The web version (`web/`)

Status: loads a saved game and draws its ground and buildings. A splash screen, a main menu, a Load Game screen, and a world view of the fresh 1920
studio: the textured terrain with its road and sidewalk, the lot's front gate (arch, pillars, flag, walls), the gatehouse building and the billboard.
Nothing simulates yet: the world is a still picture you can orbit.

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
npm test           # parser tests (need the game archives and a save, see below; they skip when absent)
npm run typecheck  # tsc --noEmit, strict
npm run build      # typecheck, then the production bundle in web/dist/
```

Requires Node 20.19 or 22.12 or newer (Vite's requirement; the tests run `.ts` files directly, which needs Node 22.18 or newer; developed on 24).

**Try it quickly:** `npm run dev`, open `http://localhost:5173/?autoload`. In dev the server also serves the game archives and one save from this machine
(`vite.config.ts`, `/__local/...`, read-only, byte ranges; paths from `OTM_PAK_DIR` and `OTM_SAVE`, defaulting to the CrossOver install and the
1920 "wine studios" save the tools use). `?autoload` uses them and skips the menus; the Load Game screen has a "Use local files" button for the same.
This endpoint exists only under `npm run dev`; the production build has none.

**Run the dev server from a terminal.** The desktop app's `preview_start` server (`.claude/launch.json`, entry `web`) cannot read files under
`~/Documents` or the CrossOver bottle: its reads hang. A server started from a terminal can, so use `npm run dev` there for anything that loads game files.

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
| World view | `src/screens/GameView.ts` | A Babylon `Engine` and `Scene` on the page canvas. Drag = orbit, right-drag = pan, wheel = zoom. Esc returns to the menu. |

## Code layout

```
web/
  index.html            one <canvas id="game-canvas"> and one <div id="screens"> that the DOM screens are mounted into
  vite.config.ts        dev-only local-files endpoint (see above)
  src/main.ts           screen switcher; the dev-only ?autoload shortcut
  src/style.css         all styling; body[data-screen="game"] shows the canvas, the other screens are .screen overlays
  src/screens/          Screen interface + splash, menu, load game, game view
  src/assets/           ByteSource (File, HTTP range), Pak (archives + index), inflate (fflate), hash, sources (folder pickers), remembered (IndexedDB)
  src/formats/          Ini, Dds (DXT1/3/5 decode), Msh (static models), Jad (saved game: placed assets, landscape)
  src/world/            WorldData (loads and prepares everything; no engine types), WorldScene (builds the Babylon scene), shaders
  tests/                node:test files and helpers; they read the real game files
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
  Ground textures tile every **12 world units** and the sidewalk every **2** (both from `docs/SAVE_FORMAT.md`; the 12 is assumed, not confirmed).
- **Models** (`WorldScene.buildModel`). One mesh per primitive, one unlit shader per material: diffuse texture, times the lightmap (second UV set) times
  255/127 when the material has one, alpha below 0.5 discarded. This is `jad_dump.py --roofs` done on the GPU. Textures use REPEAT wrapping
  (Babylon's `RawTexture` clamps by default, and the models' UVs run far outside 0..1).
- **The lot.** `lot.ini` names no mesh, so the lot's gate is hard-coded as `lot_gate.msh` at the lot's origin. It lines up with the sidewalk and the driveway
  patch in the terrain and looks like the in-game gate, but how the game picks and places the lot's meshes (`lot_road_mark`, `lot_wall_*`) is not read yet.
- **Textures** are found in `data\textures\`, `data\textures\lightmap\` and `data\textures\ui\logos\`. DDS images are decoded on the CPU to RGBA and
  uploaded with generated mipmaps, so S3TC support in the GPU or browser is not needed. (Memory: 4 bytes per pixel instead of 0.5 to 1. Fine at this size.)
- **Camera.** A plain orbit camera placed south of the lot looking north. The game's own camera (limits, edge scrolling, zoom, cutaway) has not been read.

## Checked

- `npm test` (7 tests): the case-folding hash; the ini reader; the pak index (the patched `facility_gatehouse.ini` comes from the Addon archive, thumbnails are
  not picked for textures); DDS decoding of DXT1, DXT3 against `tools/dds.py` (sums over every pixel); the gatehouse mesh against `tools/msh_dump.py` (31
  textures, 30 materials, 22,773 vertices, 10,997 triangles, the collision chunks and room parts, vertex sums); the save (the three placed assets, the
  landscape's texture names, 8,897 path cells, layer sums); the world loader (every ground texture found, blend weights sum to 255, no warnings).
- In the browser (Chromium in the desktop app, with the dev-server files): the world loads in a few seconds; the top-down view has the same layout as
  `jad_dump.py --terrain` for the same save; the gatehouse, gate, flag, walls and billboard are solid and textured; orbit works.
  Not compared pixel by pixel with the original game, and not tried: Safari, Firefox, the folder pickers (they open native dialogs), other saves,
  the production build, touch input.

## Known gaps

- **Materials.** Reflection, environment and sky textures (`refl_*`, `envmap*`, `gen_*`) are not drawn, so glass and mirrored surfaces are missing. The
  other flag dwords of a material and the second texture layer are not decoded. All materials are treated as opaque with an alpha cut-off.
- **No shadows or dynamic light, no sky.** Lighting is only the baked lightmaps (which assume a 2x gain; unconfirmed). The world ends at 256 units where
  the terrain does, against the clear colour.
- **Ground.** `land_alpha.dds` (probably the edge mask for blends) is not used. The terrain is flat because no height data was found.
- **Not drawn:** facility interiors and room floors, the other lot meshes, anything but the assets in the save (no people, litter, cars).
- **Saves:** only the placed assets and the landscape are read. Money, staff, films and everything else in `.jad` is ignored.
- **Performance:** every primitive is its own mesh and material (about 90 draw calls for this scene); fine now, merge by material when the lot fills up.

## Next steps

1. Compare with the original: run the same save in the game under Wine, have the debugger DLL log the camera matrix, and diff screenshots from that viewpoint.
2. Read how the game picks and places the lot's meshes; draw the rest of the lot (`lot_road_mark`, walls), then the other facilities and ornaments (`facility/*`,
   `ornament/*` use the same path as the gatehouse and billboard; a Quick Start save has dozens).
3. The game camera, once its code is read.
4. Decide where the simulation lives (`HANDOVER.md` item 9): the C++ in `src/` compiled to WASM, or a TypeScript port (which needs `Math.fround` to stay
   comparable with the original's 32-bit floats). Either way it should run headless at the original's 10 Hz tick (`MAIN_LOOP.md`).
5. UI: rebuild the Flash menus as DOM using the decoded movies as the spec (`FRONTEND.md`), or try Ruffle on the `.mfl` files first.
6. Caching decoded assets (OPFS/IndexedDB) so a reload does not re-read and re-decode, if load time starts to matter.
