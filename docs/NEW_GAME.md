# Starting a new game: how the starting world is built

Status: read from the decompile, the disassembly and the game's own data files. The call chain and the file format are solid; what is *not* known is listed in section 7. Evidence is marked
**[read]** (in the code), **[data]** (in the game files) or **[inferred]**. Ported, with tests: `src/game/sandbox/StartingLayout.*`.

## 1. The short version

A new game does not start from a saved game. `Campaign_Begin` (0x4AF870) picks a **layout file by name**, `data/savedefaults/<year>.ini` (or `tutorial`, with `_clean` for an empty lot), and hands the
name to **`Game_ConstructSystems`** (0x422750), a function of about 45 steps that builds every game system and ticks the loading bar. The layout file lists the buildings and props the studio starts with. The
player's studio is created in the same function from the data typed into the profile screen, and the AI studios come from `data/rule/aistudios.csv`. A *loaded* game goes through the same function first
(`Savegame_LoadAndRestoreGame` calls it), so a new game and a load differ only in what is put into the freshly built systems afterwards **[read]**.

```
WProfileScreen_OnConfirm
  -> Campaign_Begin(startYear, x, tutorial)                              0x4AF870
       build the layout name:   "savedefaults/" + (tutorial ? "tutorial" : year)  + ("_clean" if sandbox/quick start and DAT_0104DE24)
       FUN_00467D50                                                      reset the asset lists
       Game_ConstructSystems(game, &name)                                0x422750   <- the world
            ... about 45 steps, loading bar 0.05 .. 1.0 (section 3)
            Lot_LoadStartingLayout(name)                                 0x46A780   (if the name is non-empty; empty means lots/basic_lot)
                 Lot_LoadLayoutFile(name)        -> data/<name>.ini       placements and hired staff
                 load "data/<name>.lnd"                                   the terrain
       set the start money (FUN_00442BE0), the start decade (CSandbox option 0)
       FUN_00530D90: every asset gets a virtual +0xBC(1.0)
       FUN_0048F3F0: sandbox only
```

## 2. The layout name **[read]**

In `Campaign_Begin`: the name starts as `savedefaults/`; the tutorial appends `tutorial`, otherwise the start year printed with `%d`; then, if `DAT_0104DE24` is set **and** the game type is
2 (sandbox) or 3 (add-on quick start), `_clean` is appended and the flag is cleared. `DAT_0104DE24` is the sandbox screen's "Start With A Ready Built Studio Lot" flag: it defaults to **1**,
so a sandbox starts on an **empty lot** (`_clean`) unless the player turns the option on, whose ON text is "a basic setup". A normal new game ignores the flag.

(An earlier version of this document, and of FRONTEND.md, first said this string loads a default save and then that nothing uses it. Both were wrong. The decompile of `Campaign_Begin` hides the
argument of the `Game_ConstructSystems` call; the disassembly (`lea edx, [esp+0x28]; push edx; call 0x422750`) shows the string is passed in.)

## 3. `Game_ConstructSystems`, stage by stage **[read]**

The function calls `Game_SetLoadProgress(f)` (`FUN_0041FD60`, draws the loading bar) between stages. The values are 0.1, 0.05 (it steps back after the list reset), then 0.15 up to 0.9, 0.94, 0.98 and 1.0, which gives the stages:

