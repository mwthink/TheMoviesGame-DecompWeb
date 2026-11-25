# Engine and class notes

Notes on classes met while naming functions: save variables, the engine scene object, the UI windows and Flash layer, reviews, sets and shots, the game clock, shared utilities. Less polished than the system documents; each section says what it was read from. Section labels (3k, 3aa, ...) are stable identifiers that other documents and code comments cite; they are not a reading order.

## 3ag. CProject save variables (`CProject_RegisterSaveVariables` 0x5BB460)
The serializer works on the saveable sub-object at project+0x64, so the CProject offsets below are listed offset + 0x64 (checked against known fields: StarRating +0x170, hype +0x368, marketing PI +0x36c).

| Field | CProject offset |
|---|---|
| StarRating | +0x170 |
| Title | +0x25c |
| PDirector | +0x1b4 |
| PScriptOffice | +0x2e8 |
| ReleaseDate | +0x288 |
| StartDate | +0x2c8 |
| PCast | +0x1e4 |
| PPhase | +0x214 |
| PEquipment | +0x244 |
| PShoot | +0x8c |
| PCosts | +0x22c |
| SnapGenreBoredom | +0x10c |
| PScript | +0x1cc |
| ProjectID | +0x174 |
| GUID | +0x194 |
| WrapDate | +0x290 |
| PMovie | +0x158 |
| PQualityPreProduction | +0x334 |
| TicksInPreProd | +0x35c |
| Quality | +0x360 |
| PSuccess | +0x374 |
| PIncome | +0x38c |
| PublicInterestPR (hype) | +0x368 |
| PublicInterestMarketing | +0x36c |
| MarketingSpendLevel | +0x370 |
| JourneyType | +0x3a4 |
| CrewNeeded | +0x300 |
| PGenreSeed | +0x198 |
| ExplicitGenreSeed | +0x1b0 |
| SuperStarQualityBoost | +0x40d |
| SuperDirectorQualityBoost | +0x40e |
| PreProdFactor | +0x2c4 |
| EstimatedCompletionDate | +0x28c |
| BSuspended | +0x364 |
| PLegacy | +0x31c |
| PGraphInfo | +0x410 |
| PLeagueTableEntry | +0x304 |

Also saved as arrays: Shots, Credits, CrewPoolList, PQualityShots, WritersExperienceGain, CrewExperienceGain, ImportantStaffGains. `SuperStarQualityBoost` / `SuperDirectorQualityBoost` are saved byte flags (`AWARDS.md` 3s), which means the +0.04 award boost is persistent per project, not recomputed from the cast at release time. `PublicInterestMarketing` is the stored marketing public-interest (D) value from `MOVIE_SUCCESS.md` 3v.

Project phase object (+0x228): `CProject_OnEvent` switches the current phase by event id (0x80000a7f -> phase 3, 0xaa7 -> 4, 0xacf -> 5, 0xaf7 -> 6, 0xb1f -> 7 = release screen) using the phase's virtual `GetId` (slot +0x24); `CProject_InitCastListAndStartWriting` creates the writing phase (`CPhaseWriting_Create`).

## 3ah. MV::Object (engine scene object) layout
MV::Object is the renderable scene object, not game logic. Fields seen (byte offsets): world matrix 3x4 (12 floats) at +0x18, position +0x3c, scale +0x7c, rotation about Z +0x80, mesh-instance list +0x8c (each node holds a `MeshInstance` with texture table), links: incoming +0x84 / outgoing +0x88 (typed link nodes, refcounted), flags +0x9c (bit 0x20000000: name starts "fac_"/"set_"; bit 0x800000: mesh tag `[isdrawinlist2notlist1]`; bit 0x80000 blocking flag; bits 0x4000/0x8000 screen-side culling), fade alpha byte +0x9a, per-submesh colour array +0xf0 (16 bytes each, default 0xFFB2DFFC; bit 0 = highlighted), template object +0xf4, extra data +0x100 (0x10 bytes; used for light/bone data), allocation from a 64-slot-per-block pool (`ObjectPool_Alloc`).
Names given: Object_Set/GetTransform*, Object_SetMesh, Object_SetSubMeshColor/Highlight/Texture, Object_Link/Unlink/TransferLinks, Object_RenderWithFade, Object_UpdateLodAndCullFlags (distance LOD bands set flag bits 0x10000-0x40000 on each mesh instance). None of this affects the success model; it matters for a renderer port.

