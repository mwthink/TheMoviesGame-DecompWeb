# Scripts in the saved game

How a script (the thing written in a script office, then filmed and released) is stored in a `.jad` save. Worked out on
`quick film studios7 April 19600143Tuesday24November2026.jad` (Quick Start, state label `quickstart-script-writin`), which has one **script
still being written**, "Turtles Don't Have Pretty Faces", next to the finished premade "McGun In The Ninetieth Century". Decoder:
[tools/script_dump.py](../tools/script_dump.py) (`python3 tools/script_dump.py save.jad [--project ID]`). Container format and field-tag
hashing: [SAVE_FORMAT.md](SAVE_FORMAT.md). Everything below is *observed in two saves*; guesses are marked *unverified*.

## How to tell a script is in progress

The save has no "writing" flag you can read directly. The combination that identifies it:

* the player's `CStudioPlayer.ProjectList` holds the project, while `BackCatalogue` holds only released ones (here `ProjectList` = project 1580,
  `BackCatalogue` = McGun 1579);
* the `CProject` has no director (`PDirector` 0), no `PMovie`, no `ReleaseDate`, `StarRating` 0, `PSuccess`/`PIncome` 0, and a `CPhaseWriting` exists
  for it (a finished project has no new writing phase data of interest);
* one or more `CStaff` have `PCurrentScript` = the **project** id (not the `CScript` id) and stand in the script office's hall room
  (`InRoomName` `room_so_office`); `CScriptRoom` objects of that facility carry `PProject` = the project;