| value passed to `Game_SetLoadProgress` just before | stage (names are the project's, `FUN_` where nothing is known) |
|---|---|
| start | timer reset (`CTimer`), audio state, the loading screen (`ui\loadingscreens`), several unread inits |
| 0.10 | `FUN_00467D50` (reset the asset lists) |
| 0.05 | `CUnlockablePack` init, `FUN_00520230`, `FUN_004ADE40`, `FUN_00957870`, **`FinanceUI`**, `FUN_008BBB40`, `FUN_00461180`, `FUN_0044E5D0` (graph series) |
| 0.15 | **`GroundSystem_Constructor`** (14 KB: the terrain system, `pathlengthedgemult`, `pavementniceness`, `grassniceness`...) |
| 0.20 | **`Lot_InitFacilityRatiosAndGlobals`** (`toiletsperstar`, `toiletsperstaff`, `cateringperstar`...) |
| 0.25 | **`LitterScatter_Constructor`**, **`CLot_LoadPerimeterAssets`** (`facility/facility_gatehouse`) |
| 0.30 | `FUN_00519690` |
| 0.35 | `FUN_00446880` (18 KB: the walk-cycle and gait tables, `A_MALE_WALK`...), `FUN_008568A0` |
| 0.40 | **`ResearchSystem_Constructor`** (`research`, `researchone`, `sandbox`) |
| 0.45 | `FUN_0085F160`, **`AudienceTaste_Constructor`**, `FUN_005CE440` |
| 0.50 | **`GameSession_InitEconomySystems`**: `Studios_Initialize` (player studio, studio tuning, AI studios), `CityTraffic_Constructor`, the AI roster manager |
| 0.55 | **`ExperienceTable_Load`** (10 KB: `experience`, the `LOT_PER...` keys) |
| 0.60 | `FUN_0042D8D0` (relationships), `FUN_00859DA0`, `FUN_0054DD00`, `FUN_00575150` (photographers) |
| 0.65 | **`ScriptQuality_LoadTuningData`**, `FUN_0045EA70` (`jealousy`, `Money`, `Trailer`, `Love`) |
| 0.70 | `FUN_004AA500`, `FUN_008B86A0`, `FUN_005A1B90` |
| 0.75 | `FUN_009CBDF0`, `GlobalStatRegistry_Get`, `FUN_008D23B0`, `FUN_008443F0` (cinema), `FUN_006A7F20` (league screen), `FUN_0064B230` |
| 0.90 | `FUN_004EC0B0` (8 KB: a rule table with `weather`, `requires`, `flag`, `name`) |
| 0.94 | **`Lot_LoadStartingLayout(name)`** (only when the name is non-empty) |
| 0.98 | `autoexec.cfg` and `user.cfg` go to `FUN_005434E0`, an empty stub; flags: `this+0x86 = 1`, `this+0xC7 = 0`, game speed (`+0x38`) = 1.0, `DAT_0104A982 = 1` |

Identified since the table was drawn **[read]**: the timer (`FUN_00566CE0` creates the singleton `DAT_0104CDF4`, `FUN_00566C30` destroys it), `FUN_00422580` picks a random loading
screen, and the previous game's systems are torn down by `Game_DestroySystems` (`FUN_0041FB80`, about 25 destructors, clearing `DAT_0104A982` and `+0x86`). Most of the remaining `FUN_` calls
are constructors of singletons (relationships, photographers, awards, reviews, cinema, build-button data, debug data log, graph series, explainers); the names given to them in the
analysis were read from their `operator_new` size and strings, not from their bodies, so they are not in `renames.csv` unless an address is listed there.

The player's studio (`Studios_Initialize`, 0x512C50, formerly `StudioReputation_Constructor`) creates the `CStudio`, and, when the profile screen has been confirmed (`DAT_0104DCF8`), sets its
**name, icon and owner name** from the profile screen's data; it then loads the `studio` tuning (reputation inertia and half-life, the prestige factors, the star-rating factors that
`src/game/studio/StudioRating` uses, `capital0star`...) and calls `AIStudios_LoadRuleCsv` (0x512510) for **`data/rule/aistudios.csv`**.

## 4. The layout files **[data]**

In `MISC0000.pak`, `data\savedefaults\` has, for 1930, 1940 ... 2000: `<year>.ini` (the built lot), `<year>_clean.ini` (28 bytes, empty), and a `.lnd` of 214,763 bytes for each, plus
`tutorial.ini` and `tutorial.lnd`. 1900, 1910 and 1920 have only a short `.ini`. `data\lots\basic_lot.ini` (1,021 bytes) and `.lnd` (206,571 bytes) are the default when the name is empty; `data\movielot.ini`
is another layout (the only one found with a `hired_staff` section).

The `.ini` is the game's normal property format. Before the first section: `size = 2.00` (the lot size tier, `CLot_ApplySizeTier`), and in a few files `year = 1920`. Then one section per placed object, named
`[1.00]`, `[2.00]`...:

```
[4.00]
	name = facility/facility_stage
	position = 54.02, 59.38
	angle = 0.00
