# The stunt success/failure system (The Movies, MoviesSE.exe 2006 patched build)

Reverse-engineered from `ShootController_RollStuntOutcome` (`ShootController_RollStuntOutcome`, 0x4ea1d0) and `Data\stunts.ini`, and confirmed against a runtime capture of a failed stunt take.
Labels: **[code]** read from decompiled code, **[data]** from the shipped ini files, **[runtime]** observed in play.

## 1. When it runs **[code + runtime]**
At the start of every take of a scene the shoot controller rolls the stunt outcome **once** (about 20 ms after the take begins, right after the silent re-simulation of the take) and publishes it as the scene channel **`ai_stunt_fail`** through
`ShootController_SetChannel`, which stores it in the controller's channel list and forwards it with `Scene_SetChannel` to every scene of the bundle (main scene, crew scene, extras).
Observed in the capture (`018_fall_head.flm`, failed stunt): `ai_stunt_fail = 0.000` at take start (reset together with `ai_crane`, `ai_dolly`, `ai_director_mood`...), then **`ai_stunt_fail = 1.000` 22 ms later**; the outcome stays fixed for the take
(replays triggered by moving the `sld_fall` slider re-simulate the same take without re-rolling). Successful takes keep it at 0. The scene's own `.flm` branches on this channel (ChoiceBox compare) to play the failure animations.

## 2. The roll (all constants from `Data\stunts.ini`) **[code + data]**
Inputs: the cast of the scene (each role with `stuntrisk > 0` in the scene ini), each actor's stunt ability, and the scene's stunt *difficulty* (the slider/level object at controller+0x1d8).

1. **Per actor** (only actors whose role has `stuntrisk > 0` and who have a character):
   * `health` = the actor's current health/ability value (character vslot `0x1e4`).
   * If `health < healththreshold` (**0.01**) the injury modifier applies: `mod = stuntabilityinjurymodifier` (**0.7**), else `mod = 1.0`.
   * `healthAbility = minhealthability + (maxhealthability - minhealthability) * health` (**0.5 .. 1.0**, linear in health), then multiplied by `mod`.
   * The actor's **`Stunts` trait** (a skill rating from the character's trait table) is combined with `healthAbility` (`Float_MulClamp01`) to give the actor's **stunt score**.
2. **Cast score** = average of the stunt scores of those actors; stored at controller+0xf8.
3. **Difficulty gap** `diff = castScore - difficulty` (difficulty from the scene's stunt level object, `StuntState_GetDifficulty(controller+0x1d8)`).
4. **Success chance** (piecewise linear through the points `(-1, stuntchancelow)`, `(0, stuntchancemedium)`, `(+1, stuntchancehigh)`):
   * `diff >= 0`: `chance = stuntchancemedium + (stuntchancehigh - stuntchancemedium) * diff` = **0.80 + 0.30 * diff**
   * `diff < 0`: `chance = stuntchancemedium - (stuntchancelow - stuntchancemedium) * diff` = **0.80 + 1.20 * diff**
   * (`stuntchancelow = -0.40`, `stuntchancemedium = 0.80`, `stuntchancehigh = 1.10`)
5. If the **Lucky Charm** award bonus (bonus id 0xE) is active: `chance += luckycharmbonus` (**+0.10**).
6. Clamp `chance` to `[stuntchancemin, stuntchancemax]` = **[0.05, 0.98]**, then to [0, 1]; stored at controller+0xf4 (shown in the UI as the success chance).
7. **Random draw** with a private LCG: `seed = seed * 0x19660D + 0x3C6EF35F` (Numerical-Recipes constants; the seed is initialised from the clock on first use); `r = ((seed >> 6) & 0x7FFFFF) / 2^23` (0..1).
   **Success if `r < chance`**, otherwise **failure** -> flag controller+0xf0 = 1 -> channel `ai_stunt_fail = 1`.
Worked numbers: castScore equal to the difficulty (diff 0) -> 80% success (90% with a lucky charm); castScore 0.5 below the difficulty -> 0.80 - 0.60 = 20%; castScore 1.0 or more below -> clamped to 5%; castScore 0.5 above -> 0.95; >= 0.6 above -> capped at 98%.
Nothing is rolled (flag 0) when there is no stunt actor, when the movie is in a mode where the stunt system is disabled (`DAT_0104a974 + 0x80 != 0`), or the scene is not a stunt scene (`CProject_HasStuntShots`).

### 2b. Exact formulas (helpers decoded) **[code]**
The three small helpers used by the roll are plain clamped arithmetic (`clamp01(x)` = min(max(x,0),1)):
* `Float_MulClamp01(&a, b)` = `clamp01(a * b)`; `Float_MulInPlaceClamp01(&v, m)`: `v = clamp01(v * m)` (in place; underflow -> 0, overflow -> 1); `Float_SubClamp01(&a, b)` = `clamp01(a - b)`.
* `StuntState_GetDifficulty` = the stunt state object's float at +0x248 clamped to [0,1], or **0 when the stunt mode flag `GameModeFlag_IsSet(2)` is set**. (The object at controller+0x1d8 is the scene's stunt state; `+0x248` is the difficulty/level shown by the stunt slider.)

