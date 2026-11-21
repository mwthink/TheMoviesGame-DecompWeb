// The stunt system: the success roll at the start of a take, injuries, experience and stunt-school training.
//
// Reimplemented from ShootController_RollStuntOutcome (0x4EA1D0), ShootController_ApplyStuntConsequences (0x4E2240),
// CStaff_AddStuntExperience (0x57C410) and StuntTraining_ApplyExperience (0x83D1A0). Derivation: docs/STUNT_SYSTEM.md.
//
// Pure arithmetic: the performers' traits, health and the scene's difficulty are parameters. The random draw uses the game's
// own linear congruential generator so a roll can be reproduced from a seed. Nothing here is verified against the running
// game; the formulas follow the decompiled code (a captured failed take only shows that a failure sets ai_stunt_fail = 1).
#pragma once

#include <cstdint>
#include <optional>
#include <vector>

#include "game/staff/Traits.hpp"

namespace otm::staff {

// stunts.ini: [successfailure], [injuries], [experience], [training] and the health threshold before the first section.
struct StuntTuning {
    float healthThreshold = 0.01f;           // healththreshold
    float abilityInjuryModifier = 0.7f;      // [successfailure] stuntabilityinjurymodifier
    float maxHealthAbility = 1.0f;           // maxhealthability
    float minHealthAbility = 0.5f;           // minhealthability
    float chanceLow = -0.4f;                 // stuntchancelow  (at difference -1)
    float chanceMedium = 0.8f;               // stuntchancemedium (at difference 0)
    float chanceHigh = 1.1f;                 // stuntchancehigh (at difference +1)
    float chanceMin = 0.05f;                 // stuntchancemin
    float chanceMax = 0.98f;                 // stuntchancemax
    float luckyCharmBonus = 0.1f;            // luckycharmbonus
    float damageSkillMultiplier = 0.3f;      // [injuries] stuntdamageskillmultiplier
    float maxHealthLossFailure = 0.8f;       // maxhealthlossstuntfailure
    float minHealthLossFailure = 0.1f;       // minhealthlossstuntfailure
    float maxHealthLossSuccess = 0.2f;       // maxhealthlossstuntsuccess
    float minHealthLossSuccess = 0.1f;       // minhealthlossstuntsuccess
    float xpSuccessMin = 0.02f;              // [experience] stuntxpsuccessmin
    float xpSuccessMax = 0.06f;              // stuntxpsuccessmax
    float xpFailureMin = 0.01f;              // stuntxpfailuremin
    float xpFailureMax = 0.04f;              // stuntxpfailuremax
    float actorStuntSkillModifier = 0.7f;    // actorstuntskillmodifier: non-stuntmen learn less
    float stuntmanGenreModifier = 0.7f;      // stuntmangenremodifier (used by GenreExperienceGain)
    float trainingXpSuccessMin = -0.04f;     // [training] stuntxpsuccessmin
    float trainingXpSuccessMax = 0.04f;      // stuntxpsuccessmax
    float trainingXpFailureMin = -0.03f;     // stuntxpfailuremin
    float trainingXpFailureMax = 0.03f;      // stuntxpfailuremax
    float trainingXpIncreaseMin = 0.005f;    // stuntxpincreasemin: training never lowers skill
    float trainingLowHealthMultiplier = 0.1f;// lowhealthmultiplier
};

// A performer's stunt score for the roll: clamp01(Stunts trait * health ability). The health ability runs from
// minHealthAbility to maxHealthAbility with health, and is multiplied by abilityInjuryModifier below the health threshold.
// orig: 0x004EA1D0
float StuntActorScore(float stuntsTrait, float health, const StuntTuning& t = {});

// Success chance for a cast whose mean score is castScore against the scene's difficulty (both 0..1): piecewise linear through
// (-1, low), (0, medium), (+1, high), plus the Lucky Charm bonus, clamped to [chanceMin, chanceMax].
// orig: 0x004EA1D0
float StuntSuccessChance(float castScore, float difficulty, bool luckyCharm, const StuntTuning& t = {});

// The game's private random generator: seed = seed * 0x19660D + 0x3C6EF35F, value = bits 6..28 of the new seed / 2^23.
// The game seeds it from the millisecond clock the first time it is used (seed 0); the caller does that here.
// orig: 0x004EA1D0
float NextRandomUnit(uint32_t& seed);

struct StuntRoll {
    bool rolled = false;      // false when there is no stunt performer (nothing is rolled and the take cannot fail)
    float castScore = 0.0f;   // mean of the performers' scores (controller+0xF8)
    float chance = 0.0f;      // success chance (controller+0xF4)
    bool failed = false;      // controller+0xF0, published as the channel ai_stunt_fail
};

// ShootController_RollStuntOutcome: one roll per take. performerScores holds StuntActorScore of each performer (the stunt
// double if the role has one, else the actor) of every role with a stunt weight above 0.
// orig: 0x004EA1D0
StuntRoll RollStuntOutcome(const std::vector<float>& performerScores, float difficulty, bool luckyCharm, uint32_t& seed,
                           const StuntTuning& t = {});

// Health a performer loses after the take (ApplyStuntConsequences): the skill reduces the danger of the stunt.
// danger = clamp01(difficulty - clamp01(damageSkillMultiplier * Stunts)); loss = lerp(min, max, danger) for the outcome.
// orig: 0x004E2240
float StuntHealthLoss(float stuntsTrait, float difficulty, bool failed, const StuntTuning& t = {});

// Stunt XP of one take (CStaff_AddStuntExperience): (max - min) * difficulty + min for success or failure, times the Natural
// Talent award bonus value when active (pass < 0 for "not active"), times actorStuntSkillModifier unless the job is stuntman.
// orig: 0x0057C410
float StuntExperienceGain(float difficulty, bool success, bool jobIsStuntman, float naturalTalentMultiplier = -1.0f,
                          const StuntTuning& t = {});

// Adds that XP to the "Stunts" trait (traitBonus is the experience award bonus, see TraitMap::Add). Returns the gain.
// orig: 0x0057C410
float AddStuntExperience(TraitMap& traits, float difficulty, bool success, bool jobIsStuntman, float naturalTalentMultiplier = -1.0f,
                         float traitBonus = 1.0f, const StuntTuning& t = {});

// Stunt-school training XP (StuntTraining_ApplyExperience): the better the session's level matches the trainee's Stunts trait
// the more they gain; the range is negative-to-positive, but the result never drops below trainingXpIncreaseMin, and a badly
// injured trainee (health below the threshold) gets only trainingLowHealthMultiplier of it.
// orig: 0x0083D1A0
float StuntTrainingXp(float sessionLevel, float stuntsTrait, bool success, float health, float naturalTalentMultiplier = -1.0f,
                      const StuntTuning& t = {});

}  // namespace otm::staff
