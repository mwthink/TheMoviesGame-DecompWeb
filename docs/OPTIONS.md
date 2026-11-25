# Options

What the original game lets the player change, what the web app exposes, and what Babylon.js could add. Code: `web/src/settings/Settings.ts` (the values and their
storage), `web/src/screens/OptionsScreen.ts` (the screen), applied in `GameView.applySettings`; tests `web/tests/sim/settings.test.ts`.

## What the original exposes [read] [data]

The main menu's Options entry (`$options`, `FRONTEND_OPTIONS`) opens a sub-menu with **Video**, **Audio**, **Game** and **Online** options (`FRONTEND.md`, "The 19 menu items";
`$videooption`, `$audiooption`, `$gameoption`, `$onlineoption`; `FRONTEND_BACKTOOPTIONSMENU` returns). Each is a native window, not a Flash movie. Strings are
`GRAPHICSOPTIONS_*`, `AUDIOOPTIONS_*`, `GAMEPLAYOPTIONS_*`, `ONLINEOPTIONS_*` in `stringdatabase.lhts` (`tools/lhts.py --grep`). Values live in the registry through
`Config_GetOrCreateBool` / `Config_GetOrCreateInt` (`0x00541E50` / `0x00541C00`; keys seen: `Fullscreen`, `Audio Off`, `Autosave Setting`, `Played Basics`).

| Screen | Settings |
|---|---|
| Video (`WGraphicsOptions`) | screen size (800 x 600, 1024 x 768, 1280 x 960, 1280 x 1024, 1600 x 1200), colour depth (normal, high), graphical detail (low, medium, high, best, custom with its own sub-screen), windowed or full screen; changes apply at the next start (`GRAPHICSOPTIONS_SAVEANDRESTARTDIALOGUE`) |
| Audio (`WAudioOptions`, `WAudioOptions_Tick` `00631D30`; levels saved by `AudioOptions_SaveMixerLevels` `004F4E10`) | music volume, sound-effects volume (both in steps of 0.1, `Audio_AdjustVolume`), speaker set-up (PC speakers, headphones, ...), PA assistance (off, low, medium, high, full: the studio tannoy), radio (all speech, DJ and news, DJ only, news only, information only, none) |
| Game (`WGameplayOptions`, `WGameplayOptions_Tick` `00696140`) | level of help (no extra, minimal, moderate, maximum assistance), autosave interval (off, 5, 15, 30, 45, 60 minutes; `AutosaveSystem_Constructor` reads `Autosave Setting`) |
| Online (`WOnlineOptions`) | account and connection set-up for the dead online services (`NETWORK.md`): left out |

The **start options** of a new game (stars misbehave, buildings decay, instant build, stunts ...) are a different set: they are chosen when a game starts and saved with it
(`FRONTEND.md`, "The nine start options"; `web/src/sim/sandbox/SandboxOptions.ts`).

## What the web app exposes

Kept simple, as asked: five settings, in two groups. All are stored in `localStorage` (`otm.settings.v1`), applied at once, and fall back to the defaults when the stored value is damaged.

| Group | Setting | Effect | Original's counterpart |
|---|---|---|---|
| Graphics | Render size (50 % .. 150 %) | `engine.setHardwareScalingLevel(1 / scale)`: fewer or more pixels than the window | screen size |
| Graphics | Texture sharpness (1x .. 16x) | texture `anisotropicFilteringLevel`, read when a world is built | graphical detail (partly) |
| Graphics | Smooth jagged edges | an FXAA post-process on each camera, on top of the engine's own MSAA | - |
| Graphics | Show frames per second | a small counter below the menu bar | - |
| Graphics | Full screen | the browser's Fullscreen API (not stored: the browser decides) | `Fullscreen` |
| Game | Level of help | "no extra assistance" turns tooltips off (`Tooltip.setEnabled`); the other levels are the same for now | level of help |

Not offered, because there is nothing behind them yet: audio (no sound in the app), autosave (no saving), speaker set-up, PA and radio options, colour depth (a browser has one),
screen size in pixels (the window is the size).

## What Babylon.js could add

Candidates if wanted later, each a small change in `applySettings` or the engine set-up: MSAA sample count (needs an engine re-create, `new Engine(canvas, antialias)` only has on/off;
`RenderTargetTexture` samples apply to post-processes), a shadow generator (the game has none; people and buildings could cast), a hardware-scaling "adaptive quality" that lowers the
render size when the frame time stays high (`engine.getFps()` is already read for the counter), bloom or colour grading through `DefaultRenderingPipeline` (`imageProcessing`: contrast,
exposure, a vignette; the game's look is the baked lightmaps, so these are style choices), a frame-rate cap, hiding people or the lot's scenery for speed, and a texture-detail option
that decodes DDS mip levels from a lower level (saves memory on small devices).