So for each stunt actor (role `stuntrisk > 0`):
```
health        = character.vslot_0x1e4()                          // current health/ability value
healthAbility = clamp01(Float_SubClamp01(max,min) * health + min)  // min=0.5, max=1.0  -> 0.5 + 0.5*health
if health < healththreshold(0.01):  healthAbility = clamp01(healthAbility * 0.7)   // stuntabilityinjurymodifier
score         = clamp01(StuntsTrait * healthAbility)             // the actor's "Stunts" trait (0..1)
castScore     = average(score over stunt actors)                  // stored at controller+0xf8
diff          = castScore - difficulty                            // difficulty = StuntState_GetDifficulty()
chance        = 0.80 + 0.30*diff   (diff >= 0)   |   0.80 + 1.20*diff   (diff < 0)
if LuckyCharm bonus (id 0xE) active: chance += 0.10
chance        = clamp(chance, 0.05, 0.98)                         // stored at controller+0xf4
fail          = (rand01() >= chance)                              // LCG, see above
```
`ShootController_StartTake` runs this roll as part of starting a take (after the scene is rewound with `Scene_RestartAtFrame` and the take state is set to 3 = "in progress").

## 3. Related tuning from `Data\stunts.ini` **[data]** (consequences are applied elsewhere; values listed for reimplementation)
* `[experience]`: `experiencemin/max` 0.20/0.21, XP after a stunt: success +0.02..0.06, failure +0.01..0.04 (`stuntxpsuccess/failuremin/max`), `actorstuntskillmodifier` 0.7, `stuntmangenremodifier` 0.7.
* `[injuries]`: health loss on **failure** 0.1..0.8 (`min/maxhealthlossstuntfailure`), on **success** 0.1..0.2; `stuntdamageskillmultiplier` 0.3.
* `[performance]` (affects the movie's quality/score): `stuntskill` factor 0.9..1.1, `stuntlevel` 0.9..1.4, `likenessbonus` 1.1 (0.9..1.0 range), `health` 0.9..1.1, `injurymultiplier` 0.9, `success` factor 0.8..1.25, release-screen bounds 0.6..2.0.
* `[training]` (stunt school): XP on success -0.04..+0.04 (!), failure -0.03..+0.03, `stuntxpincreasemin` 0.005, health-loss ranges (failure 0.05..0.5, success 0.05..0.2), `successinjurymultiplier` 0.12, `failureinjurymultiplier` 0.18, `minxpcapforhealthloss` 0.15.
* `[scripts]`: `topstuntskillmodifier` 0.3, `minstuntskillmodifier` -0.51, `ignorestuntrisklimit` 0.
* General: `genderfactor` 0.5, `sexfactor` 0.1, `weightfactor` 0.1, `agefactor` 0.15, `looksfactor` 0.15 (likeness factors for stunt doubles), `healthgainpertick` 0.00001 (health regeneration per tick).

## 4. Evidence from the captures
* `025_time_bomb` / `025_fall_head` / `018_*` successful takes: `ai_stunt_fail` = 0 at start, never 1.
* `018_fall_head` failed take (11:16:11): `ai_stunt_fail` 0 -> 1 (+22 ms), `ai_director_mood = 0.661`; the `sld_fall` slider was dragged 0.167 -> 0.782 -> 0.167 (each change replays the take: `ai_ended_by_user` 1 -> 0 pairs), `ai_take_in_progress` 1 -> 0 at the end (20.3 s after start including the replays).
* The stunt scene inis carry the per-role risk: `001_fire_stare` `stuntrisk = 1.0`, `[stunt] level = 0.60`; `018_gun_fire_xt_cu` `stuntrisk = 0`, `[stunt] level = 0`; `025_time_bomb` `[stunt] level = 0`.

## 5. After the take: injuries, XP and announcements **[code + data]**
`ShootController_EndTake` runs when a take finishes: it records the take time, adds an amount from the experience table (index 0x0D, `ExperienceTable_Get`) to every cast member's **`Movies` trait**, builds the movie record (`CProject_BuildMovieRecord`),
computes the take's quality score (`ShootController_ComputeTakeScore`, stored at controller+0xfc), then calls, in this order:
1. `ShootController_ApplyActorExperience` - XP for everyone in the cast:
   * stunt actors (role `stuntrisk > 0`, not in mode 2): **`CStaff_AddStuntExperience(difficulty, success)`** (`CStaff_AddStuntExperience`);
   * everyone else (and the director/crew via `CProject_GetDirector`): **`CStaff_AddGenreExperience(controller)`** (`CStaff_AddGenreExperience`).
2. `ShootController_ApplyStuntConsequences` - injuries and the on-screen announcement.

**Stunt XP** (`CStaff_AddStuntExperience`): `xp = (max - min) * difficulty + min` using `[experience]` values - **success: min 0.02, max 0.06; failure: min 0.01, max 0.04** (so harder stunts give more XP, and success always gives more than failure at the same difficulty);
x the award-bonus-0xF multiplier when active; **x `actorstuntskillmodifier` (0.7) unless the character's job is stuntman (job 16)**; then `Stunts` trait += xp, and the character's stunt statistics are updated (`CStaff_RecordStuntResult`, e.g. `stunt_failure_count`).

**Genre/acting XP** (`CStaff_AddGenreExperience`): adds XP to the trait named after the movie's genre (name from the project via `CProject_GetPrimaryGenre`/`FUN_00449b40`); the amount is looked up in an experience table by role (`ExperienceTable_Get(index)`): **index 0x10 for the director** (the character who is the project's director), **0x0E / 0x0F for lead cast** (depending on whether the actor role is "star"/lead, `CastSlot_IsLeadRole`), **0x13 for everyone else**; **x `stuntmangenremodifier` (0.7) for stuntmen**.