More MV::Object notes: `Object_ReadMeshTags` reads the mesh tag `[isdrawinlist2notlist1]` and a `scaling` value (+0xcc) from the mesh's text tags; `Object_SpawnSurfacePatches` expands mesh nodes named `_sp_pavement_0`, `_sp_tarmac W H`, `_sp_grass W H`, `_sp_sand W H` into 2-unit-spaced ground tiles/decals; `Object_PlayLipSync` loads `Data\Audio\LipsSync\<sound>.lps` for dialogue; `Object_UpdateAmbientSound` plays the ambient sound for meshes named `set_`/`fac_`/`blp_`; `Object_FindNamedNodeMatrix` looks up a named node transform in the mesh (0x50-byte records, matrix at +0x20).

## 3ai. Save-game format (MVSaveable) and TMRoom
**Save mechanics.** One global mode word (`DAT_010583e0`): 0 = writing, 1 = reading. All `SLVAR_*` helpers branch on it: `SLVAR_Raw(ptr, size)`, `SLVAR_String`, `SLVAR_WString`, `SLVAR_Float`, `SLVAR_Array`. Each saved field begins with `Saveable_BeginVariable("Name")`: when writing it emits a 3-byte marker (0x0A 0x23 0x58 as stored) followed by a 4-byte hash of the name (`Saveable_HashVariableName`), then the data; when reading it checks the hash at the expected stream position and, if it does not match, logs "failed to locate variable '<name>' at expected position in save game. Will try to scan ahead" and scans forward (so saves tolerate added/removed fields). Strings are saved as 4-byte length + bytes; wide strings as (len*2+2) bytes. The write buffer is a growable array (`SaveBuffer_Append`, grows in 0x2000 steps). Pointers are saved as object ids (`Save_LookupIdFromAddress`); unresolved ones are processed afterwards (`Save_ProcessDeferredPointers`). Objects are written by `*_Serialize` functions (e.g. `CProject_Serialize`, `CStar_Serialize`, `TMRoom_Serialize`): header (class name string), pointer-map entry, object id, virtual save body, footer.

**TMRoom** (`TMRoom.cpp`) save variables (offsets as passed, sub-object base): PFloorPlan, BUseIndividualScenes, SoftObjectLimit / MediumObjectLimit / HardObjectLimit (+0x174/+0x178/+0x17c), IconName, RoomName, DesireName, TheActivity, LastActivity, MyIndex, PParentAsset, BIsEnabled, BSnapsToIcon, SL_CurNum_Display / SL_MaxNum_Display / SL_Display_Numbers, and an `ObjectsIn` array (the occupants). A room loads an interaction scene `data/scene/interactions/ai_<roomname>.flm` (`TMRoom_LoadInteractionScene`), tracks occupants in a 0x18-byte-stride vector (+0xf8), limits them by `TMRoom_SetMaxOccupants`, and shows selection state through submesh highlight colours (`TMRoom_SetHighlight*`).

## 3aj. WWindow (UI) and LSWF (Flash UI) notes
**WWindow** is the UI window class. Layout: four anchors (left +0xa0..0xc0, top +0x7c..0x9c, right +0xe8..0x108, bottom +0xc4..0xe4), each an anchor type (0 proportional fraction of the parent extent, 1 offset from the start edge, 2 offset from the end edge, as read by `WWindow_ResolveAnchor`) plus a reference window and value; `WWindow_RecomputeLayout` re-resolves them and iterates up to 500 times until stable; children are in a list at +0x124 with parent pointer at +0x118. Events: `WWindowEvent_GetName` gives the 14 event kinds (0 MOUSELCLICK, 1 MOUSEMCLICK, 2 MOUSERCLICK, 3 MOUSELDOWN, 4 MOUSELREPEAT, 5 MOUSEOVER, 6 MOUSEHOVER, 7 DRAGGED, 8 DESTROYED, 9 CONTENTCHANGED, 10 APPLIED, 11 FIRSTOPENED, 12 MOUSEWHEELUP, 13 MOUSEWHEELDOWN); `WWindow_SetEventHandler(kind, handler, param, soundName)` stores a handler and an optional sound id `<soundName>_<EVENT>`; `WWindow_ProcessInput` dispatches mouse events (button 0x73, 0x74, 0x75 = left, middle, right). Other helpers: `WWindow_SetTooltipText` (+0x2d8), `WWindow_SetSkin` (+0x2d4), `WWindow_ClampToScreen`, `WWindow_UpdateSparkleEffect` (particle sparkle highlight).

