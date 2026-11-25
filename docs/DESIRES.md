# Desires, explainers and where people go

What makes an idle person walk somewhere: a **desire** grows until it wins, an **explainer** (the prop's description of what it offers) is chosen by cost, and the activity walks the person to the
prop's goal point (`MOVEMENT.md`, "Getting from A to B"). Evidence labels as in `CLAUDE.md`. Addresses are in `tools/ghidra_names.csv`. The web port is `web/src/sim/ai/` (below).

## Desires

**The table** [data]. `data\rule\desires.csv` (read by `FUN_008386B0`, with the global tuning in `data\desires.ini`: `AdaptiveDesires`, `MaxDesireInterval`, `AdaptiveMultiplier`,
`InitialDespRate`, `MaxDespRate`, the tantrum and get-job values) has one row per desire: `name, fixeddesire, maxdesire, increment, fixedurgency, iconfirst, iconlast, grudgevalue,
grudgerecover, desperationscene, facial`. The loader stores them in a per-desire parameter block (cap at `+0x20`, the fixed desire at `+0x24`, the fixed urgency at `+0x28`, the increment at
`+0x2C`; the two icon numbers, `-1` when empty). Desires with a `fixeddesire` (`readyposition`, `approach`, `arrest`, ...) hold a constant level; desires with a `maxdesire` and an `increment`
(`crap_male`, `crap_female`, `buyfood`, `gawp`, `propinteract`, `getdrunk`, `overeat`, ...) grow.

**The object** [read]. Each desire class (`DesireCrap`, `DesireBuyFood`, `DesireGawp`, `DesireStayByBase`, `DesirePropInteract`, ... constructors in `00833xxx`-`0084xxxx`) derives from a base
(`FUN_008433B0`) and names its action in the constructor (`crap_male` or `crap_female` by the character's sex, `buyfood`, `gawp`, `staybybase`) through `FUN_00838070`, which also finds its
parameter row. The current level is the float at `+0xE0` and slot `+0x24` returns it, so **urgency is the level**. The rest of the base: `+0x98` the explainer finder for the action name,
`+0x9D` "last start failed", `+0xE8` an adaptive "despair" rate (starts at `InitialDespRate`, clamped to 0..1).

**Growth** [read]. `DesireCrap_Tick` (`00834640`, the same code in `DesireBuyFood_Tick`): `level = level + (1 - level) * increment`, clamped to 0..1, then capped at the row's `maxdesire`.
`DesirePropInteract` has **no tick of its own**: its tick slot (`+0x0C`) is the base class's `FUN_00837A80`, which is **linear**: `level = level + increment`, clamped, and held at `maxdesire` once it reaches it. A desire
is therefore exponential or linear by its class, not by its row.
`TMBaseDesire_TickShared` (`00837B90`) calls the update every time when `AdaptiveDesires` is 0; when it is on, a per-desire countdown (`+0x108`) is reloaded with `interval * AdaptiveMultiplier`
(at most `MaxDesireInterval`) between updates [read]. How often the character's desires are ticked, and what `interval` is, is **not read**. `DesireCrap_ResetUrgency` sets the level to 0.

**Starting level** [read]. A character with a saved value (`MyDesireMap`, `CLASS_NOTES.md` 3ar) starts from it. Otherwise: crap a random level between 0.2 and 0.5, buyfood between about 0.15 and
0.4, propinteract between 0.1 and 0.4, gawp 0.4, staybybase the row's fixed desire. The other desires' starting levels are not read.

## Choosing the next action

`TMCharacter_UpdateActionSelection` (`0059CBD0`) runs for every character every tick [read]:
1. The character's action list is sorted by urgency (`DesireList_SortByPredicate`); the current action's urgency (`TMCharacter_GetActionDesireUrgency`, 0 when none or a temporary one) is the **threshold**.
2. One timer calls the character's desire update (vtable `+0x17C`); another, when it elapses, tries to start something better: `TMCharacter_TryStartAnyDesireAction` (`0059B240`) walks the resident desires
   (sorted, most urgent first) and for the first whose urgency is **above the threshold** asks its explainer finder to start the action; the first success wins, a failure sets the desire's
   "failed" flag and goes on to the next. `TMCharacter_TryStartAnyDesireActionClearingFlags` (`0059AF80`) is the same for a character with nothing running (it clears the failed flags first, then starts
   the first desire above the threshold, here with no cost ceiling).
3. `TMCharacter_TryReplaceActionWithBetterDesire` (`0059B050`) re-checks the running action every 10 to 30 s (a random countdown at `+0x46C`) and swaps it for a cheaper way to satisfy the same desire
   ("Found a better way to do desire").
Where the two timers' intervals come from is **not read**.

**The finder** [read]. A desire's finder is a `CMetaExplainer` (`CMetaExplainer_RegisterExplainerForAction`, `008B94B0`, fills one per action name from every explainer that lists the action).
`CMetaExplainer_StartCheapest` (`008B8C30`) asks each registered explainer for its cost and starts the cheapest one under a ceiling; `StartRandomUsable` (`008B8B90`) picks uniformly among the usable ones;
`StartBestAction` (`008B8F20`) uses the random pick when the meta-explainer's mode (`+0xC8`) is 1 and the cheapest otherwise. Starting one creates the activity
(`CAssetActionExplainer_CreateActivity`, `008BCA40`) and, for an explainer that is not queueable, puts the prop on a **10-tick cooldown** (`+0x268`, set in `CAssetActionExplainer_StartAction`,
`008B33D0`) so two people do not pick it in the same moment.

**The cost** [read]. `Explainer_GetActionCost` (`008B30E0`) returns "cannot" (so the prop is not a candidate) when the explainer is not active, has no prop, or the prop's flag at `+0x2B8` is zero;
when `range` is set and the character is farther than it from the prop (the distance is first scaled by a constant, `DAT_00D17194`, when the character is the prop's current user); when it is **not queueable and busy** (users, queued
people or the cooldown above); and when the action has no `[action/<name>/cost]` section. Otherwise
`cost = distance * distancecost + queue_position * queuecost + (1 - niceness) * nicenesscost`, each term only when its weight is non-zero. `niceness` is a 0..1 value looked up at the prop's position
(`FUN_00454B40`; what it measures is **not read**). Some explainers override the cost function by the `override` key (`CAssetActionExplainer_GetActionCost`, `008B3D60`: four alternatives
selected by a substring of the key, not read).

## The explainer files

`data\explainers\<name>.ini` (113 files) [data]. Keys of a file (`CAssetActionExplainer_LoadConfigAndRegister`, `008BD450`, and `Explainer_LoadConfig`, `008B2220`):

| Key | Meaning |
|---|---|
| `interaction`, `queueinteraction` | the scene (`Data\Scene\Interactions`, `FLM_FORMAT.md` 2) played at the prop, and the one played while queueing |
| `queueable`, `capacity`, `bIgnoreQueue` | whether others may queue, how many can use it at once |
| `range` | the farthest a character may be and still choose this prop |
| `override`, `BoostedDesire`, `satisfyincrement`, `interactive`, `bargeable`, `Possesable` | cost override, a desire this prop boosts, how much a use satisfies, and drop-icon behaviour (not decoded one by one) |
| `[pos]` `LocalPositionX/Y/Z`, `LocalAngle` | the goal point and heading **in the prop's frame** (`FUN_008BC6D0`) |
| `[action/<name>]`, `.../thoughts`, `.../cost` | the action this prop offers (the desire's action name); the thought texts; the cost weights `distancecost`, `queuecost`, `nicenesscost` |
| `typeinterval` | after anyone is sent to a prop of this explainer, none is chosen for this long: the explainer keeps a record shared by its whole kind (`FUN_008B41E0` creates it, `CAssetActionExplainer_GetActionCost` checks it). The number is in ticks [inferred]; `reexplainticks` and `globalreexplainticks` are the same kind of cooldown for one prop and for the kind after a use |
| `[aisliders/...]` | what a use does to the character: `desire_<name>` (negative = satisfied), `stress`, `boredom`, `drunkeness`, `weight`, `sexappeal`, `addiction_food` |

A placed object brings its own explainers: `[extra_info/explainer/<name>]` in its ini (`facility\*.ini`: 12 files, `ornament\*.ini`: 41, `lot.ini`), loaded by `CAsset_LoadTaskDefinitions`
(`00533850`) and `FUN_008BDAA0` with `offset` (two numbers, added to the explainer's local position), `angle`, and for queues `position`, `queue`, `queueangle`; the explainer list header has
`waitforall` and `combinequeues` (a row of toilets share one queue). Examples [data]: the toilet facilities list `male_loo` / `female_loo` or the `male_portaloo` / `female_portaloo` pair, the catering facilities
`counter`, the dustbin `trashbin`, benches `seat` / `sit_chair`; `gawp`, `staybybase` and the fixed desires are not attached to any placed object (the game creates them elsewhere).

**The goal in the world** [read]. `FUN_008BC940` builds it: `local = LocalPosition.xy + offset`; rotate by the prop's yaw (`cos`, `sin` of the angle at `*(prop + 0x11C) + 0x80`); add the prop's position;
z is ignored. The heading adds the explainer's `LocalAngle` and the placed `angle` to the prop's yaw [inferred]. The queue entry point is computed from `queue` and `queueangle` the same way
(`CQueue_GetOrCreateEntryPointPosition`; not decoded).

**What a use does** [read]. A slider named `desire_<name>` adds its value to the character's desire of that name and clamps to 0..1 (`FUN_008AC360` finds it with `TMCharacter_FindResidentDesireByName` and calls
`FUN_00842F40`); a bench's `desire_propinteract = -0.05` takes that off. The sliders are applied by `TMActivityManager_DispatchAiChannelEvents` (`00404B40`, through `FUN_008AC9E0`) **when the interaction scene fires
an event naming the slider set**, so how often a long use applies them depends on the scene, which is not read. `DesirePropInteract`'s reset slot (`+0x30`) is a clamped subtract of a value the running activity
holds (`FUN_00407100`), not a reset to 0 as in `DesireCrap_ResetUrgency` [read; the value's source is not]. Other sliders (`stress`, `boredom`, `drunkeness`, `weight`, `sexappeal`, `cuteness`, `addiction_food`, `genre_*`)
change a star's mood stats and traits (`FUN_008AC360`).

`data\dropactions.ini` [data]: for the default, runner, actor and director classes of person and each sex, a weight per action (`readyposition`, `crap_male` / `crap_female`, `buyfood`, `gawp`,
`propinteract`, `tidy`, `repair`, `detox`, ...). It reads as the actions a person may take when put down; **no code that reads it was found** (the file name is not a plain string in the executable).

## The web port

`web/src/sim/ai/Desires.ts` (the table, the level, growth and starting levels), `Explainers.ts` (parse an explainer, the goal, the cost, busy and cooldown), `DesireAgent.ts` (the
selection and the activity states enroute -> turning -> using, with waiting when the prop is occupied), `web/src/world/Props.ts` (collects the explainers of the placed facilities and ornaments and the
desire table), wired in `web/src/world/WorldScene.ts` and `WorldData.ts`; tests `web/tests/sim/desires.test.ts`. Ported desires: `crap_male`, `crap_female`, `buyfood` (exponential growth, reset by a use) and `propinteract` (linear growth, adjusted by the prop's slider).
Off by default; the dev menu's Movement section ("Loose people act on desires") turns it on. A person given an order, or picked up, drops their activity and frees the prop.

Choices that are **[guess]**: the desire update rate (10 per second, no adaptive skipping), the interval between start attempts (2 s), the length of a use (the scenes are not played; a fixed 8 s),
a use resets the desire to 0 unless the prop has a slider for it, in which case the slider is added once at the end of the use, props with equal cost are picked at random, `niceness` is taken as 1 (no niceness cost), the turn is a plain heading change at the walker's turn rate, an occupied prop makes the next person wait at its goal (no
queue points), and the **idle threshold**: the game starts a desire when its urgency beats the running action's, and an idle character there always has one (`roam`, `wander`), which are not
ported, so a fixed 0.5 stands in (otherwise a reset desire would win again at once, at level 0.0001).

Measured in the port, on the Quick Start save [measured, ours, not the game's]: 126 explainer props are placed (3 toilets each for men and women, 2 food counters and 16 `propinteract` props: 3 benches, 8 trees,
3 parasols, a sun lounger and a gym bar), 51 of their goal points fall in grid cells the footprints block (the route ends at the nearest free cell and that counts as arrived), and the 17 people who are loose
complete about 70 uses in 30 game minutes when the crap and food desires start at 0.8. **The update rate decides how busy people are:** `propinteract` climbs 0.002 per update, so at 10 updates a second it
reaches the idle threshold in seconds; if the real update is slower the people would sit far less. It is the first thing to tune by eye.

## Not read

Who ticks a desire and how often (the per-desire update slot is called from somewhere not found; `TMCharacter_ReleaseAllDesires` releases them and `+0x108` removes one), `interval` in the adaptive update,
the other desires' starting levels and updates (`getdrunk`, `overeat`, `disposeoflitter`, `smalltalk`, `leave`, ...), when a long scene applies its sliders, the `override` cost functions, `niceness`, the queue geometry, how an interaction scene
ends, and the use of `dropactions.ini`.