* every `CShot` of the project is unfilmed (field `a9a63308`, the recorded-footage id, is 0; McGun's is non-zero).

## Object graph (ids from the Turtles project)

```
CStudioPlayer 1006  ProjectList -> CProject 1580
CProject 1580  "Turtles Don't Have Pretty Faces"          genre_comedy
 |- a34de9e2        -> CScript 2648                       the script itself
 |- PCast           -> CCast 2644                          (K6 = 7, cd726d01 = 2) -> list 6bf1cbd8 of CRole 4725, 4726
 |- c9727001        -> list of CShot 2640..2643            the 4 shots of the script, as placed in the project
 |- 83631420 / de52de1f -> CPhaseWriting 2645, CProjectCosts 2647, CEquipment 2646 ...  (phase and cost holders, one per project)
 |- a79b1cf5 (x2)   -> CProjectCrewEffects 2649, 2650      one per writer (GUID = the CStaff GUID, ExperienceGain, name)
 |- PProjectObject  -> CProjectObject 2651                 the project's placeable "script folder" prop (POSITION/angle, PLastBuildingOver 1092)
 |- f1435cdd        -> CRole 2652 "Unfilled Role"          an empty placeholder role (ScriptPartID -1)
 |- 64679902        -> CProjectGraphInfo 2653              income/expenditure series, empty
CScript 2648
 |- c9727001        -> list of ShotDesc.CScript 4728..4731  the script's shot templates
 |- e85c6201        -> list of PartDesc.CScript 4732, 4733  the script's part (role) templates
CStaff 1251 Jonathan Taylor, CStaff 1252 David Wilkinson  PCurrentScript = 1580, in CScriptRoom 2093 (room_so_office)
CFacilityScriptOffice 1092 (facility/facility_script_1star…)  PProject = 1580, ScriptRoomName "comedy"
CScriptRoom 2093  hall (PHall = itself; ObjectsIn = the two writers), PProject 0
CScriptRoom 4573  room_so_comedy, PProject = 1580, BSnapsToIcon 1, no one in it yet
```

Object references in lists are **12-byte entries**: `u32 id, u32 3aba0e00, u32 <type word>` after a `u32 count` (the type word is `b24175aa` for
`CPart`, `0193e13a` for the script's descriptor lists). A single reference is just the `u32` id.

## CScript

| field | value (Turtles) | meaning |
|---|---|---|
| `d78fa569` | UTF-16 `Turtles Don't Have Pretty Faces` | title (same string as `CProject.Title`) |
| `PProject` | 1580 | owner project; library scripts have 0 |
| `POwner` | 0 | |
| `SourceName` | `QMM/1920_a_afighternotalover` | the template the script was generated from: `QMM/<year>_<name>` (McGun: `QMM/1937_S_Clocksquatter*`). *QMM = unverified, probably the quick-movie-maker script library* |
| `PGenre` / `7afb182c` | `genre_comedy` | genre (the second is the same string; *unverified why it is stored twice*) |
| `Quality` | 0.1381 | script quality so far (`MOVIE_QUALITY.md`: the float the movie quality uses as its base). McGun, finished: 0.4518 |
| `4b51dbd5` | 0.2700 | the **computed script quality** of the formula below: reproduced exactly (0.270014) for Turtles. In the finished McGun script it equals `Quality` |
| `c9727001` | 4 x ShotDesc | shot templates |
| `e85c6201` | 2 x PartDesc | part templates |
| `06965231` `d0ee2f5b` `ea9aa210` `b1706501` `7f31b418` | 1, 0, 0, 0, 0 | unknown |

The 195 `CScript`s in the save are mostly the **library** the script office offers (101 are "The Super Human Race" variants with `SourceName`
`script_aliens`, 10 untitled/`addon1_emptystunt`, ...): all have `PProject` 0 and a `Quality` of 0.34-0.6. Only scripts with a `PProject`
belong to a project.

### ShotDesc.CScript: a shot of the script

| field | Turtles 4728 | meaning |
|---|---|---|
| `Set` | 1 | *unverified* (set-count/flag) |
| `967d0e21` | `set_stage` | set the script asks for (the project's shots were then put in `set_schoolcorridor`, see below) |
| `SCENE` | `2menfight`, `shotreactinjury`, `shotfight001`, `convboth` | the scene template; the matching AI/shot file is `010/010_2_men_fight` etc. (`.flm`, see [FLM_FORMAT.md](FLM_FORMAT.md); not looked up) |
| `e85c6201` | 2 | number of part slots in the shot |
| `a85aeec9` (repeated) | 1, 6 | the **script part id** each slot plays (McGun uses 0 = unnamed extra and 4294967295 = none) |
| `sliders` + `9e4c3838` | `sld_action` 0.30, `sld_camera` 0.38 ... | the slider values: u32 length, name, f32 value (`sld_action`, `sld_camera`, `sld_react_injury`, `sld_direction`, `sld_violence`, `sld_duration`, `sld_mood_left`, `sld_mood_right`; McGun: `sld_timebomb`, `sld_mood`, `sld_focus`, `sld_location`, `sld_death_reaction`) |
| `BACKDROP` | `bd_countryside_day.dds` | backdrop |

### PartDesc.CScript: a role of the script

Two fields: `K6` = **script part id** (1 and 6 here; McGun 1, 2, 3) and `32df7069` (0; McGun gives the second role 1, *unverified*, possibly "lead").
The ids are what `ShotDesc.a85aeec9` and `CRole.ScriptPartID` refer to. Part ids are not contiguous (6 follows 1), so they are the script's
own numbering rather than an index.

## CShot: the project's copy of a shot

The `ShotDesc` is the template; each project gets `CShot` objects (ids 2640-2643) that start as copies and become the thing recorded on a set.

| field | value | meaning |
|---|---|---|
| `PProject` | 1580 | |
| `e1f958a0` | `010/010_2_men_fight`, `…_shot_react_injury`, `…_shot_fight_001`, `…_conv_both` | scene file path (`<scene number>/<scene number>_<name>`; all four are scene 010) |
| `27b75b2d` | `set_schoolcorridor` | the set the shot is *to be* filmed on, chosen from the studio's sets (the script itself asked for `set_stage`). `b0a329fb` -> `CSet` 1584 (the owned school-corridor set, `SourcePath set/set_schoolcorridor`) |
| `BackdropName` | `bd_countryside_day.dds` | |
| `sliders` / `9e4c3838` | same as the ShotDesc | |
| `violence`, `realism` | 0.32/0.14, 0, 0.5, ... | per-shot ratings used for the movie (`MOVIE_SUCCESS.md`); values come from the scene + sliders |
| `8131eec2` | 17.175, 11.55, 7.275, 20.75 | shot length in seconds (*unverified unit; McGun's shots 9.9-26.7 s*) |
| `e85c6201` | list of `CPart` | the part slots (8, 5, 2, 9 slots) |
| `d95111f1` (repeated) | `p_cirarette.msh`, `p_soft_pack.msh`, `p_lighter.msh`, `p_book_plain.msh` | the prop meshes the scene uses (spelling `cirarette` is the game's) |
| `829f6f82`, `6ffe8c1c` | 3, 7, 0, 7 | number of props (matches the `d95111f1` count) |
| `a9a63308` | 0 | recorded footage id. 0 = **not filmed** (McGun's shots hold ids) |
| `a2a53aac`, `7b0b9e25` | 0 | the dates the shot was filmed (set for McGun, 0 here) |
| `ea537bf1`, `01547bf1` | 22 / `hair` in shot 2642 only | a string `hair` (*unverified*, maybe a set-up note) |

### CPart: a slot in a shot

`Index` (slot number in the shot), `Required` (1 = the slot must be cast; here only the two named roles), `Allowed` (always 1), `PRole`
(the `CRole` filling it, 0 for an extra slot), `PCostume` / `PCostumeFromPriorScene` (a `CCostume` object), `RecommendedCos` (costume name the
script recommends: `costume_plain`, `costume_teen`, `costume_hor_zombie`), `PExplicitCostume`, `StuntRisk`, `Dirty`, `32df7069` (2 for all; *unverified*).
The five/eight extra slots per shot (`costume_teen`, `costume_hor_zombie`) are the background cast the scene wants. The `CCostume` objects
(4896...) have **no fields** in the save: the real costume is chosen at cast time.

The same two roles appear in shots 2640, 2642 and 2643 (parts 4701/4702, 4714/4715, 4716/4717) and the second in 2641 (part 4709), exactly as the
`ShotDesc` part ids say: part id 1 = **Vince Andetti**, part id 6 = **Mort Germain**.

### CRole and CCast

`CRole.name` is UTF-16, `IsGeneratedName` 1 (the name is generated for the script, not typed by the player), `ScriptPartID` links to the
`PartDesc`, `PActor` = 0 until an actor is cast, `PCostume` the costume object. The project's `CCast` holds the two roles (list `6bf1cbd8`); a
third `CRole` 2652 "Unfilled Role" (`ScriptPartID` -1) hangs off `CProject.f1435cdd`. *`fceacfa3`/`51dd01e0` on CRole: 0/1 and 0/0 for the named roles,
2/4 for the placeholder: unknown.*

## Writers and the room

* Jonathan Taylor (`CStaff` 1251, GUID 1237) and David Wilkinson (1252, GUID 1241) are the script-office writers, hired 701657/701658 (day count),
  both `PCurrentScript` = 1580. Each has a `CProjectCrewEffects` on the project (`GUID`, `ExperienceGain` about 0.007, `name`).
* They stand in `CScriptRoom` 2093, `RoomName room_so_office`, `TheActivity ai_room_so_hall` (the hall script, `docs/SAVE_FORMAT.md`), `InRoomIdx` 4 and 0.
* `CFacilityScriptOffice` 1092 is the **one-star** office (`SourcePath facility/facility_script_1star…`), `ScriptRoomName comedy`, `PProject` 1580.
  Its genre room `CScriptRoom` 4573 (`room_so_comedy`, `TheActivity ai_room_so_comedy`, `PGenre genre_comedy`, `Quality` 0.2) has `PProject` 1580
  and `HardObjectLimit` 0; the hall room has limits 5/5/5.
* The only quality number tied to the room is `CScriptRoom.Quality` = 0.2.

## CProjectCosts, CPhaseWriting

* `CProjectCosts` 2647: `Director` -> a `CCostItem` (empty), `ActorList` / `CrewList` / `EquipmentList` / `SetList` all empty, `InitialCostCharged` 1,
  `CustomScriptwritingCharged` 0, `CustomScriptAmountChargedSoFar` (8 bytes; the first four read as f32 give 20378, *unverified* as money), `TotalSpent*` 0.
* `CPhaseWriting` 2645: `PProject` and one unknown value `e027bcab` = 2.
* `CEquipment` 2646: the project's tech list (`Techs[x]`: `camera_motorised`, `rig_crane`, `sound_mono`, `filmsize_16mm`, `filmstock_handcoloured`), i.e. the
  technology selected for the movie: set already, before writing is done.

## Dates

Project dates (`4048aa50` 715448, `cecd8e39` 715748, `ReleaseDate` 714584 for McGun, `Hired` 701657) are f32 day counts. Read as proleptic
day ordinals they land in 1957-1960 (for example 715448 = 1959-10-31), but the save was taken on 7 April 1960, so either the epoch or the
meaning of these fields (creation dates versus "last updated") is *not yet pinned down*.

## Script quality (formula traced from MoviesSE.exe)

`FUN_004c3ae0(capFlag)` (`0x004c3ae0`, called from the script editor `FUN_00610190` and elsewhere) recomputes the script's quality (float at +0x128) as a
**clamped running sum**; weights and limits come from `scriptquality.ini` (loaded by `FUN_004c99a0`, defaults in brackets are used only if a key is missing):

```
q = 0
q += clamp01( sum(shot.runtime * 0.1) / max_length )            * max_length_weight         # runtime = [scene ini] runtime (frames?), summed over shots
q += clamp01( max(roles of the largest scene, cast size) / min_required_roles ) * min_required_roles_weight
q += clamp01( set_changes / max_set_changes )                   * max_set_changes_weight    # consecutive shots on different sets
q += clamp01( costume_changes / max_costume_changes )           * max_costume_changes_weight   # FUN_005b77a0, per cast slot across shots
q += clamp01( extras_in_cast / max_extras )                     * max_extras_weight
q += clamp01( mean_shots( scene_quality * scene_repeat_factor ^ earlier_uses_of_the_same_scene ) ) * scene_quality_weight
q += clamp01( mean_shots( set_quality ) )                       * set_quality_weight
q += clamp01( shots / num_scenes )                              * num_scenes_weight
q += clamp01( lead_roles / max_lead_roles )                     * max_lead_roles_weight     # CastSlot role type 1, 2 or 3
q += clamp01( nonlead_roles / max_nonlead_roles )               * max_nonlead_roles_weight  # role type 0
(each addition is clamped to 0..1)
if shots == 1: q *= one_shot_factor;  if shots == 2: q *= two_shot_factor;  if shots == 0: q = 0
if capFlag: q = min(q, cap) with cap 0.8 if facility_script_4star, else 0.6 (3star), 0.4 (2star), else 0.2   # as decompiled; not used in the numbers below
```

Inputs: `scene quality` = `[level] quality` and runtime = `runtime` of the shot's scene ini (`data\scene\010\010_2_men_fight.ini` ... in `meshscene0000.pak`),
`set quality` = `quality` of the set ini (`set_schoolcorridor` 0.35, `set_bridgetz1` 0.7, `set_stage` 0.05), role types = `CRole.51dd01e0` (0 nonlead, 1 hero; matches
`roletype` in the template ini). The `scriptquality.ini` weights sum to 1.25, so the clamp matters for good scripts.

[tools/script_quality.py](../tools/script_quality.py) (`python3 tools/script_quality.py save.jad "<game>/Data/pak"`) evaluates this with no tuning and prints every term.

**Turtles** (4 shots, 2 roles): length 0.0031 + scene quality 0.0544 + set quality 0.0525 + num scenes 0.1067 + lead 0.0333 + nonlead 0.0200 = **0.270014**, equal to the
saved field `4b51dbd5` (0.270014) to six digits. The saved `Quality` is 0.138102 and is **not** explained (see below).

**McGun** (6 shots, 3 roles): the formula gives 0.442431, the saved `Quality` and `4b51dbd5` are both 0.451806. **It does not match**: the difference is +0.009375,
which is exactly the repeat penalty on the second `time_bomb` shot (`0.75 * 0.5 / 6 * 0.15`). The decompiled code applies `scene_repeat_factor` when the same scene-state pointer was seen
earlier; the save is consistent with the two `time_bomb` shots *not* counting as the same scene (e.g. separate scene-state objects per shot), but that is a hypothesis
and the tool still applies the penalty as decompiled. Also not computed: costume changes (assumed 0).

## What changed between the two Quick Start saves

`quick film studios22 January 1960…jad` (state `QUICKSTART`) has only McGun. Object counts, 22 January -> 7 April: `CProject` 1 -> 2,
`CScript` 193 -> 195, `CShot` 6 -> 10, `CPart` 23 -> 47, `CRole` 63 -> 66 (two named roles + the "Unfilled Role"), `CCast` 40 -> 41, `CCostume` 102 -> 119,
`CProjectCrewEffects` 6 -> 8 (one per writer), `CProjectObject` 0 -> 1, `ShotDesc` 756 -> 763, `PartDesc` 974 -> 983. The Turtles script accounts for 4 ShotDesc and
2 PartDesc; the remaining +3/+7 are *unexplained* (the library holds hundreds of these, so one more library script and shifted ids are likely). Also the two
writers' `PCurrentScript`, and `PProject` on the one-star script office and its comedy room.

## Open questions

* Why the in-progress script's saved `Quality` (0.138102) is not the computed value (0.270014). The ratio is 0.5115; the finished McGun script has `Quality` = the computed value.
  Not traced (candidates: a writing-progress scaling by the writers, `CProject_ComputeScriptWritingDuration`; the script-office cap).
* Why McGun is off by the repeat penalty (above), and the costume-change term.
* Whether the script's **text** (dialogue, narrative) exists anywhere in the save. It does not seem to: scripts are scene/part templates
  (`SCENE`, `SourceName`), and the dialogue lives in the scene files (`010_conv_both`, ...), not in the `.jad`.
* The meaning of the unnamed fields marked above, and of the 12-byte reference's two type words (they look like type hashes of the list and element types).