**LSWF** (Flash-based UI renderer): `LSWFShape_ParseDefineShape` reads SWF DefineShape data, `LSWFShape_ComputeBounds` / `HitTest` / `TransformVertices` are the geometry helpers. Most other LSWFShape entries in the list are STL map/tree node helpers (red-black tree insert/rotate/alloc for std::map/set) and are not worth naming.

Open note: tags like 0x4C7B40 (copy constructor with a saveable sub-object at +0x38) and the small getters/setters across these classes remain unnamed.

## 3ak. CMovieReview
`CMovieReview_Create(project, populate)` builds a review object (0x160 bytes) for a project (+0xec); `CMovieReview_Populate` fills title/genre/director/cast names (+0xf0/+0x110/+0x130/+0x150) and calls `CBasicReview_SelectComments` with the project's boosted quality; `CMovieReview_GenerateAllComments` (0x484930) runs about 50 comment generators in order (movie quality, script quality, lead-actor trait comments, genre-fit comments, crew quality, star power, boredom, success-vs-quality, trendsetter award check, most-popular-genre change, studio quality A/B), skipping a few when a tutorial-style global (DAT_0104a974+0x80) is non-zero.
Comment kinds used by the generators in this pass (id passed to `CMovieReview_AddComment(review, score, id, text, flag, 3)`): 13 lead with the highest trait for the genre (threshold in a global table), 14 lead with the lowest trait, 15 lead with the largest gap between genre-average trait and own trait, 16 best genre-fit lead, 17 worst genre-fit lead (fit = `ComputeFitScoreWithPerfectFit_A`), 25 crew quality (mean of `CQualityRating_GetNormalizedCrew`), 33 star power, 37 boredom (score 1 - boredom), 62 studio quality (era-leniency scaled, `MOVIE_SUCCESS.md` 3o). Comment text is a phrase book (`<phrasebook><phrase key=starname>..</phrase><phrase key=studioname>..<phrase key=moviename>..`) resolved from the translation tables; the lead-actor comments only fire for stars (`CStar`) in lead roles (`CastSlot_IsLeadRole`) and only once the project is past phase 3.
`CMovieReview_IsQualityAboveBuzz` = (marketing PI + capped hype, clamped 0-1) < boosted quality, i.e. "better than its marketing" flag. Save variables: MovieName, GenreName, DirectorName, CastNames[], PAssociatedProject.

## 3al. CSet, TMMobile, ShootController ("CShot")
**CSet (shooting sets)**: `CSet_LoadDefinition` (0x4D2D10, extends `CAsset_LoadDefinition`) reads from the set's definition: `boredom` (+0x604), `quality` (+0x564, clamped 0-1, default 1.0), `backdrop` (+0x568, "0" means none, ".dds" appended), `parallax`, `rear_projection`, `scene`/`setid` (+0x5d8; scene variants are enumerated from `data/scene/<setid>*`, `CSet_CountSceneVariants`), per-genre values (one float per genre key, only stored if >= 0; `priority1` = primary genre, default genre_action). Set boredom is tracked per set name in a global DecayValue table (DAT_0104ad74): `CAssetSet_GetBoredom` / `CAssetSet_GetBoredomByName` read it clamped 0-1. `CSet_FindOrCreateByName` finds a set by id in the global list or loads `data/<name>.ini`. Save variables: LastUsed, BackdropName, IndexLightMapTrailer, Hidden, WasHidden, PBusyShot, Busy, BusyDate. `Script_PickRandomPremadeScript(category)` picks a random script from `scripts/{BMovie,BlockBuster,Family,Boundary,connoisuer}` (categories 1-5).
Open question for the success model: set `quality` (+0x564) and set boredom could feed the project's quality/boredom components; confirm with the quality tracer before assuming.

**TMMobile** = a character/object the player can pick up and drop: `TMMobile_BeginDrag` (removes it from its room, plays `PICKUP_<name>`), `UpdateDragMotion`/`UpdateHoverBob` (sine bob while held), `CanDropHere` (checks room/explainer rules), `EndDrag`, `SetOwnerAssetAndRoom`, `PostPlaceEvent` (`PLACE_<name>;<room>`), `PostInHandDeleteEvent` (`UI_INHAND_OBJECT_DELETE`). Save variables: LastPosition, LastAngle, PInBuilding, PInRoom, InRoomName, InRoomIdx, BPlaceAnywhere.

