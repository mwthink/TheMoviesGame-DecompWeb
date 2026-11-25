# Loading screens

## How the original shows them [read] [data]

- **The pictures:** 17 DXT textures, 1024 x 1024, in `data\textures\ui\loadingscreens\` (`TEX_ALL0001.pak`): `load_alienrobo`, `bunny`, `cheer`, `chick`, `cowboy`,
  `dancer`, `doctor`, `droids`, `gi`, `hitman`, `home`, `monster`, `mum`, `office`, `subway`, `worker`, `zombie`. The names read like film genres and
  scenes (the game is about making movies); nothing else is in the folder. (The text below about the *content* of the pictures comes from the file names only.)
- **The choice is one picture, at random, per load, not a slideshow:** `Game_PickLoadingScreen` (`00422580`) lists `*.dds` in that folder (`FileList_Scan`,
  `009CA9D0`), takes `Random_IntInRange(0, count)` and keeps the file name, `ui\loadingscreens\<name>`. It is called from the loading routine
  (`FUN_00422750` = `Game_ConstructSystems`, which also ticks the loading bar from 0.05 to 1.0 between its stages, `Game_SetLoadProgress`), so a new game and
  a loaded save show it; the folder is scanned afresh every time, so a picture dropped into it is picked up.
- **The picture is a whole layout** [data]: every picture has the game's star logo at the top centre, **an empty speech-bubble box** at the lower left (fill (166, 183, 213),
  the same rectangle in all 17: x 0.170-0.811, y 0.570-0.964 of the 1024 x 1024 image) and one character (or two) standing at the right. The pictures contain no text; the
  game writes the text into the box.
- **The text is a tip** [read] [inferred]: `SplashTip_BuildHtml` (`005E68A0`, called through `SplashTip_Refresh` `005E6AF0`) takes a random text of the group
  `SPLASHSCREEN_TIPS` (`Localize_PickRandomText`, `009B7190`: `rand % count` over the group) and lays it out as an HTML table: the part before the first `<br><br>` is the
  heading (style `<x0>`, centred), then a 10 px gap, then the rest in black. The group is the **`FRONTEND_SPLASHSCREEN_<n>` entries** of `stringdatabase.lhts` (n = 10, 20 ...,
  about 26 of them, each "Heading<br><br>Body": Movie Quality, PR & Marketing, Star Moods, Lot Management, Genre Fit, Relationships, Photographers, Staff Management,
  Changing Fashions). The tip and the picture are chosen **independently** (nothing ties a character to a tip). The same random tip is also stored in the save header
  (`Savegame_WriteHeaderSection`, `004B28B0`, from a run-time table at `DAT_0104A988`; the save-load list shows it).
- **The bar:** `data\ui\flash\loadbar.mfl` (a small Flash movie, 1.8 KB) draws the progress bar over the picture; `Game_ConstructSystems` feeds it. The loading window is the
  registered screen `LoadScreen` (`Screens_RegisterLoadAndMoviePlayer` `0087EB30`, factory `LoadScreen_Factory` `0087DEF0`). The game's other fixed screens (the vendor splash screens
  `lionhead_splash`, `ati_splash`, `intel_splash`, `splashscreen`, and `chineselegal.jpg`) are in `data\textures\ui\` and `legal\`.

## The web app's loading screen

`web/src/screens/LoadingScreen.ts`, `loadingTips.ts` (tests `web/tests/loadingTips.test.ts`):

- **Background:** one random picture of the 17 (`randomLoadingPicture`), the picture square as large as fits the window, centred on a dark page.
- **Text box:** our own HTML box positioned over the picture's baked-in box (`LOADING_BOX`, in percent so it scales with the picture; text sizes use container units), with a
  random tip from the player's own string database (`pickTip`, heading in bold, the paragraph black) like the original's.
- **Progress:** our bar and the current-step line sit **inside the box under the tip**; an error replaces the tip and bar with the message and a Back button.
- **Fallback:** with no game files (or no strings) the old plain heading and bar show, and a missing database leaves the box with just the bar.
- Not done (next steps): the 3D character (the pictures' characters are baked in), the logo drawn separately, the game's own bar movie, a tip chosen to match the save, and the
  box fill drawn by us instead of the picture's, which would let the box size itself to the text.

## The loading-screen lab (dev)

Run the dev server (`npm run dev` from a terminal, see `WEB.md`), open the main menu and choose **Loading screens (dev)**. The page shows every picture as a thumbnail; choosing
one opens the **lab**: a live preview of the real loading layout (`web/src/screens/LoadingView.ts`, the same view `LoadingScreen` uses) with a collapsible control panel:

- **Picture:** previous, next, random; fit (the whole picture, or filling the window and cropping the edges).
- **Tip:** any of the game's tips, or a random one, or none.
- **Progress bar:** a fixed value, a 0 to 100 % animation (8 s), or the sweeping bar (when the length is unknown), and the step text under it.
- **Text box:** left, top, width, height (fractions of the picture), text size, heading and body colours.
- **Our own panel:** draw our own filled panel (colour, opacity, corner radius) over the picture's baked box, so the box can be resized or recoloured; the baked one shows around it
  if ours is smaller.
- **Copy layout as JSON** puts the current `LoadingLayout` on the clipboard, ready to become a new default in `DEFAULT_LOADING_LAYOUT`.
- **Background:** the picture as the game made it, the picture blurred and dimmed (which hides its baked character), or a plain dark backdrop; with the last two the logo can be shown cut out of the picture (below).
- **3D character:** see the next section.
- **Coming later:** costume layers, makeup and hair colour (as on people in the world), expressions, a moving camera.

The pictures are read from your install each time (nothing is copied into the repository). With no local files configured, use **Load Game** once to pick the game folder first.
Code: `web/src/screens/LoadingGalleryScreen.ts`, `loadingPictures()` in `frontEndArt.ts`, `PakIndex.list()`.

## The 3D character (lab)

A real-time character drawn on a transparent canvas **between the background and our text box**, so the text sits in front of it (`web/src/screens/LoadingCharacter.ts`, framing maths in
`LoadingCharacterFraming.ts`, layers in `LoadingView.ts`). In the lab's **3D character** section:

- **Show a 3D character**, **Side of the screen** (Left or Right: the character stands at a quarter or three quarters of the way across), **Costume** (any `.cos`; a plain hair by the costume's sex),
  **Animation** (the idle, wait, talk, wave and similar clips that fit the skeleton), **Random costume**.
- **Copy character from clipboard** / **Copy character to clipboard**: a whole look as one string (`OTMCHAR1:...`, `CharacterCode.ts`, `CHARACTER_VIEWER.md`) made in the character viewer. A pasted character
  keeps its head, hair, age, weight and costume variants until another costume is chosen.
- **Size** (the share of the picture's height the character fills), **Nudge across** and **Nudge up**, **Turn** (degrees about the vertical axis; 0 faces the viewer, a guess to check by eye).
- The character has its own Babylon engine on its own canvas (the page canvas belongs to the game view), an orthographic camera, and the same person pipeline as the world and the character viewer
  (`PersonModelBuilder`, `PersonMeshes`, `poseBones`). People are unlit by their texture, as in the world.
- **Background:** the pictures have their own character baked in (at the right), so over *The picture as it is* you see both; **Blurred** or **Plain dark** replaces it. With those, the **logo is cut
  out of the picture** (`logoFromPicture`: a brightness key over the logo's rectangle `LOGO_BOX`, a rough matte) and drawn above the background. Turn on **Our own panel** to replace the baked text box.

Not done: the real loading screen does not use the 3D character yet (only the lab does), it does not load the character in the background while the world loads, and hair, makeup and costume layers are
as simple as in the viewer.

## New loading scenes (option)

**Options > Game > "New loading screens"** (`newLoadingScreens`, off by default: the original's pictures are the parity behaviour). When on, `LoadingScreen` replaces the picture with a
*scene* (`web/src/screens/loadingScenes.ts`, plain data, test `web/tests/loadingScenes.test.ts`): a `LoadingScene` is a name, a `CharacterSettings` (costume, optional pasted `look`, clip, side, size,
nudge, turn, and `frame`) and a flat backdrop colour. The same `LoadingCharacter` as the lab draws the person on a transparent canvas behind the same text box, tip and bar (`LoadingView`).

- **Full window:** the colour and the character's canvas fill the whole window (the picture's 4:3 shape was only the original's hard-coded image); the character stands at a quarter or three quarters of the window's width and is sized by the window's height, while the tip box keeps the picture's square layout, centred.
- **`frame`** holds the clip at one frame (a stored frame number; fractions blend two) and skins the character once; left out, the clip loops. The scenes ("standing, left" and "standing, right", turn 45 on the left, which faces the camera, and 75 on the right, to face the middle) hold `idle_male.anm` at frame 0.
- **Set backdrop** (`LoadingBackdrop.ts`, `BackdropSettings`): a scene may name a film set model (`set_saloon.msh`, from `data\\set\\set_saloon.ini`; about 23 x 28 x 6 units, 57 primitives, 45 materials) and a camera inside it (`eye`, `look`, `fovDeg`, game coordinates, z up). It is drawn unlit by its textures on its own canvas behind the character (no reflection, lightmap or glass layers), at half resolution, once, and blurred and dimmed with CSS (`blurPx`, `brightness`). It is a suggestion of a place, not scaled to the person; the flat colour shows if the set cannot be drawn. The camera in `SALOON` is inside the saloon near the back (outside the front wall it sees only planks). The scene is drawn only once its materials are ready (`executeWhenReady`): a frame drawn while the shaders still compile skips those meshes and comes out black. The canvas needs its CSS size before the engine is made, so the loading screen adds its `scene` class first.
- **The box** (`LoadingView.setLegacyPanel`, CSS `.legacy-panel`): a scene has no picture with the box baked in, so the original's box is redrawn in CSS: the panel fill (166, 183, 213), a teal-grey frame and header band (120, 143, 158, read off the pictures; both are box-shadows of the panel, one grown and one raised, so they join its rounded top corners without a seam), a saw-toothed half-disc badge standing above the band with a tall white "i" that has depth (a stepped extrusion in the outline colour and a soft shadow; as in the original), and a drop shadow, at the picture's box rectangle (`LOADING_BOX`). The badge's teeth, the letter (Georgia bold, not the original's hand-drawn one) and the frame's exact curve are approximated.
- **Choosing one while tuning:** add `?loadingScene=right` (any part of a scene name) to the page address to see only the scenes named so.
- **Fallback:** the scene needs the game's archives and its costume and clip; if the character cannot be built, the original random picture is used, as it is while nothing is linked.
- **Not done:** more scenes and a way to capture one from the character viewer, a real backdrop (picture, gradient, blurred set) in place of the flat colour, the logo, looping scenes' effect on load time (unmeasured), and
  loading the character before the first load (the very first screen of a session can be before the archives are linked).

## The scene editor (character viewer)

The character viewer has a **Loading scene** section (`LoadingSceneEditor.ts`, wired in `CharacterViewerScreen.ts`). The person on the viewer's screen, their animation and the frame showing now become the scene's
character, so a scene is made by posing someone in the viewer as usual. The section sets the rest:

- **Name**, **Start from** (fills the fields from a scene already in `LOADING_SCENES`), **Side**, **Size**, **Nudge across / up**, **Turn**, **Hold the frame shown now** (off: the clip loops), **Backdrop colour**.
- **A film set behind:** the set (every `set_*.msh` in the archives), the camera (`eye` and `look`, x y z in the game's coordinates) and the field of view, blur and brightness.
- **Preview** shows the real loading layers (`buildSceneLayers`, the same code as the loading screen) over the whole window, with a sample tip and a moving bar; Escape or the button closes it. The camera is
  set by typing numbers; there is no dragging it round the set yet.
- **Copy scene as code** puts the TypeScript for the scene on the clipboard (`sceneToCode`, `loadingSceneCode.ts`, test `web/tests/loadingSceneCode.test.ts`): paste it into `LOADING_SCENES` in `loadingScenes.ts`. A
  whole look is written as `lookFromCode("OTMCHAR1:...")`, the same string the viewer's Copy character button makes. Nothing else is saved: the repository holds the scenes.

## Ideas for our own loading screens

The original's design is "one random cinematic picture plus a thin bar". Directions that fit a movie-making game and the app's data (the loader already
reports a label and a fraction, `LoadingScreen.ts`):

1. **One genre, one poster.** Keep the idea but make it a *poster* with a title card: each load picks a genre (the pictures already read as genres), and the
   tagline is the stage being loaded ("Coming soon: Building the scene"). The progress bar is the film's tagline underline.
2. **Film leader countdown.** The old-film countdown (8, 7, 6 ... with the circle sweep) driven by the progress fraction; the "2" is the moment the scene is
   ready. Works well with the loader's indeterminate phases (the sweep just keeps turning).
3. **Reel and film strip.** The progress bar is a strip of film that unspools frame by frame; each stage ("Reading archives", "Ground textures", "Model ...") is
   one frame that gets a thumbnail of the picture's area.
4. **Clapperboard.** A slate with scene / take / roll filled in from the save (studio name, date from the header, take = how many times it was loaded); the
   clap is the moment the game view appears.
5. **Era dressing.** Style the screen by the save's year: intertitle cards on black for the 1920s, Technicolor-style titles in the 1950s, grindhouse type in
   the 1970s. The year is in the save header before the world is built.
6. **Tips as trailers.** A "now showing" ticker of gameplay tips between the picture and the bar, changing every few seconds.

Any of these can reuse the original's pictures as backdrops, or replace them with new art; the pictures themselves belong to the game and stay in the
player's install.
