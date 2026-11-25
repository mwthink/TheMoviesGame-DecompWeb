# Loading screens

## How the original shows them [read] [data]

- **The pictures:** 17 DXT textures, 1024 x 1024, in `data\textures\ui\loadingscreens\` (`TEX_ALL0001.pak`): `load_alienrobo`, `bunny`, `cheer`, `chick`, `cowboy`,
  `dancer`, `doctor`, `droids`, `gi`, `hitman`, `home`, `monster`, `mum`, `office`, `subway`, `worker`, `zombie`. The names read like film genres and
  scenes (the game is about making movies); nothing else is in the folder. (The text below about the *content* of the pictures comes from the file names only.)
- **The choice is one picture, at random, per load, not a slideshow:** `Game_PickLoadingScreen` (`00422580`) lists `*.dds` in that folder (`FileList_Scan`,
  `009CA9D0`), takes `Random_IntInRange(0, count)` and keeps the file name, `ui\loadingscreens\<name>`. It is called from the loading routine
  (`FUN_00422750` = `Game_ConstructSystems`, which also ticks the loading bar from 0.05 to 1.0 between its stages, `Game_SetLoadProgress`), so a new game and
  a loaded save show it; the folder is scanned afresh every time, so a picture dropped into it is picked up.
- **The bar:** `data\ui\flash\loadbar.mfl` (a small Flash movie, 1.8 KB) draws the progress bar over the picture. The game's own other fixed screens (the
  vendor splash screens `lionhead_splash`, `ati_splash`, `intel_splash`, `splashscreen`, and `chineselegal.jpg`) are in `data\textures\ui\` and `legal\`.

## Browsing them

Run the dev server (`npm run dev` from a terminal, see `WEB.md`), open the main menu and choose **Loading screens (dev)**. The gallery shows every
picture as a thumbnail; click one (or use the arrow keys) to see it large, Escape to go back. The pictures are read from your install each time (nothing is
copied into the repository). With no local files configured, use **Load Game** once to pick the game folder first. Code: `web/src/screens/LoadingGalleryScreen.ts`,
`loadingPictures()` in `frontEndArt.ts`, `PakIndex.list()`.

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