**ShootController** (the `CShot` rows): state at +0x1c0: 0 idle, 1 take preparing (`ShootController_BeginTake`: assigns a set via `CSet_AssignShootController`, records start time), 3 stunt in progress, 4 finished (`ShootController_FinishTake` -> `ShootController_EndTake`). `ShootController_StartTake` (0x4EB540) validates the set, starts the stunt when the shot has a stunt weight and rolls the outcome (`ShootController_RollStuntOutcome`) once the animation scene reports done. `ShootController_ApplyActorExperience`: for each shot role, stuntman roles with stunt weight > 0 get stunt experience scaled by the stunt difficulty (`CStaff_AddStuntExperience`), everyone else (and the director) get genre experience (`CStaff_AddGenreExperience`). `ShootController_FindCompatibleSet` finds another idle set with the same scene and asset name when the assigned set is busy. A tutorial global (DAT_0104a974+0x6c) forces instant takes.

## 3an. Unclassified functions: where to work next
Analysis in `docs/generated/unclassified_analysis.md/.csv` (tool: `tools/classify_unclassified.py`). Of the 2,904 unnamed, unclassified steady-gameplay functions: 840 sit between known engine-library source markers (PK*/Coda audio, disk, thread, allocator libraries), ~800 more are in the CRT/STL/zlib band 0xBB0000-0xC6FFFF, ~120 are engine mesh/scene code (0x97xxxx-0xA5xxxx); only ~125 have a game-class guess from their neighbours. The best targets are the shared helpers that named gameplay code calls most:
- **GameTime helpers, 0x43B490-0x43B9xx** (about 25 functions): `0x43B520` builds a time from days (x constant 0xD18F74), `0x43B710` converts back (x 0xD18F78), `0x43B5E0` add, `0x43B620` subtract, `0x43B600/0x43B660/0x43B6A0/0x43B6C0` comparisons, `0x43B510` zero time, `0x43B970` days as float. Called by award, project, staff, star, AI and asset code (fan-in 3-12 each).
- `0x9B5030` = localisation lookup (string table key -> wide string), `0x990AE0` = millisecond timer (QueryPerformanceCounter), `0x990970` = SLVAR pointer save, `0x990D30` = random int in range, `0xACE9B0` = CRT pow, `0x97E350` = MV::Object mesh-instance getter.
- About 45 unnamed `CMovieReview` comment generators (0x47A800-0x47F850, called from `CMovieReview_GenerateAllComments`): they decide which review texts appear, so naming them completes section 3ak.

## 3ao. GameTime / Timer / GameClock cluster (0x43B490-0x43B9C0)
- **Time is a single float counted in days.** `Time_FromYears(y)` = y * 365 (global 0xD18F74 = 365.0), `Time_ToYears` = days * 0xD18F78 (1/365). `Time_FromYearsPlusDays(y, d)` = y*365 + d. Arithmetic is plain float: `Time_AddInPlace`, `Time_SubInPlace`, `Time_Plus`, `Time_Minus` (out-parameter forms) and the comparisons `Time_Equals`, `Time_NotEquals`, `Time_IsGreaterThan` (this > other), `Time_IsGreaterOrEqual`, `Time_IsLessThan`, `Time_IsLessOrEqual`. `Time_SetZero` clears. A date such as 1 Jan 1950 is therefore about 1950 * 365 days; the float at global 0xE4FA4C is used throughout as a reference time ("now" in many call sites; its static initial value is 693500.0 = 1900 * 365) - confirm at runtime before treating it as the current date.
- **Timer** (16 bytes: interval, last, counter, mode): `Timer_IsElapsed` returns true when the interval has passed in real-time ticks (`DAT_0104CDF4+0x3c`, milliseconds) or, in counter mode, after the given number of calls; `Timer_Init(mode)`, `Timer_FillCounter`, `Timer_GetIntervalTimes100`.
- **GameClock** (the in-game date driver): `GameClock_Update` advances the clock by one tick (`GameClock_AdvanceTick`: adds 1/ticksPerDay of a day and reports when the whole-day part rolls over); on rollover the weekday advances `(w+1) % 7`, then `GameClock_UpdateTicksPerDay` recomputes the pace (+0x14, ticks per day) from the current year: constants 0xE4FA38 = 4, 0xE4FA3C = 20, 0xE4FA40 = 1900, 0xE4FA44 = 1960, 0xE4FA48 = 0.05776, exponential between 1900 and 1960 and constant after 1960. The exact meaning of the pace curve (whether 4-20 ticks/day get faster or slower with the years) is unverified; read the sign of the exponent before relying on it. `GameClock_GetTicksPerYear` = pace * 365. `g_GameClockAltMode` (0xF87D90) switches `GameClock_Update` to a second counter pair (`SetAltMode` / `ClearAltMode` / `IsAltMode`).
- Small math helpers in the same block: `Math_Exp` (e^x via f2xm1/fscale), `Math_Floor` (forward to a CRT routine, assumed floor), `Math_RoundToInt64_A/B` (thin CRT_RoundToInt64 wrappers).