**Injuries** (`ShootController_ApplyStuntConsequences`, only when the stunt mode is off and the controller has stunt actors): for each stunt actor
```
skillFactor = clamp01(StuntsTrait * stuntdamageskillmultiplier(0.3))
danger      = clamp01(difficulty - skillFactor)
healthLoss  = lerp(minLoss, maxLoss, danger)       // failure: 0.10 .. 0.80 ; success: 0.10 .. 0.20
character.vslot_0x1e8(-healthLoss)                 // AdjustHealth
```
then the Tannoy announces **`TANNOY_STUNT_SCENE_SUCCESS` or `TANNOY_STUNT_SCENE_FAILURE`** (text/audio keys; only in normal play, i.e. when the global flag at `DAT_0104a974+0x6c` is not negative).
So a stunt performed by a skilled actor on an easy stunt costs only about 0.10 health even on failure; an unskilled actor on a hard stunt can lose up to 0.80.

The slots are `*_GetHealth` (`0x1E4`) and `*_ApplyHealthDelta` (`0x1E8`); the project's older names said ambition, which was wrong. A negative delta is first scaled by the Thick Skin award bonus (`awardsbonuses.ini`: `health = health - damage * thick_skin_factor`, 0.8), the result is clamped to 0..1, and for the player's studio `TANNOY_STUNT_PERSON_INJURED` is announced when health falls below the threshold. In a sandbox game the **Stunt Injuries** option (`CSandbox` option 7) makes the health setters store 1.0, so none of this can lower it; the **Stuntmen** option (8) switches the stunt paths off. See FRONTEND.md, "The nine start options".

