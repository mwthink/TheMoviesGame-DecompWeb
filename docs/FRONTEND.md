# The main menu (WFrontEnd)

Status: read from the decompile, the disassembly and the movie files' strings, ported to `src/game/frontend/FrontEnd.*` with tests. Nothing here has been compared
with the running game; the only runtime evidence is the boot trace in BOOT.md (the class is created at 53.9 s and `WFrontEnd_Tick` first
runs at 60.9 s). Ghidra drops arguments in several of these functions, so a few were recovered from the disassembly and say so.

## How it is built

The menu is a **Flash movie**, played by Lionhead's own SWF renderer. What was checked:

- The movies are the `.mfl` files in `data\ui\flash\` inside the pak archives (`MISC0000.pak`). They are **ordinary SWF files**: `frontend.mfl`
  starts with the bytes `FWS` and version 6, and all 86 distinct `.mfl` files carry `FWS` with version 4, 5 or 6 (uncompressed SWF). Lionhead
  only renamed the extension. The header's declared length does not match the file (628,899 against 28,031 for the first `frontend.mfl`);
  a likely reason is that the bitmaps were moved out into the `data\textures\flash\flash_<hash>.dds` textures, but that is a guess.
- The player is Lionhead's, not Adobe's: the `LSWF::*` classes (`LSWFFile`, `LSWFMovie`, `LSWFShape`, `LSWFEditText`, ...), with
  `LSWFShape_ParseDefineShape` reading SWF `DefineShape` data, plus `SWFCache`, `CSWFPlayer` and `CFlashScaler`. Error strings such as
  `LSWF Error: Unable to find variable %s` show it runs ActionScript variables. No Adobe Flash Player is involved.
- The movie calls the game by name, with plain ActionScript function calls (`ExternEnterMain()`, not `fscommand`): the player
  resolves a call to an undefined function by looking it up among the registered callbacks. `frontend.mfl` calls 20 of the 35 registered
  names, plus `ExternWin` and `ExternKillWin`, which `WFrontEnd` does not register (see "The movie, decoded"). The other menu-like movies are `frontend2.mfl`, `frontend_bak.mfl` (older copies), `installer.mfl`
  and `pause.mfl` (the in-game menu: it calls `ExternResume`, `ExternSave`, `ExternQuitGame`...). `tools/mfl_callbacks.py` reproduces this (extract first with `tools/pak_extract.py extract <Data/pak> data/pak_ui '*.mfl' --tree`; the output stays under the gitignored `data/`).
- The same mechanism runs through the whole UI: 17 of the 86 movies mention callback names, 21 distinct `cb_*` names (build menus,
  league tables, picture-in-picture clips, ...) and 25 distinct `Extern*` names. Each window registers the callbacks its movie calls
  (`FUN_0087DE50`), so the registration functions of the other windows are a map from UI to game code that has not been walked.
- **Thirteen registered callbacks appear in no movie**: the eight settings steppers, the four volume buttons and `ExternStartSandbox`.
  They look vestigial or are driven some other way; the options are separate native windows (`WGameplayOptions`, `WSandboxOptions`, ...).
  The sandbox is reached by the `$sandbox` item and by "Skip Front End" = 1, not by a callback from the movie.
- The ActionScript was decoded with `tools/swf_dump.py` for `frontend.mfl`, `pause.mfl` and `installer.mfl` (below). Shapes, fonts and bitmaps
  were not decoded. `.mfl` parses as SWF with that tool, so it is SWF in every way that was tried.

`WFrontEnd` registers **35 `Extern*` callbacks** (`WFrontEnd_RegisterExternCallbacks`, 0x692A90, through `FUN_0087DE50(name, this,
handler)`), fills the captions and `$command` names (`WFrontEnd_SetupMenuItems`, 0x693C80) and reacts to events
(`WFrontEnd_OnEvent`, 0x690F10). The registration runs only when the movie object exists (the check on `DAT_0104DAE4+0x358`).
`WFrontEnd_Tick` (0x6921C0) runs the state machine every frame. The object is 0x718 bytes, created lazily by `WFrontEnd_GetOrCreate`
(0x695DA0) into `DAT_0104DAFC`.

Most callbacks do one thing: `EventManager_PostEvent(DAT_0104917C, id, 0, 0)`. Everything that starts a game goes through an event id.

## The state machine (`this+0x610`, counter `+0x618`, limit `+0x61C`)

`WFrontEnd_SetState` (0x690E40) changes state and resets the counter; the limit becomes 1 for state 0, 25 for state 5, -1 for the others
(state 1 keeps it). All 13 external callers (the options windows, `WSandboxOptions_Tick`, `WGameplayOptions_Tick` and others) pass 1, which
means "show the main menu". The tick increments the counter first.

| state | name here | rule |
|---|---|---|
| 0 | Boot | when `limit < counter` (limit 10 after construction): if tier < 2 set audio state 4, then `SetState(1)` |
| 1 | Menu | if the background movie exists, set its alpha to `musicVolume * 0.45 + 0.45` every frame |
| 2 | ReturnToMenu | when the movie player is absent or finished: remove audio state 0, `SetState(1)`, show the background, start the 750 ms ready timer |
| 3 | CreditsExpack | when the movie ends: play `credits_expack[_low].wmv` and go to 4 |
| 4 | CreditsMain | when the movie ends: play `credits[_low].wmv` and go to 2 |
| 5 | Leaving | when `limit <= counter` (25 frames): ask the window to close (`flags \|= 1`); `WFrontEnd_OnEvent` ignores everything meanwhile |

Entering 3 or 4 from the tick also hides the background, sets its alpha to 0 and clears the "menu ready" flag `DAT_00E5E281`. The `_low`
files are used for quality tier 0 and 1 (tier is `DAT_0105BE08`); `credits_expack_low.wmv` additionally needs to exist (`FUN_009D3660`).
After every state: if "Skip Front End" is 1 the tick posts event 0x5B5 (sandbox), if 2 event 0x515 (new game), once (`DAT_0104DB00`);
and once the ready timer (`+0x714`) has passed, `DAT_00E5E281` becomes 1.

The credits button starts the flow: `completedGame` (config `CompletedGame`) plays `filmedcredits[_low].wmv` first and enters state 3,
otherwise it plays `credits_expack[_low].wmv` and enters state 4. So a completed game sees filmed credits, then the expansion credits,
then the main credits, then the menu.

## Events (`WFrontEnd_OnEvent`)

| id | from | effect |
|---|---|---|
| 0x515 | `ExternStartNewGame`, "Skip Front End" = 2 | config `Played Basics` true: state 5 and `WProfileScreen_Create(0, ...)`; false: hide the background, set `DAT_010503D2`, state 5 and run the Basics tutorial |
| 0x5B5 | `ExternStartSandbox`, "Skip Front End" = 1 | state 5, `WProfileScreen_Create(1, ...)` |
| 0x8FD | `AddOn1Qstart` | state 5, `WProfileScreen_Create(3, ...)`, `+0x608 = 0` |
| 0x795 | `ExternTutorial` | state 5, hide the background, run the tutorial (same sequence as New Game without the Basics) |
| 0x7E5 | `ExternResume` | if `+0x60C` (a game to resume): state 5 and `DAT_0104A982 = 1` |
| 0x71D | `ExternCredits` | the credits flow above, if the movie player exists |
| 0x7BD | `ExternOnline`, `-download` | `OnlineScreen_Open`, hide the background |
| 0x62D | `cb_trailereditor`, `-editor` | `TrailerEditor_Open`, hide the background |
| 0x5DD, 0x605 | `ExternOpenGame` | `LoadGameScreen_Open` |
| 0x80D, 0x835, 0x85D, 0x885, 0x8AD, 0x8D5 | Flash panels | open and close the text menu and the online, video and audio option panels; not decoded |

The new-game start properties come from the `studio` section (`startfunds`, `time`, `start`; `startfunds_quickstart` and
`start_quickstart` for the quick start), read and written through `FUN_00558750` / `FUN_00558A50`.

## From the button to the game

New Game, Sandbox and the add-on quick start do **not** start a game: they open the **profile screen** (`WProfileScreen`, 0x578 bytes) through
`WProfileScreen_Create(mode, ...)` (0x6E3200) and `WProfileScreen_Constructor` (0x6E2350). The mode is kept at `+0x528`: 0 new game, 1 sandbox,
3 add-on quick start. The screen has a studio name and an owner name box (`+0x358`, `+0x370`), the icon `ui/fullsrn_studioicon.dds`, the
message `PROFILESCREEN_DIALOGUE_MESSAGE` and a cancel message `PROFILESCREEN_CANCELNONAME`. The game starts when it is confirmed,
in `WProfileScreen_OnConfirm` (0x6E1220):

1. The two names are copied out (`FUN_004036D0`), `DAT_010503D0` takes the checkbox at `+0x539`, and `DAT_010503D1` takes `DAT_0104DD04`.
2. Mode 0 with config `Played Basics` false becomes mode 2 (and `DAT_010503D2 = 1`): a first-time player gets the tutorial.
3. By mode, each case resets or sets the **campaign start parameters** and calls `Campaign_Begin`:

| mode | game | start parameters (`CampaignParams_Set(index, value)`, array at `DAT_0104A974+0x60`) |
|---|---|---|
| 0 | new game | `FUN_00422250()`, `CampaignParams_ResetIfAny`, [6] = 1.0, `Campaign_Begin(+0x52C, +0x530, 0)`; then, unless "Skip Front End" is set, `Game+8 = 1` |
| 1 | sandbox | `FUN_00422250()`, [6] = 2.0, six sandbox options copied from the sandbox options object `DAT_0104DE3C` (bytes `+0x77C`..`+0x781`) into [1], [2], [5], [3], [8], [7], then `Campaign_Begin` |
| 2 | Basics tutorial | reset, [6] = 0, `Campaign_Begin(.., .., 1)`, `Game+8 = 0`, and config `Played Basics` is set to `"1"` |
| 3 | add-on quick start | [6] = 3.0, the stored names are used, `DAT_0104DE24` takes the flag at `+0x538` |

`WFrontEnd_OnEvent` runs the same tutorial sequence directly (without the profile screen) for the Tutorial button and for New Game
before the Basics have been played. Parameter [0] is the start decade, `(startYear - 1900) / 10`, and the defaults are [0] = -1.0,
[1..5] = 0, [6] = 1.0 (`CampaignParams_ResetDefaults`, 0x4AF370).

`Campaign_Begin(startYear, x, tutorial)` (0x4AF870) is the launch point:
- builds the game clock (`GameClock_Constructor`) into `DAT_00E4FA4C..60`; `DAT_00E4FA4C` is the clock in days that the debugger's
  `GAME_CLOCK_STARTED` marker watches (RVA 0xA4FA4C);
- loads a **`savedefaults/<n>` template** (the initial world and studio are built from a default save file, so the save format applies;
  see SAVE_FORMAT.md; what `<n>` is, is not decoded);
- when `DAT_0104DE24` is set and the game type is 2.0 or 3.0, loads a second string (not decoded);
- then runs `FUN_00467D50`, `FUN_00422750`, `GlobalStatRegistry_Get`, `FUN_008C9620`, `Money_DebugCheckRange`, `FUN_00442BE0`, `FUN_00530D90`
  and `FUN_0048F3F0`, which build the registries and the starting state. None of those was read. That is where the main game loop's
  state comes from.

`FUN_00422250` scans the user's movies folder (`Trailer_GetMoviesFolder`) for the highest numbered entry and works out the next movie number;
it is run before a new game or the tutorial starts.

## The movie, decoded (`frontend.mfl`)

`python3 tools/swf_dump.py <file> [--calls]` (SWF 4 to 6: tag stream, instance names, button and clip events, ActionScript 1 bytecode as pseudo-code).

`frontend.mfl`: SWF v6, 25 fps, **2 frames**. Frame 1 is a `stop()`. Frame 2 is labelled `start_ui`, places the clips, and its script calls
`ExternEnterMain()` and then stops. Every button then calls the game on a mouse event. All of it:

| button id | event | call |
|---|---|---|
| 56 | release | `ExternStartNewGame()` |
| 58 | release | `ExternTutorial()` |
| 72 | release | `AddOn1Qstart()` |
| 19 | release | `ExternContinue()` |
| 23 | release | `ExternResume()` |
| 74 | release | `ExternOpenGame()` |
| 79 | release | `ExternSave()` |
| 48 | press | `ExternOnline()` |
| 50 | press | `ExternCredits()` |
| 29 | press | `cb_trailereditor()` |
| 44 / 46 | press / release | `ExternOptionsClickedOpen()` / `ExternOptionsClickedClose()` |
| 52 / 138 | press | `ExternQuitClickedOpen()` / `ExternQuitClickedClose()` |
| 137 | press | `ExternQuitGame()` |
| 90, 98, 105, 111 | press | `ExternAudioClose()`, `ExternVideoClose()`, `ExternGameplayClose()`, `ExternOnlineClose()` |
| 117 | press | `ExternKillWin('load_dialogue')` |
| clip 118, frame 2 | on entry | `ExternWin('load_dialogue', 'LoadScreen', 'loadgame:close')` |
| clip 127, frame 15 | on entry | `ExternWin('Movieplayer', 'MoviePlayerScreen', 'movieplayer:close')` |

So 20 of the game's 35 registered callbacks are called, and the player also needs `ExternWin(name, screen, closeEvent)` and
`ExternKillWin(name)`. They open and close a game window by name: the load-game screen and the movie player are opened from inside the
movie this way. They are not registered by `WFrontEnd`; the names `LoadScreen` and `MoviePlayerScreen` are registered by `FUN_0087EB30`
(through `FUN_0087D600`), a small screen-name registry that was not read further. `pause.mfl` (the in-game menu) wires the same calls
with release for most buttons and press for Resume and Save; `installer.mfl` is the same menu with the Gamebut pair.

The game talks back to the movie by **instance names** and **frame labels**. The names it looks up are really in the movie: instance
names `quickstartbutton`, `continuebutton`, `notquit`, `textmenu`, `onlineoptions`, `video`, `audio`, `filmstrips_win`, `gamebutton`; and the labels
`start_ui`, `open`, `close`, `normal`, `saveon` and `saveoff` (the `Gamebut` callbacks and the panel events move the movie to those
labels). The movie has 36 instance names and 21 frame labels. The 21 text fields have no variable name, so the captions are set on the
instances by name. One lookup does not match: the game uses `savebutton`, the movie has `save_button`, so either the lookup ignores
the underscore or that call does nothing.

## The `Extern*` callbacks (registration order)

Settings, each clamped: resolution `+0x6EC` 0..3, difficulty `+0x694` 0..2, blood `+0x698` 0..4, detail `+0x6F0` 0..4
(`ExternResIncrease/Decrease`, `ExternDiffIncrease/Decrease`, `ExternBloodIncrease/Decrease`, `ExternDetailIncrease/Decrease`).
Volumes: `ExternMusicVolUp/Down` (channel 1) and `ExternSoundVolUp/Down` (channel 2) call `Audio_AdjustVolume` by +-0.1.
Events: `ExternStartNewGame`, `ExternStartSandbox`, `ExternOpenGame`, `cb_trailereditor`, `ExternOnline`, `ExternCredits`,
`ExternTutorial`, `ExternResume`, and `AddOn1Qstart` (the add-on gate, see below).
`ExternQuitGame` sets the main object's byte `+6`, which is what `Game_MainLoop` loops on.
Dialogs: `ExternAudioClose` `FUN_006376D0`, `ExternVideoClose` `FUN_0081A420`, `ExternOnlineClose` `FUN_006BBE60`,
`ExternGameplayClose` `FUN_00699510`. Panels: `ExternOptionsClickedOpen/Close` use `+0x712` and a mutex `+0x710`,
`ExternQuitClickedOpen/Close` use `+0x713` and the same mutex, `ExternEnterMain` clears the mutex.
Not read: `ExternSave` (0x68FAD0), `ExternGamebutOpen` / `ExternGamebutClosed` (`FUN_0068FEE0` / `FUN_0068FE10`, they touch the Flash names
`saveon`, `saveoff` and `savebutton`), `ExternContinue` (`FUN_00692530`, 6 KB).

## The 19 menu items

`$resume`, `$game`, `$load`, `$save`, `$newgame`, `$tutorial`, `$sandbox`, `$online`, `$options`, `$movies`, `$videooption`, `$audiooption`,
`$gameoption`, `$onlineoption`, `$credits`, `$quit`, `$quitquestion`, then `$addon1quickstart` and `$continue`. Each is a
`FRONTEND_*` caption passed through `Localize` (the key is the upper-cased name: `FRONTEND_RESUME`, `FRONTEND_NEW`, ...; `$movies` uses
`FRONTEND_MOVIEPLAYER`) and a command name stored in a 0x20-byte slot starting at `this+0x348`. Tooltips are set for the back button
(`FRONTEND_BACKTOMAINMENU`), quit, quick start (`FRONTEND_QUICKSTART_TOOLTIP`) and continue (`FRONTEND_CONTINUE_TOOLTIP`).

The last two items, and the `AddOn1Qstart` and `ExternContinue` callbacks, are created only when `FUN_00541F60(..)` is true. That function is
`return param == 0`, and the registration call passes 0, so in practice the gate is always open; it looks like a leftover from a build
that checked for the add-on.

## Helpers named along the way

`Config_GetOrCreateBool(key, default)` (0x541E50: reads the registry string, writes the default if missing) is how `Played Basics`,
`CompletedGame`, `CompletedStuntTutorial`, `CompletedNewGameTutorial` and `Audio Off` are read; `Config_GetBool` (0x541DE0) is the
non-creating one (`Fullscreen`). The audio manager is `Audio_GetInstance()` (`DAT_0104B0E4`) with `Audio_GetVolume` and
`Audio_AdjustVolume` (volumes in `DAT_0104B0AC[channel]`, clamped to 0..1), `Audio_SetState` (0x4F98F0) and `Audio_RemoveState`
(0x4F9B70); what each audio state id means is not known.

## Not read, and not verified

- `ExternContinue` (`FUN_00692530`), `ExternSave` (0x68FAD0), the two `Gamebut` callbacks, `FUN_0068FFD0` (references `.jad`) and `FUN_00693930`
  (the Continue tooltip text?) are unread. So is the 1.2 KB `FUN_0068F6E0`, which looks like an ambient particle spawner (random angles and
  radii around a point, calling `FUN_009B3A70`).
- `WProfileScreen`'s own logic (the name boxes, the validation behind `PROFILESCREEN_CANCELNONAME`, the star display in `FUN_006E3400`) and the
  eight functions `Campaign_Begin` calls are unread. The start parameters at indexes 1 to 5, 7 and 8 are not named.
- The constructor (`WFrontEnd_Constructor`, 0x695460) loads `ui/minspec_frontend.dds` for tier < 2 and the `frontend` movie
  with its `filmstrips_win` clip otherwise (that clip name is also in `frontend.mfl`); the rest of it is unread. `data/intro/frontend_intro.wmv` is not referenced by any string in the
  executable, so it may be unused.
- **Nothing was tested at runtime.** The port checks the logic against my reading of the code. A real test would record the state
  and the events while clicking through the menu under Wine (for example with the coverage tracer's markers around each button press).
- Where the decompile dropped an argument I assumed: `FUN_006B9380` takes 0 to show the background movie and 1 to hide it (seen in
  `SetState`, states 3 and 4), and the hide calls in `WFrontEnd_OnEvent` are assumed to pass 1.