## 3ap. Shared utilities and the review comment kinds
**Utilities named**: `Localize(key)` (0x9B5030, string-table lookup, returns the key itself when missing), `PhraseTable_Lookup(key, index|-1 random, filter list)` and `PhraseTable_LookupWithFilter`, `Localize_PickRandomText`, `Timer_GetMilliseconds` (QueryPerformanceCounter based), `Random_IntInRange(min, max)` (min inclusive, max exclusive; `Random_NextUint` is the raw generator), `SLVAR_Pointer` (save/load a tracked pointer), `Object_GetMesh(i)` (follows the template chain), `Mesh_LoadCached` / `Mesh_Release` (refcounted mesh cache), `Object_RemoveFromScene`, `CRT_Pow`, `String_Find`, `String_ToInt`, `String_ToWide`, `String_CopyFromCStr`, `StringVector_PushBack`, `StatCategoryMap_Find`, `Character_CreateByNamePrefix` (creates a star for names starting F/G/M, otherwise a plain character), `NameList_FindOrAddIndex`, `NamePairRegistry_Register`.

**Review comment kinds** (`CMovieReview_AddComment(review, score, kind, text, flag, 3)`; the kind is passed as an int in a float slot, so Ghidra shows tiny denormals such as 4.2039e-45 = 3). The text of a kind comes from a tier table at 0x1049228 (stride 0x48 per kind) via `CMovieReview_BuildTierText`, and thresholds from per-kind globals (0x10493xx..). All generators run from `CMovieReview_GenerateAllComments` and are named `CMovieReview_AddKindNN_<what>`:

| Kind | What it comments on |
|---|---|
| 3, 4, 5, 6 | lead actor performance (mean performance of the best/worst lead, four variants) |
| 7 | (not yet identified) |
| 8 | director performance |
| 9 / 10 | lead mood below / above the effective lower / upper mood threshold |
| 11 / 12 | director mood below / above the thresholds |
| 13, 14, 15, 16, 17 | lead trait comments and best / worst genre fit (section 3ak) |
| 18 | star relationship (`CQualityRating_GetNormalizedStarRelationship`) |
| 19-22 | lead vs director relationship (four variants) |
| 23, 24 | set condition (`CQualityRating_GetNormalizedSetCondition`) |
| 25 | crew quality |
| 27-32 | marketing buzz (capped hype + marketing public interest) vs quality, with and without the publicity office (`facility_publicity_office`) |
| 33 | star power |
| 34, 35 | lead cast |
| 37 | boredom (1 - boredom) |
| 38, 41 | (not yet identified) |
| 40 | cast boredom term (`CProjectSuccess_GetCastBoredomTerm`) |
| 42 | genre |
| 44 | research facility present (`facility_research`), shown for player projects |
| 46 | tech factor (`CProjectSuccess_GetTechFactor`) |
| 48 | genre popularity (`Release_GetNormalizedGenrePopularity`) |
| 50 | other-studio project |
| 62 | studio quality |
| 64 | stunt double likeness (`QualityCalc_ComputeLikeness`) |
| 65, 66 | stunt weight of a stunt double's role |
| 67, 68 | stunt difficulty (`StuntState_GetDifficulty`) |

Not decoded here: the per-kind threshold values and tier texts; dump the 0x1049228 table and the 0x10493xx globals from the exe to pin each comment's trigger score.

