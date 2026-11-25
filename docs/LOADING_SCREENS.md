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