```

`name` starts with `facility/` (created by `Facility_CreateByName`), `set/` (`CSet_FindOrCreateByName`, e.g. `set/set_office`) or `ornament/` (`Ornament_CreateByName`); `position` is x, z; `angle` is
in radians; `cityobject` is optional. A `hired_staff` section (`builders`, `janitors`, `crew`, `writers`) hires staff (`Lot_HireStartingStaff`).

What the shipped files start you with:

| file | size | facilities | sets | ornaments | bytes |
|---|---|---|---|---|---|
| `1930.ini` | 2.0 | 10 | 3 | 58 | 5,811 |
| `1940.ini` | 2.0 | 11 | 3 | 74 | 7,313 |
| `1950.ini` | 2.0 | 13 | 3 | 80 | 7,932 |
| `1960.ini` | 2.0 | 15 | 3 | 137 | 13,038 |
| `1970.ini` | 2.0 | 17 | 3 | 125 | 12,284 |
| `1980.ini` | 2.0 | 19 | 3 | 132 | 12,999 |
| `1990.ini` | 2.0 | 21 | 3 | 202 | 19,328 |
| `2000.ini` | 2.0 | 23 | 4 | 226 | 21,682 |
| `tutorial.ini` | 2.0 | 2 | 0 | 32 | 2,806 |
| `1900.ini`, `1910.ini`, `1920.ini`, every `_clean.ini` | | 0 to 3 | | | 14 to 277 |

So the starter studio grows by about one or two facilities a decade, and 1960's holds a pre-production, production, script, stage, catering and trailer buildings (`facility/facility_preproduction`,
`facility_production`, `facility_script_2star`, `facility_stage`, `facility_catering2`, `trailer_1..3`...). The `.lnd` files are the terrain (the first bytes of `basic_lot.lnd` name the ground textures,
`Land_sand00`, `Land_grass00`...); the format was not decoded.

## 5. Where this connects to the rest

- `CSandbox` option 5 (instant build) makes `CAsset_OnPlaced` put each placed asset straight into its built state, so with it on, the starter buildings appear finished.
- `Campaign_Begin` stores the start decade in option 0 and the start money through `FUN_00442BE0` (two 64-bit values with a range check against 1e9, `Money_DebugCheckRange`).
- Continue and the load-game screen post `MT_GAME_LOAD` (0x231); `SaveLoad_PumpRequests` runs `Savegame_LoadAndRestoreGame`, which calls `Game_ConstructSystems` with an empty name first (the disassembly shows a string built with length 0 and passed in),
  so the systems exist before the save's objects are read into them (SAVE_FORMAT.md).

## 6. How to check this

- Extract the files: `python3 tools/pak_extract.py extract "<Data/pak>/MISC0000.pak" data/savedefaults_x '*.ini' --tree`.
- With the tracer, log `Game_ConstructSystems` and `Lot_LoadStartingLayout` and click New Game; the first should run once per new game and per load, the second only for a new game.
- Load a new 1960 game, then count the facilities in the studio: 15 are expected, plus the perimeter assets (`facility/facility_gatehouse`).

## 7. Findings on loading, staff and applicants

- **A load skips the layout** **[read, disassembly]**. `Game_ConstructSystems` calls `Lot_LoadStartingLayout` only when the name string's size field is non-zero. The load path builds the string with
  length 0, so no layout is read; the load only runs the constructor when `Game+0x86 == 0` (no game is built yet). The objects then come from the save file (SAVE_FORMAT.md).
- **There is no starting staff** **[data]**. No new-game layout (`<year>.ini`, `tutorial.ini`, any `_clean`) has a `hired_staff` section; only `movielot.ini` does, and no new-game path names it.
  A new studio starts with buildings and props only.
- **Applicants** **[read, partly]**. The wannabes (hopeful actors, crew) are an object pool of 10 dormant `CWannabe` objects made at construction. What fills the pool is a virtual on `CSubFacility`
  (`FUN_0084E5C0`) that scales the applicant supply by the studio star rating (`CStudio_ComputeStarRating`, ported in `src/game/studio/StudioRating`). The earlier `Applicant_*` names in the project
  (the costume fiddler's window spawner) have nothing to do with this and should not be relied on.

## 8. Not known

- Where each applicant-type sub-facility gets its parameters (`this+0x47/0x48`, supported staff), and the curve of supply against rating.
- `data/sandbox/moviesdefault.csv` (7,788 bytes): the sandbox's starting film library, probably; its loader was not found.
- The remaining singleton constructors in section 3 beyond the ones named; the worker thread procedure at 0x4ADE00 (a wait loop on a handle; not read further).
- The `.lnd` terrain format, and the lot size tier table.
- How the game clock's start date follows the start year (`GameClock_Constructor`), and which file `Weather_LoadRuleTable` reads.
- The asymmetry that a sandbox defaults to `_clean` (empty lot), while the front-end text for the option ("a basic setup") reads as if the built lot were the normal case.