**Stunt school training** (`StuntTraining_ApplyExperience`, run for the stunt-training desire): `match = 1 - |sessionLevel - StuntsTrait|` (how well the session's level fits the trainee), range = `[training]` success (-0.04 .. +0.04) or failure (-0.03 .. +0.03);
`xp = (clamp01(max) - min) * match + min`; x award-bonus-0xF multiplier when active; `xp = max(xp, stuntxpincreasemin = 0.005)` (so training never lowers skill); **if health < healththreshold: xp x `lowhealthmultiplier` (0.1)**; `Stunts` trait += xp.

## 6. Capture evidence
(kept from section 4) plus: the failed-take sequence in `018_fall_head` matches step 7 of the roll (a draw above the chance sets `ai_stunt_fail = 1`).

## 7. Open items
* The two sub-systems behind the numbers: what `character.vslot_0x1e4` returns exactly (a combined health/ability value), the **trait container** (`Stunts`, `Movies`, genre traits: `TMCharacter_GetTraits`, `TraitContainer_Add` add, `TraitContainer_Get` get) and the experience table at `ExperienceTable_Get`.
* The take-quality score (`ShootController_ComputeTakeScore`) and the `[performance]` factors in `QualityCalc_LoadTuningData` (how stunt skill/level/likeness/injury/success scale the movie quality).
* Who sets the stunt state's difficulty at +0x248 (probably the stunt slider channel, `sld_fall`/`sld_timebomb`) and whether a mid-take slider change re-rolls (it does not: the roll is in `StartTake`).

The roll, injuries, XP and training formulas are reimplemented in `src/game/staff/Stunts` (with tests of the numbers in this document); not yet verified against the running game.

## 8. See also
`TRAITS_AND_EXPERIENCE.md`: trait container (`Stunts`, `Movies`, genre traits and the diminishing-returns gain `new = old + (1-old)*delta`), the experience table (`experience.ini`), the stunt performance factors and take-score normalisation, and the movie-quality tuning (`releasing_movies.ini`).

## Stunt shots: success roll, injuries and performance (decoded; stunts unlock around 1960) **[code + `Data/stunts.ini`]**
**Success roll** (`ShootController_RollStuntOutcome` 0x4EA1D0, config in `stunts.ini [successfailure]`, globals renamed `Stunt_*`). For every performer of the shot (the stunt double if there is one, otherwise the actor):
```
ability  = ((maxhealthability - minhealthability) * health + minhealthability)      // 1.0, 0.5 -> 0.5 + 0.5*health
ability *= (health < healththreshold(0.01)) ? stuntabilityinjurymodifier(0.7) : 1   // badly injured performers
performer score = ability * traits["Stunts"]                                        // clamped 0..1
shot score      = mean of the performers' scores          (stored at shoot controller +0xF8; the release screen's "take score")
diff            = shot score - StuntState difficulty      (scene difficulty, 0.4/0.6/1.0 style values)
chance          = diff >= 0 ? 0.80 + (1.10 - 0.80) * diff : 0.80 - (-0.40 - 0.80) * diff     // = 0.80 + 0.3*diff  or  0.80 + 1.2*diff
if Lucky Charm (bonus 14) active: chance += luckycharmbonus (0.10)
chance = clamp(chance, stuntchancemin 0.05, stuntchancemax 0.98)
success = rand01 < chance   -> channel "ai_stunt_fail" = !success
```
So at equal skill and difficulty a stunt succeeds 80% of the time; being 0.1 above the difficulty gives 83%, 0.1 below gives 68%, and the chance is bounded to 5..98%. Lucky Charm adds a flat 10 points. **Injuries** (`ShootController_ApplyStuntConsequences` 0x4E2240, `[injuries]`): per performer `k = clamp01(difficulty - 0.3 * Stunts)` and health loss = `lerp(min, max, k)` with failure 0.1..0.8 and success 0.1..0.2 (so even a perfect success costs 10% health, a failed hard stunt by an unskilled performer 80%); `TANNOY_STUNT_SCENE_SUCCESS/FAILURE` is announced. **Quality contribution** (`QualityCalc_StuntPerformance`): `skillFactor * healthFactor * likenessFactor * levelFactor * successFactor` where `skillFactor = skillmin + (skillmax-skillmin)*Stunts` (0.9..1.1 from `[performance]`), `levelFactor = stuntlevelminimum + (max-min)*difficulty` (0.9..1.4), and `successFactor` is the success multiplier (0.8 failed, 1.25 succeeded - mapping of the table constants to `[performance]` keys is by order and not verified); likeness 0.9..1.0 (x1.1 `likenessbonus` for a double that looks like the actor), health 0.9..1.1 with `injurymultiplier` 0.9. Experience for stunt performers: `stuntxpsuccessmin/max` 0.02..0.06, failure 0.01..0.04 (`[experience]`), applied by `CStaff_AddStuntExperience`. The tracker's `REL_PLAYER_BARS` line (`meanStuntTake`, `stuntCount`) will give the actual shot scores once stunts exist.
