# Saved-game format (`.jad`)

What we can read out of a The Movies save, from three saves made on the Wine/CrossOver test setup
(`~/Documents/The Movies/Saved Games/`, i.e. `%USERPROFILE%\Documents\The Movies\Saved Games\` on Windows):

| Save | State |
|---|---|
| `crossover… 2354` | tutorial, first star hired, no facility yet |
| `crossover… 2355` | tutorial, a facility (catering) queued/pending |
| `wine studios… 2357` | straight after the tutorial: blank lot, $150,000, 1 Jan 1920 |
| `quick film studios… 0114` | Quick Start after loading in (added 2026-11-24): 1 Jan 1960, $1,247,923, state label `QUICKSTART`, 24 placed facilities, 252 ornaments, 7 `CSet` sets, ~30 `*Room` classes, 3,845 objects, 1.19 MB |

Tool: [tools/jad_dump.py](../tools/jad_dump.py) (summary, `--class`, two-save diff). Everything here is **observed from
saves and cross-checked against the decompiled save code** (see `FINDINGS.md` and `docs/MOVIE_SUCCESS.md` "Save mechanics");
anything marked *unverified* is a guess.

## Container

Written by `Savegame_SaveToDisk` (`004b37e0`) / read by `Savegame_LoadFromDisk` (`004b2b40`); the version literal is `"ver17"`.

```
8ab37c01 04000000 0a000000 0a          prefix
"[HEADER]\n"   tag(4)  cash f32  6 x u32  utf16 strings
"[STATICS]\n"  "#X" tag(4) value "\n" ...        global values (`SLVAR_LoadOrSaveStatics`)
"[OBJECTS]\n"  u32 count, then repeated:
    "[OBJ]\n" u32 total_len  u32 name_len  RTTI name (".?AVCFoo@TM@@")  u32 object id  "\n"
    "#X" tag(4) value "\n" ...                    one per saved variable (`Saveable_BeginVariable`)
    "[/OBJ]\n"
```

* Objects appear in the order the serializer writes them; **object ids are renumbered every save** (they shift when
  objects are added), so compare saves by (class, ordinal), not id.
* The **tag** is the 4-byte hash of the variable name (`FUN_009f3c40`): `h = h*0x17 + (c & ~0x20)` over the characters, 32-bit,
  stored little-endian (the `& ~0x20` makes it case-insensitive for letters). Names are the strings passed to
  `Saveable_BeginVariable` / the `SLVAR_*` macros. `tools/jad_dump.py` hashes every string literal in
  `data/ExportDecompiled` and caches the result in `docs/generated/save_field_names.csv` (~5000 names; about 92% of the
  distinct tags in these saves resolve). Unresolved tags print as `?xxxxxxxx`. The hash is weak, so a few names may be
  collisions (e.g. `CFinance` `Capital`/`Daily`/`Previous` look right but see "Money" below).
* A repeated tag inside one object is an array: `Spent[x]`, `Earned[x]`, `Thresholds`, etc.
* Pointers are saved as **object ids** (`P…` fields such as `PStar`, `PFloorPlan`, `PEmployer`). A null pointer is 0.
* Strings are `u32 byte_length` + bytes; wide strings are UTF-16LE including a terminator. Asset paths are narrow
  (`facility/facility_gatehouse`), names of people and studios are wide.

## Header

`cash` (f32, e.g. 150000.0 for a new studio), a few u32s that look like the real-world save time (hour, minute, …, day,
month, year: *unverified*), then the **state label** (`post-intro-tutorial`; set by the tutorial scripts, tutorial saves use
`no-facility-hired-star`, `pending-building`), the **studio name**, and the **boss/owner name** (`crossover`; the studio name is
empty/absent in the tutorial saves and is typed in at the end of the tutorial).

## Value encodings seen

* **Money** (`CFinance`, `CStudioAI.Capital`, `CStarCosts.*`): signed 64-bit fixed point, **value x 2^23**, checked against the header cash:
  fresh save `Capital` = 1,258,291,200,000 = 150,000 x 8,388,608; tutorial saves 147,875.62 and 144,020.82 match the header floats
  (147,875.61 / 144,020.83) to the rounding of the f32. Rival studios show e.g. 99,589.04.
* **Dates** are **f32 days at 365 per year** (1 Jan 1920 = 1920 x 365 = 700,800.0): `PreviousAwardsDate.YearInDays`, `DecayBegin`, `StatusComponentStartDate`,
  the 4-byte word at the start of the header. `Birth`, `Retirement`, `Death`, `ReleaseDate`, `Hired` are the same 4-byte f32 (not decoded per person).
  Not checked: `GUID` (8 bytes, a counter: 0x94, 0x95, 0xb5 ...), `PlayerUnlockDate` and the other research dates.
* **Vectors**: three f32 (`POSITION`, `SL_CamPos`, `SL_CamFoc`, `LastPosition`). `MyAngle` is a f32 in radians.
  World units are metres-ish, X right, Y up the lot, Z height (0 on the ground).
* **Booleans**: one byte. **Enum/ints**: 4 bytes. **Floats** (ratings, 0-1 sliders): f32.

## What is in a save, by class

Counts are for the fresh-studio save (the tutorial saves add the tutorial scaffolding listed after).

**Studio and world state**
* `CStudioPlayer` (1): player name, studio name (`name`), stars/projects/scripts lists, `StarRating`, `Prestige`, `AvStarMood`,
  set/genre boredom maps (`SLSetMapStrings`, `SLGenreMapBoredoms`, the `GenreSaturationTracker` inputs of `docs/MOVIE_SUCCESS.md`),
  `NumberOfMoviesReleased`, `LatestTechnology`.
* `CStudioAI` (4): the **rival studios** (Old Rope Cinema, Maxipack Worldwide, Lionear Productions, Creamboat Creations here): capital,
  happiness, prestige, star lists, research schedule pointer, `GenrePropensities`, `HassleRate`.
* `CFinance` (1), `CGraphDataSeries` (2; the HUD graphs), `CLeagueTable`/`CLeagueTableEntry` (3 / 20; star, studio, movie charts,
  with `rank`, `LastRank`, `Metric`), `CAwardsBonusManager`, `CAwardPrizePack` (14), `CReviewGenerator`, `CPhotographerManager`.
* `CResearchPack` (106): every unlockable research item with `IsAvailableToPlayer`, `IsAvailableToAll`, `PlayerUnlockDate`,
  `ResearchStartDate`, `DateAvailableToAll`. A fresh studio has 3 available (`startup`, plus two DLC trees).
* `CAIResearchSchedule` (4) + `CAIInterpolatedValue` (8, per-era `AverageValue1900/2000`): the AI studios' research pacing.
* `CSITTSystemState`: UI/tutorial flags (`BIsTutorialSkipped`, `BDrawBankBalance`, `BEnableSellRoom`, `BEnablePostProdRoom`, queue closed map…).
* `CSandbox` (9 `Option[x]`): the sandbox/new-game option toggles.
* `CThresholdPackage` (21, 126 `Values[x]` each) and `CExperience` (21): per-person trait-threshold and experience tables
  (`docs/TRAITS_AND_EXPERIENCE.md`).

**People**
* `CStar` (11) / `CWannabe` (10): one object per person. Stars carry `Ability`, `Boredom`, `Health`, `Cuteness`, `SexAppeal`, `WEIGHT`,
  `Drunkenness`, `Promiscuity`, `Publicity`, `StarRating` (+ `StarRatingAwards`), 55 `RivalSRComponents[x]`, `RehabCount`, `ImplantCount`,
  `NipTuckCount`, `LipoCount`, the stunt counters (`CountOneBarStuntsTried`… `CountFiveBarStuntsSucceeded`), `Patience`, `Birth`/`Death`/`Retirement`,
  `Head[0]`/`Head[1]`/`HeadMix` (face morph), `VoiceID`, `name`, `BioText`, and the relationships to other objects (`PEmployer`, `PBoss`,
  `PStaffCosts`, `PSubFacility`, `PMood`, `PAddictions`, `PRelationships`, `PCurrentCostume`, `PNormalCostume`, `PCurrentScript`, `PLastWorkingProject`).
  Wannabes (the casting pool, with `Hired` = 0) share the same body fields. `CStarCosts` (11) holds each star's pay
  (`Salary`, `SalarySettled`, `PurchaseCost`, `AnnualCost`, money encoding above).
  **Position:** a person has `POSITION`, `LastPosition`, `MyAngle`, `PInBuilding`, `PInRoom`, `InRoomName`/`InRoomIdx`, so character placement
  is in the save.
* `CCast` (4), `CRole` (5): a project's cast and role slots (`PActor`, `PCostume`, `PStuntDouble`, `RiskThreshold`, `ScriptPartID`).
* Relationship/mood/addiction/grudge objects (`CRelationship(s)`, `CMood`, `CAddictions`, `CGrudges`, `CPressBar`, `CWorkBar`): present only
  with hired stars (so only in the tutorial saves).

**Lot and buildings**
* `CLot` (1): camera (`SL_CamPos`, `SL_CamFoc`, `SL_CamRot`, `SL_CamZoo` (name truncated in the save), `SL_GameSpeed`) and `SL_Version` = `Build 001015 (12:25:19, Apr 27 2006)`.
  The terrain is a separate object, `TMLandscape`: see "Placement: coordinates, the 2-unit grid and the terrain" below (its 8 KB bitmap is the **path mask**, see the end of this file).
* Every placed asset shares one base layout: `SourcePath` (asset path), `PFixedAssetCosts`, `Knackered`, `NearlyKnackered`, `StateOfRepair`
  (1.0 = new), `BuildWorkDone`/`BuildWorkNeeded`, `DecayBegin`, `PPossessor` (owner), `PFloorPlan`, `POSITION`, `MyAngle`, `GUID`. The same
  base is used by `CFacility`, `CFacilityStageSchool`, `CFacilityTrailer`, `CSponsoredBillboard`, `COrnament`, `CLot`.
  **This gives the lot layout directly.** The fresh save has the gatehouse `facility/facility_gatehouse` at (-28, 10, 0); the tutorial saves add
  `facility/facility_stage` (0, 43.4), `facility/trailer_2` (29.3, 24.1, angle pi) and `facility/facility_catering1` (-24.5, 26.9, angle pi/2) and 32
  `COrnament`s (flowerbeds, hedges `p_hedge`/`p_hedge2`, palms, park benches) with positions and rotations.
* `TMFloorPlan` (one per facility, set or room holder) and `TMRoom` plus subclasses `CHireRoom`, `CFireRoom`, `CStarMakerRoom`,
  `CTrailerStarRoom`: room names (`room_staff_hire_janitor`, `room_ss_starmaker`…), enabled flag, object limits, `ObjectsIn` (what is placed in
  it), `PParentAsset`. `CSubFacility` is a staff slot group (`SupportedStaff`, `MaximumStaff`, `SpawnIndex`).
* `CBuildButtonData`: the build-menu lists (`FacItemList`, `SetItemList`, `PropItemList`).
* `CFixedAssetCosts`: running costs for a building (`PurchaseCost`, `DailyRate`, `AnnualCost`, `TotalSpentFix`/`Use`, `Bought`).

**Movies and scripts**
* `CProjectAI` (project), `CProjectSuccess` (`Overall`, `PublicInterest`, `CastStarRatings`, `EraFit`, the weighted/unweighted boredom components,
  `Technology`: the inputs of `docs/MOVIE_SUCCESS.md`), `CProjectIncome` (`InitialPool`, `DailyPercentage`, …), `CScript` (+ `PartDesc`/`ShotDesc`:
  the script's parts and shots, `Quality`, genre), `CCostume`, `CLogo` (studio logo file `logo_v00.dds`).

## Placement: coordinates, the 2-unit grid and the terrain

`jad_dump.py <save> --map` lists every placed asset (`SourcePath`, `POSITION`, `MyAngle`), checks coordinates against candidate grid steps and
prints an ASCII plan (`--svg out.svg` also writes a vector plot). `--terrain out.png [--occupancy]` draws the ground paint with the
assets on top (x to the right, y up; red squares = facilities, blue dots = ornaments); `docs/generated/terrain_2355.png` is the tutorial save.

**World to grid.** `WorldToOccupancyGridCoord` (`0046bfd0`) is `cell = round((world + 256) / 2)` for x and y. A cell is
**2 x 2 world units**, the grid is **256 x 256** and spans world -256..+256, world (0, 0) is cell (128, 128). The first index is x, the second y.
This is the same grid for the path bitmap and the terrain paint. Observed: 31 of 32 tutorial ornaments sit on odd integer coordinates (cell
centres), on quarter-turn rotations; facilities and the billboard are off-grid (fixed lot slots, e.g. catering at (-24.457, 26.873)).
Laying the assets on the terrain puts every one of them on the grass lot at the gate where the lot meets the road.

**`TMLandscape`** is one object with a single field (tag `922a5dd0`, ~223 KB), read by `FUN_009e5540`:

```
u32 length (of the rest)  u32 version (2)  u32 texture count (7)
7 x 32-byte NUL-padded names: Land_sand00, Land_grass00, Land_grass02, Land_grass01, Land_earth00, Land_tarmac00, Land_sidewalk02
65,793 cells x 3 bytes        = 256 rows x 257: index x*257 + y; the 257th column is a 0x3f edge sentinel
8,192 bytes                   path (pavement) bitmap, 256 x 256 bits: bit x*256 + y (byte = bit >> 3, mask 1 << (bit & 7))
~17 KB                        not decoded
```

Each cell byte is masked with `0x3f` by the loader and is one **paint layer**: three layers per cell. Low nibble = texture index (0xF = none);
bits 4-5 = blend weight `(value + 1) * 0.25` (from `FUN_009e23b0`). Layer 0 is the base (sand almost everywhere, hi bits 3 = opaque); layers 1 and 2
paint over it (grass, earth, tarmac). In the tutorial save most of the lot is grass with a dirt border, and the road is tarmac; the blank-lot save
has the same lot with different painting, and its own path bits.

The bitmap is the **path mask** (found 2026-11-24, see "The 8 KB bitmap is the path mask" at the end): a set bit means the 2 x 2 unit cell is paved path, drawn with the sidewalk texture. 9,305 of 65,536 cells are set in the tutorial save, 8,897 in the blank-lot save and 9,420 in the Quick Start save (the city's sidewalks and the lot's paths). Placed buildings are not in it; the lot building code (`CLot_RefreshOccupancyGridForBounds`, `00465a50`) turns every set bit into blocked sub-cells of the finer placement grid.

## From save names to game files

Game archives live in `<game>/Data/pak` (`tools/pak_extract.py list|extract`, which prints which `.pak` holds each file; the `Addon_2704_*` archives
are the patch layer and win over the base ones). Extracted copies go under `data/game_data/` (gitignored).

**Placed assets.** A `SourcePath` such as `ornament/p_hedge` or `facility/facility_gatehouse` names an **`.ini`** (`MISC0000.pak` / `Addon_2704_0000.pak`;
`pak_extract` does not resolve directories, so same-named inis from different folders come out as `name.ini`, `name.ini.2`, ...). The ini's `mesh = ...` line
names the model, which lives in `meshscene0000.pak`. **The model's own texture list is inside the mesh** (`docs/MSH_FORMAT.md`, `tools/msh_dump.py`); the
texture is *not* the same-stem `.dds` (an earlier version of this note said so; those `fac_*.dds` / `p_*.dds` files are probably UI thumbnails).
Everything below was found in the archives and the meshes parsed:

| `SourcePath` in the save | ini | mesh (`meshscene0000`) | textures read from the mesh |
|---|---|---|---|
| `facility/facility_gatehouse` | `facility_gatehouse.ini` | `fac_gatehouse.msh` | 31: `grou_ph43k`, `wall_ph50*`, `palm_tree_02`, `plant_ph0*`, lightmap `lm_1940gates_00`, `advert_chrysler_3` ... |
| `facility/facility_stage` | `facility_stage.ini` | `fac_stageschool.msh` | 51: `wall_ph*`, `grou_ph*`, `wood_ph*`, `land_grass00`, lightmap `lm_stageschool_fac_0` ... |
| `facility/trailer_2` | `trailer_2.ini` | `fac_trailer2.msh` | `lm_trailer2_0`, `envmap6`, `gen_mirrorwindow`, `fac_trailer6`, `gen_sky` |
| `facility/facility_catering1` | `facility_catering1.ini` | `fac_catering1.msh` | 34: `stuff_ph*`, `wood_ph*`, `steel_ph*`, lightmap `lm_catering1_snack_0` ... |
| `ornament/p_billboard` | `p_billboard.ini` | `outl_billboardt.msh` | `advert_chrysler_3`, `wall_ph50(a)`, `grating_rk01`, `light_ph04`, `plas_ph01`, `steel_ph24c`, lightmap `lm_osl_group_01` |
| `ornament/p_flowerbed_circle1`, `..._circle2` | same names | `p_flowerbed_circle1.msh`, `..._circle2.msh` | `p_flowerbed_circle1.dds`, `p_flowerbed_circle2.dds` |
| `ornament/p_hedge` | `p_hedge.ini` | `p_hedge.msh` | `hedge`, `hedge_stone`, lightmap `lm_hedge` |
| `ornament/p_hedge2` | `p_hedge2.ini` | `p_hedge2.msh` | `hedge`, lightmap `lm_hedge2` |
| `ornament/p_large_pot_plant4` | same name | `p_large_pot_plant4.msh` | `p_treepinkblossom`, `p_pot_plant4_128` |
| `ornament/p_palmtree` | same name | `p_palmtree.msh` | `palm_tree`, lightmap `lm_palmtree1` |
| `ornament/p_palm_tree02` | same name | `p_palm_tree02.msh` | `palm_tree_02` |
| `ornament/p_parkbench` | same name | `p_parkbench.msh` | `prop_bench` |
| `lot` (`CLot`) | `lot.ini` | the road/gate set: `lot_gate.msh` (41 textures incl. `flag`, `logo_v00`), `lot_road_mark.msh`, `lot_wall_*.msh` | |

The `.inf` next to a facility mesh holds named locator points (door, staff spots, `_fp_*` points) and a `thumbnail` entry. `lot.ini` lists three lot sizes
(`192,128`, `256,192`, `300,224`); their unit is not established.

**Footprints.** Each mesh carries flat collision/placement polygons and, for facilities, one floor polygon per room (`docs/MSH_FORMAT.md`). The code builds an asset's
footprint from the mesh's `b15_02` polygon (bounding box if absent), rasterized at **0.5 world units per cell**, and tests it against a finer runtime **lot cell grid**
(`docs/MSH_FORMAT.md`, "Placement footprint in the code"). The save's 256 x 256 bitmap is only the coarse 2-unit static blocked seed of that grid; placed buildings are
not in it (the gatehouse and catering footprints have no bits set under them). So the live footprint of an asset = its `SourcePath` mesh's `b15_02` polygon, rotated by `MyAngle`
and placed at `POSITION`; that can be reconstructed from the save plus the paks, and the grid itself cannot be read from the save alone.

**Ground textures.** The 7 names in `TMLandscape` are `.dds` files in `TEX_ALL0000.pak`, each added `land_` + the name in lower case:
`land_sand00`, `land_grass00`, `land_grass02`, `land_grass01`, `land_earth00`, `land_tarmac00` (256x256 DXT1 with 9 mips) and `land_sidewalk02` (128x128).
Decoded: sand and earth are tan/brown, `grass00`/`grass01` plain green, `grass02` dry grass, tarmac grey, sidewalk paving slabs. Also in the archive are
`land_alpha.dds` (DXT3, the blend mask, probably what the cell blend weight indexes), `land_sidewalk00/01`, and `lm_land_forest_*` (lightmaps/forest
textures). No saved cell has texture index 6 (sidewalk) in these saves.

## `CFinance` (decoded)

`Capital`, `Daily` and `Previous` are money (x 2^23). `Capital` = the cash shown in the header; `Daily` equals it in all three saves (the start-of-day figure);
`Previous` is slightly higher in the tutorial saves (147,908.49 vs 147,875.62), i.e. the previous day's closing balance. `LastYearLogged` = 1920.
`Spent[x]` and `Earned[x]` are 9 money slots each (category order not identified; the 9th slot is the total). Tutorial save 2354: 164.38 / 1,960.00 / total 2,124.38
(= 150,000 - 147,875.62). Save 2355: 1,019.18 / 3,000.00 / 1,960.00 / total 5,979.18, and the 3,854.80 cash drop between the two saves equals the change in total spent
(the 3,000 slot is the new building). The fresh save is all zeros.

## `[STATICS]` in detail

`[STATICS]` is the dump of the game's registered global variables (`SLVAR_LoadOrSaveStatics`, `0098d400`). It has three parts, in this order:

1. **Static vars** (49 in these saves), each a normal `#X` tag + value. The registration gives each a type 0-6: vec3, u32, byte, f32, string,
   wide string, tracked u32. Names seen: object pointers to the singletons (`PPlayerStudio`, `PGatehouse`, `PBillboard1`, `PTheLandscape`,
   `PFinance`, `PLeagueStar`/`PLeagueMovie`/`PLeagueStudio`, `PReviewGenerator`, `PPhotographerManager`, `PSandbox`, `PBonusManager`, `PDataLog`,
   `PBuildButtonData`, `PInstance`), the awards clock (`PreviousAwardsDate.YearInDays`, `LastRankCeremony`, `LastStuntRankCeremony`, `FirstAwardsYear` = 1925 in all three saves), build history (`EverBuilt`, `DateFirstBuilt`, `FirstTrainerBuilt`, `FirstStuntMovieReleased`), RNG seeds (`AIWinnerRandom.Germ`,
   `StuntSuccessRandom.Germ`), `NextAIStudio`, `LogoNum`, `GameID` (a wide string `<boss> 000000`), `ScriptCreationDisabled`, and the stress/boredom suspend flags.
   The singleton pointers are object ids, so they resolve to the objects in `[OBJECTS]` (`PGatehouse` -> the gatehouse `CFacility`).
2. **Static lists**, with no tag at all: the 24 global object registries. Each is `u32 count` then `count` x `(u32 object id, u32, u32)`. The two trailing
   words are the same for every entry of a list. They sit glued onto the end of the last tagged static var's value, which is why the parser sees one 2,176-byte "`PPhotographerManager`" value
   (it is 4 bytes of pointer followed by all the lists). `jad_dump.py --lists` splits them. In the fresh save the non-empty ones are:

   | list | entries | holds |
   |---|---|---|
   | 1 | 1 | every `CFacility`-family asset (gatehouse; the tutorial saves also list stage school and trailer, 4 total) |
   | 2 | 5 | all studios (`CStudioPlayer` + 4 `CStudioAI`) |
   | 3 | 106 | all `CResearchPack` |
   | 4 | 14 | all `CAwardPrizePack` |
   | 6 and 23 | 21 | all people (`CStar` 11 + `CWannabe` 10), two registries over the same set |
   | 19 | 1 | `CScript` |
   | 20 | 4 | `CProjectAI` |
   | 14 (tutorial only) | 32 | all `COrnament` |
   | 5, 9, 22 (tutorial only) | 5 | the tutorial-scoped subsets of people |

   The tutorial adds extra, differently-filtered people lists (5, 9, 22) so the tutorial save has 16/5/5-person subsets alongside the full set.
3. **Static arrays**, tagged but raw bytes: `VolumeControl` (3 x f32, all 1.0), `MaxSpeechLevel` (4 x u32), `StuntOptions`, `StatusComponentStartDate` (4 x f32 dates).
   After them comes the `[/STATICS]` marker and the object count for `[OBJECTS]`, which the parser prints as a bogus trailing `Suspended` value of 22 bytes.


## Tutorial vs fresh studio

Going from the last tutorial save to the fresh studio drops: all relationship/mood/addiction/grudge/press/work-bar objects, the 32 ornaments,
the stage-school, trailer and catering facilities, 9 `CCast`/10 projects (down to 4), 2 stars (13 to 11), and resets cash to 150,000 and the date to 1 Jan 1920. It keeps the lot, gatehouse, research table, league tables, rival studios and global systems.

## Corrections made while working this out

Earlier notes (chat, not committed) said `CFinance` held a "game clock" of 19,200,000 and that `CStudioPlayer` carried time. That was wrong: it came from
mis-slicing the first field's tag, which put the money value's bytes out of place. `Capital`/`Daily`/`Previous` are money; the game's date is the f32 days field.
The earliest summary also described the diff between the tutorial saves as spending on "building queued"; the data supports that (total spent rises by exactly
the cash drop) but which building the 3,000.00 is, is not recorded in the spent array itself.

## What we do not know

**Container**
* The prefix `8ab37c01 04000000 0a000000 0a`: `04000000`/`0a000000` are probably a version/length pair; not tied to the `"ver17"` check.
* The six header u32s `(23, 54, 1, 23, 11, 2026)`: they track the real-world save time in all three saves (hour 23, minute 54/55/57, day 23, month 11, year 2026),
  but the third word (always 1) and the exact order are guesses.
* The u32 after `[OBJECTS]` (7 in these saves) and the stray bytes after each `[/OBJ]` are not decoded; the parser ignores them.
* The `[STATICS]` end marker and object count are only inferred from the tail of the last array value.
* Static-list entries: two u32 words per entry, constant within a list. Maybe a list-node link or a type id.

**Fields**
* About 8% of distinct tags do not resolve to a name (examples: `?54a8e617` in `CAIResearchSchedule`, `?6bf1cbd8` in `CCast`, `?239a5558` in `TMFloorPlan`,
  `?2eaeb01f` on every placed asset, `?cd726d01`, `?f6e59d5d` in `CStar`). They are probably names that are built at runtime or live in strings that were not
  matched by the literal scan. Each could also be a hash collision with one of the resolved names.
* Field **types** are not stored; they are inferred from byte length and name. There is no schema. Fields of 8 bytes are either money, a 64-bit id or two u32s.
* The 9 `Spent[x]`/`Earned[x]` categories are not labelled. `CAwardsBonusManager.Settings[x]` (17), `RivalSRComponents[x]` (55 per star), `CThresholdPackage.Values[x]`
  (126 each), `Gardens`, `MyPeople`, `MyDesireMap.Values` have no known layout.
* Ornament/facility `GUID` (8 bytes) semantics, `StateOfRepair` / `BuildWorkDone` units, `SL_CamRot`/`SL_CamZoo` units.
* How a `CFacility`'s `SubFacilities` value (16 bytes: count + pointers + hash) is laid out beyond "count then entries".
* Terrain: the heightmap/mesh is not in the save (only the paint layers and the path bits below). The blend-weight meaning of bits 4-5 is from the code (`FUN_009e23b0`), not checked in game. The ~17 KB after the path bitmap is mostly zeros with scattered per-patch records (not decoded).
* Whether the sidewalk slab scale in the render (one texture tile per 2 world units) matches the game; the paths' exact blending at their edges.
* Whether the 2-unit grid applies to player-placed props and sets (only prebuilt tutorial ornaments have been seen).
* The meaning of the room/object `ObjectsIn` field (`TMRoom`) and `TMFloorPlan`'s repeated `?239a5558` (4 entries pointing to ids 1305-1308: probably its rooms).
* What is **inside** a placed set (its props and set pieces): the Quick Start save has seven `CSet` objects (`set/set_hotelbedroom_shabby`, `set_stagecoach`, `set_landscape_desert`, ... with `SourcePath`,
  `POSITION`, `MyAngle` like every placed asset, in a backlot area at x -140..-80), but how their contents and the player's own set edits are stored is not decoded; a save with a player-built set is still needed.

**Behaviour**
* Whether the game accepts an edited save (cross-references, counts and the static lists must stay consistent; the lists contain every object id, so adding an
  object means updating them too). Untested.
* Loading: nothing here has been checked by loading a modified save in the game.
* Save files from the non-Wine game, a later decade, or a game with released movies have not been looked at. Fields such as `ReleaseDate`, `Performances`,
  `CProjectIncome` and `CTrailerData` blobs are only seen in empty form (the tutorial projects are placeholders).
* The tool's two-save diff is noisy because object-id references shift (see above); a remap pass is not written.

## Reproducing

```bash
python3 tools/jad_dump.py "$HOME/Documents/The Movies/Saved Games/<save>.jad"          # summary
python3 tools/jad_dump.py <save>.jad --lists                                            # static registries
python3 tools/jad_dump.py <save>.jad --class CStar                                      # one class with field names
python3 tools/jad_dump.py <save>.jad --map [--svg out.svg]                               # placed assets, grid check, plan
python3 tools/jad_dump.py <save>.jad --terrain out.png [--no-paths] [--occupancy]            # terrain paint + paths + assets as a PNG
python3 tools/jad_dump.py <save>.jad --terrain out.png --footprints <ini+msh dir> --roofs <dds dir> --ground <land dds dir> --crop -64,-8,64,72   # textured top-down view (docs/MSH_FORMAT.md)
python3 tools/jad_dump.py <a>.jad <b>.jad                                               # diff
```

## Quick Start save (2026-11-24)

`CSet` objects are in the save with the same placed-asset base (`SourcePath` such as `set/set_stagecoach`), so `jad_dump.py --map` and the renders include them. Each set's mesh has one floor
room (`room_wood`, `room_1_carpet`, `room_1_sand`, `room_earth`, `room_1_tile`, `room_5_earth`). Room names per building (from the meshes, drawn by `--rooms`): the stage school's five
(in-game labels "Create Extra", "Create Actor", "Create Director", "Reject" and the striped star-maker pad, confirmed from a screenshot), the gatehouse (staff_fire, hire_janitor, hire_builder),
wardrobe (hall, custom, auto), pre-production (hall, actors, activate, extras, crew, shootit, director), research (fac, fire, set, cos, mov, hall), custom script (create, canit, blank, hall),
script offices (hall, office, fire and horror/comedy/scifi/romdrama/action), bar (mainbar, vipbar), sell, crew, production (review, archive, postproduction, release, finance), catering (vip, main), detox, trailers.
### Rooms in the save matched to the mesh polygons

Every room is an object of the `TMRoom` family (`TMRoom` itself for plain rooms, `CHireRoom`, `CFireRoom`, `CScriptRoom`, `CResearchRoom`, `CCastRoom`, `CReleaseRoom` ... 25 classes, 104 objects in the Quick Start save).
Fields: `RoomName`, `PParentAsset` (object id of the placed facility or set), `MyIndex`, `BIsEnabled`, `SoftObjectLimit` / `MediumObjectLimit` / `HardObjectLimit`, `TheActivity` / `LastActivity`, `PFloorPlan`,
`ObjectsIn`, `BUseIndividualScenes`, `DesireName` (`inroom`). Joined to the mesh (`jad_dump.room_objects`, `match_rooms`, drawn by `--rooms`):

* **By name, exactly:** all 98 rooms of the 19 placed facilities match a mesh part by `RoomName` (equal counts, no leftover polygon, no duplicate names per facility). The six sets each have one generic room `room_set` and
  one polygon (`room_1_carpet`, ...), paired by being the only leftover on each side.
* `MyIndex` is **not** the mesh part order (stage school: index 4 is `room_ss_extras`, which is part 0 in the mesh): match by name.
* `BIsEnabled` is 0 for hallways (`room_*_hall`, `room_hall`), windows (`room_window`, `room_sell_window`), the bar and VIP bar rooms, `room_cso_blank` and the unnamed whole-floor `room_` part: those are plain `TMRoom`s with no
  behaviour class. The working rooms are enabled and have their own class (`CHireRoom` for `room_staff_hire_*` and `room_cf_hire`, `CFireRoom` for every "fire/reject" room, `CStarMakerRoom`, `CCastRoom` for `room_preprod_extras`, ...).
* `HardObjectLimit` is the capacity: 5 for the stage-school create rooms and the gatehouse hire rooms, 10 for the wardrobe's custom room and pre-production's activate and shoot-it rooms, 4 for each research room, 3 for the auto
  wardrobe, 1 for the custom-script, sell and archive rooms, 5 for each script office. Soft and medium limits were 0.
* `TheActivity` names the **AI scene script** run in the room (`ai_room_so_horror`, `ai_room_staff_hire02`, `ai_assigntrailer2.flm`, `rehearsal_set_single001.flm`): these are the `.flm` scene files of `docs/FLM_FORMAT.md`
  (not looked up here). The gatehouse's janitor room runs `ai_room_staff_hire02` and the builder room `..._hire01`. Script offices' `room_so_office` runs the hall script.
* `ObjectsIn` is empty (count 0) in all 104 rooms: nothing is placed in any room in this save.


`tools/fetch_assets.py <save> "<game>/Data/pak"` extracts everything a save needs for rendering (inis, meshes, textures, ground textures; about 2 minutes for this save).

## Where room names and floor text come from (2026-11-24)

**The room list is data, not code.** No table of rooms is in the executable. A facility's rooms are the named parts (`room_*`) of its model, found through the asset's `.ini` (`mesh = ...`); the loader keeps them
as a room table on the mesh (`LH_LoadMeshBinary`, table at mesh + 0x70, 0x90 bytes per entry: 32-byte name + polygon; `FUN_00a14bd0` initialises each part's drawing data). The facility's creation code picks
the behaviour class (`CHireRoom`, `CFireRoom`, ...) from the part name, and the save then stores one `TMRoom`-family object per part, matched by `RoomName` (above).
`python3 tools/list_rooms.py "<game>/Data/pak" "<stringdatabase.lhts[,addon]>" > rooms.md` lists every room in the archives: **93 assets with rooms and 198 room parts**
(the 19 facilities and sets in the Quick Start save, plus ones not in it: cosmetic surgery (`nip_tuck`, `implants`, `liposuctio`), hospital (`hosp_hosp`), post-production, publicity office (`publicity_pr`),
stunt school (`stuntschool_create`, `_fire`), the 4-star script office, trailers 1-5, ~70 more sets).

**The text on the floor is a string-table lookup** (`FUN_00a157b0` draws a room part; `Localize(key)` reads `Data/text/<lang>/stringdatabase.lhts`, read by `tools/lhts.py`):
* the key is the part name, upper-case: `room_ss_actors` -> `ROOM_SS_ACTORS` ("Create"), and if `ROOM_SS_ACTORS_2` exists it is a second line ("Actor"): the "Create / Actor" of the in-game floor;
* parts without a key are drawn with no text: the hallways (`*_hall`), windows (`room_window`, `*_windows`), the unnamed whole-floor `room_`, the set floors (`room_1_carpet`, ...), and a few with no entry
  (`room_hosp_hosp`, `room_stuntschool_create`);
* a part whose name contains `_fire` or `_canit` gets flag 0x80 (`FUN_00a14bd0`) and is drawn from five preloaded strings (`ROOM_FIRE_STAFF` "Fire", `ROOM_FIRE_SCRIPT` "Can It",
  `ROOM_FIRE_WANABE` "Reject", `ROOM_PROD_PR_DONE`, `ROOM_TRAILER_RELAX`) selected at run time (index `DAT_010b93a4`): which one shows presumably depends on what is being held (a wannabe over the stage school's
  `room_ss_fire` reads "Reject"; the same room reads "Fire" in a later screenshot with a different character held, and the gatehouse's fire room reads "Fire"); the selection logic is not traced;
* `room_ss_starmaker`, `room_cso_blank`, `room_prod_release`, `room_preprod_extras/crew` get extra flags (0x4 / 0x100 / 0x400), so their text can be hidden or swapped by state: the star-maker pad is drawn without text in the screenshot even though
  `ROOM_SS_STARMAKER` ("Import") / `_2` ("Star") exist.

`jad_dump.py --rooms --strings <stringdatabase.lhts[,addon]>` draws these texts. The string database is game content: it stays local (the repo only has the reader).

### The 8 KB bitmap is the path mask (2026-11-24)

The beige paved paths between the buildings (and the sidewalks of the city streets) are the set bits of the 256 x 256 bitmap that follows the terrain cells. Evidence: rendering the bits (`jad_dump.py --terrain ... --occupancy`) reproduces
the in-game path network (the spine up the lot, the cross paths, paths round each building and the plaza, the street sidewalk) against screenshots of the Quick Start lot; the sidewalk texture (index 6) has no terrain cell in any save, so
paving is not stored as paint. In the code:

* `Object_SpawnSurfacePatches` (`00980c10`, called when a building is placed, with the reverse on removal) walks the mesh's named tag points (parsed by `tools/msh_dump.py`, key `tags`: header flag byte 2 = count,
  0x50 bytes each after the nodes / skeleton / node names: 32-byte name + 3x3 matrix + translation):
  `_sp_tarmac<W>_<H>` stamps a W x H block of cells (2 units each, extending along the model's +x and +y from the tag, rotated with the asset) with texture index `count - 2` (tarmac); `_sp_grass<W>_<H>` stamps grass (index 1, four passes);
  `_sp_sand<W>_<H>` stamps sand (index 0, four passes) then 0-3 random passes of earth (index 4); `_sp_pavement_0*` calls `FUN_009e1980` at the tag's cell (sets the cell's bit in both bitmaps, `DAT_0105f8d8` (saved) and `DAT_0105f8dc`
  (transient, zeroed when version-2 terrain loads), and fixes up the cell's paint layers); removal clears them (`FUN_009e1ff0`).
  **Checked against the Quick Start saves (both): the tarmac stamps match exactly, 106 of 106 cells (`_sp_tarmac_6_4` customscript, `_sp_tarmac_9_6` 3-star script office, `_sp_tarmac_7_4` production), so the tag position,
  rotation convention and W x H axes are right.** The terrain's tarmac plazas are therefore stamps from those buildings' tags.
  **The pavement tags are not the path network:** 39 tags on the 19 facilities, 7 sets and trailers sit a median of ~5 cells from the nearest saved path cell (random lot points: 2.4), and only 8 have any saved bit in their four corner
  cells. In game they are doorsteps or "work areas" inside the rooms where characters stand (the player's observation; not verified in the code), so they are left out of the path render. Other tag names seen: `_sp_rotate_` (script offices).
* The player's path tool (`terrain_path`, `terrain_pathdelete`, `is_landscaping_path` / `_antipath`, `PIP_PLACING_PATH`) sets and clears the same bits (`FUN_009e1980` with the flag `DAT_0105ef80`, anti-path = clear).
* `FUN_00465650(gx, gy, on)` expands each set cell into the 0.5-unit placement grid, so paths are cells a new building cannot be placed on.

Not checked: what the pavement tags are for (see above), how the sidewalk is drawn at path edges, the meaning of the `DAT_0105f8dc` transient bitmap while the player is painting, the `_sp_grass` / `_sp_sand` stamps (no building in these saves has one).