## 3aq. CStaff (Staff.cpp) save variables and lifecycle
`CStaff_RegisterSaveVariables` (0x5823F0) lists what a staff member persists (offsets in CStaff): NeedForSmallTalk +0x954; **Birth +0x7e8, Retirement +0x768, Death +0x7ec, Hired +0x7f4** (all game-time floats, section 3ao); PEmployer +0x8a8 (the studio, also set by `CStaff_SetOwnerStudio` at +0x934), PBoss +0x994, PSubFacility +0x8c0, PStaffCosts +0x7d0 (per-person salary costs), PCurrentGear +0x890, PAssistantData +0x72c, CV[] (list of previous projects, +0x6fc, 0x18-byte entries), CurrentTask +0x79c, LastTask +0x7a0, BTemporaryTask +0x7a4, PExperience +0x8e0, PCurrentScript +0x8f8, PLastWorkingProject +0x858, SpawnType +0x764, AmLeaving +0x6b4, InjuryDescription +0x914, and **stunt record counters**: `Count{One..Five}BarStuntsTried` (+0x774..+0x784) and `Count{One..Five}BarStuntsSucceeded` (+0x788..+0x798). The per-difficulty tried/succeeded counts are the data behind stunt outcome/experience (`STUNT_SYSTEM.md`); the tracker could log them per stuntman.
Lifecycle: `CStaff_OnHired` creates the resident desires (smalltalk, buy food, be impressed, dispose of litter, prop interact, get autograph, unfulfilled, stay by base, update costume for non-players, gawp, crap), stamps Hired = now and plays `ai_hired.flm`; `CStaff_SetOwnerStudio` switches employer (cancelling a running "leave" activity and updating the salary-cost object); `CStaff_UpdateAging` runs the career-end timer: it computes a target time (`CStaff_UpdateAvailableUntil` keeps the float at +0x7e0 no later than the time at +0x860 plus 75 years), compares `Time_ToYears` of the remaining time against small thresholds (constants 0xD1658C, 0xD1855C, 0xD16B78), sets one-shot flags at +0x844/+0x845/+0x846 and notifies the player for their own stars. Which of +0x7e0 / +0x860 correspond to the saved Retirement/Birth/Death fields has not been confirmed. `CStaff_OnLeaveWorld` unlinks the person from the employer lists. `CStaff_ComputeProjectEndTime` = current time + 0.01 years (project in phase 6) or the project's end + 0.02 years.

## 3ar. TMCharacter (TMCharacter.cpp) leftovers
**Save variables** (`TMCharacter_RegisterSaveVariables` 0x59D8D0, offsets in TMCharacter): Patience +0x408, Suspended +0x4b8, Gender +0x428 (int), Name +0x450, VoiceID +0x42c, PCurrentCostume +0x4f0, PDesiredCostume +0x4f4, PNormalCostume +0x4f8, FingerPrint +0x5e4, Corpsing +0x6ad, `MyDesireMap.Values` (desire name -> float, a map at +0x64c), then TMMobile's variables (LastPosition etc., section 3al).
**Actions and desires**: a character keeps a list of actions (+0x4f8, entries are `CActivity` objects) plus a "primary" action pointer at +0x49c and a list of resident desires (+0x53c). `TMCharacter_TryReplaceActionWithBetterDesire` re-checks every 10-30 seconds and, when a more urgent desire exists, cancels the running action with the note "Found a better way to do desire". Helpers: `TMCharacter_GetActionDesireUrgency` (0 for temporary actions), `Action_CompareUrgencyGreaterOrEqual` (sort predicate), `ActionList_SortByPredicate/IsSorted`, `DesireList_*`, `TMCharacter_FindActionByNameFragment` / `HasActionNamed` (substring match on the activity name), `TMCharacter_SetPrimaryAction(name)`, `TMCharacter_RemoveActionAndDesireNamed`, `TMCharacter_CancelGetJobAction`, `TMCharacter_ClearAllActions`, `TMCharacter_UpdateAllDesires`.
**Pickup (player drag)**: `TMCharacter_BeginPlayerPickup` starts the drag (effect `PICK_UP_PLAYER_EFFECT`, sound `PICKUP_INITIAL_MALE_` / `FEMALE_` + voice id), `TMCharacter_SnapToDragTarget`, `TMCharacter_ReleasePickup`.
**Other**: `TMCharacter_GetMoveSpeedForState` (speed table at DAT_00F87EF8, indexed per movement state, scaled by +0x4a8), `Character_AttachJobProp` (camera for job 7 cameraman, "sound boom" for job 8 soundman, "fluffchair" for job 12 clapperman), `TMCharacter_ApplyCostumeToModel`, `TMCharacter_LoadIdleAnimation` (default `ai_1char_idle.flm`), `TMCharacter_GetHeadPosition`.
