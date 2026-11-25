# The web version (`web/`)

Status: a skeleton. A splash screen, a main menu and an empty game view. It reads no game data yet and has no simulation.

## Goal and approach

The aim is a version of the game that runs in a browser, not only a new renderer: simulation, scenes, UI, audio and saves as well. The original
is a 2005 Direct3D 9 game with online features that no longer work (`NETWORK.md`); the web version leaves those out.

Decisions so far:

- **Stack:** TypeScript, [Babylon.js](https://www.babylonjs.com/) (`@babylonjs/core`, imported per module so the bundler can drop unused parts) and
  Vite. Babylon was chosen over three.js for the built-in particles, picking, audio and inspector. The call was close (the engine does not touch the
  simulation, UI or audio code), so keep Babylon types out of anything that is not rendering.
- **Menus are DOM, not engine GUI.** The original menus are Flash movies (`FRONTEND.md`); the web version rebuilds them as HTML/CSS overlays on top
  of the canvas.
- **No game assets in the repo.** The same rule as everywhere else (`tools/audit_firewall.py`). The splash text and styling are original. When
  the game loads data, it will come from the user's own install (see "Next steps").

## Running it

```
cd web
npm install
npm run dev        # http://localhost:5173 (port is fixed; the dev server fails if it is taken)
npm run typecheck  # tsc --noEmit, strict
npm run build      # typecheck, then the production bundle in web/dist/
```

In the desktop app, the `web` entry of `.claude/launch.json` runs the dev server. Requires Node 20.19 or 22.12 or newer (Vite's requirement; developed on 24).

## Flow

```
splash  --(3 s, click or any key)-->  main menu  --(Load Game)-->  game view
                                          ^                            |
                                          +-------- Esc ---------------+
```

| Screen | File | Notes |
|---|---|---|
| Splash | `web/src/screens/SplashScreen.ts` | Title card, fades in. Advances after `SPLASH_MS` (3000 ms) or on click or key. |
| Main menu | `web/src/screens/MainMenuScreen.ts` | Eight entries, listed in the `items` array. An entry is enabled only if it has an `action`; the rest are disabled buttons with a "Not implemented yet" tooltip. Only **Load Game** is enabled. |
| Game view | `web/src/screens/GameView.ts` | A Babylon `Engine` and `Scene` on the page canvas: dark clear colour and a placeholder `ArcRotateCamera` (a scene will not render without a camera). Nothing else. Esc returns to the menu. |

## Code layout

```
web/
  index.html            one <canvas id="game-canvas"> and one <div id="screens"> that the DOM screens are mounted into
  src/main.ts           screen switcher: show(id) exits the current screen, builds the next one, sets body[data-screen]
  src/style.css         all styling; body[data-screen="game"] shows the canvas, the other screens are .screen overlays
  src/screens/Screen.ts the Screen interface (enter / exit) and mountScreen / unmountScreen (fade in and out)
```

Things worth knowing before extending it:

- **Screens are built on demand** (`screens` in `main.ts`), so every visit starts fresh. The exception is `GameView`, which is created once and keeps its
  `Engine` between visits: a new WebGL context per visit is wasteful. `enter()` makes a new `Scene`, `exit()` disposes it.
- **`exit()` must undo everything `enter()` did** (timers, `window` listeners, render loop). `SplashScreen` and `GameView` show the pattern.
- **The canvas is hidden unless the game screen is current** (CSS on `body[data-screen]`), so the engine does not render behind the menus.
- The production bundle is about 950 kB (225 kB gzipped) for the blank scene, because importing `Scene` pulls in a lot of Babylon. Not optimised yet.

## Checked

Run in the desktop app's built-in browser (Chromium) only: splash shows, a click skips it, the menu lists the eight entries with only Load Game enabled,
Load Game shows the canvas with a working WebGL2 context, Esc returns to the menu, no console errors. Not tried: Safari, Firefox, touch input, the
production build served from `dist/`, other screen sizes.

## Next steps

These follow the plan discussed for the project; none is started.

1. **Asset importer.** Read the user's own `Data/pak` archives in the browser (drag in the folder, or a desktop wrapper), inflate the `zcmp` data and
   decode DDS, `.msh`, `.anm`, ini and csv. The formats are documented (`MSH_FORMAT.md`, `ANM_FORMAT.md`, `REIMPLEMENTATION.md`, `SAVE_FORMAT.md`) and
   have Python readers in `tools/` to check against. Cache the result in OPFS or IndexedDB; never host it.
2. **Load Game for real.** Parse a `.jad` (`SAVE_FORMAT.md`, `tools/jad_dump.py`) and show its lot: terrain, placed models, lightmaps.
3. **Decide where the simulation lives** (`HANDOVER.md` item 9): the existing C++ in `src/` compiled to WASM, or a TypeScript port (which needs
   `Math.fround` to stay comparable with the original's 32-bit floats). Either way the simulation should run headless and tick at the original's
   10 Hz (`MAIN_LOOP.md`), so it can be checked against logs from the original game.
4. **Game camera.** The original's camera behaviour has not been read; a debugger-DLL dump of its matrix would give a target to match.
5. **UI.** Rebuild the Flash menus as DOM using the decoded movies as the spec (`FRONTEND.md`), or try Ruffle on the `.mfl` files first.
