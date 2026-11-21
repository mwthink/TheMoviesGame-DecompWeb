#include "game/staff/Stunts.hpp"

#include <cmath>

namespace otm::staff {

namespace {
float Clamp01(float v) {
    if (v >= 0.0f) return v <= 1.0f ? v : 1.0f;
    return 0.0f;
}
}  // namespace

// orig: 0x004EA1D0
float StuntActorScore(float stuntsTrait, float health, const StuntTuning& t) {
    const float modifier = health < t.healthThreshold ? t.abilityInjuryModifier : 1.0f;
    float ability = Clamp01(Clamp01(t.maxHealthAbility - t.minHealthAbility) * health + t.minHealthAbility);
    ability = Clamp01(ability * modifier);
    return Clamp01(stuntsTrait * ability);
}

// orig: 0x004EA1D0
float StuntSuccessChance(float castScore, float difficulty, bool luckyCharm, const StuntTuning& t) {
    const float diff = castScore - difficulty;
    float chance;
    if (diff >= 0.0f) {
        chance = (t.chanceHigh - t.chanceMedium) * diff + t.chanceMedium;
    } else {
        chance = t.chanceMedium - (t.chanceLow - t.chanceMedium) * diff;
    }
    if (luckyCharm) chance += t.luckyCharmBonus;
    if (chance <= t.chanceMin) chance = t.chanceMin;
    float clamped = chance;
    if (t.chanceMax <= chance) clamped = t.chanceMax;
    return Clamp01(clamped);
}

// orig: 0x004EA1D0
float NextRandomUnit(uint32_t& seed) {
    seed = seed * 0x19660Du + 0x3C6EF35Fu;
    return static_cast<float>((seed >> 6) & 0x7FFFFFu) * 1.192093e-07f;
}

// orig: 0x004EA1D0
StuntRoll RollStuntOutcome(const std::vector<float>& performerScores, float difficulty, bool luckyCharm, uint32_t& seed,
                           const StuntTuning& t) {
    StuntRoll r;
    if (performerScores.empty()) return r;
    float sum = 0.0f;
    for (float s : performerScores) sum = s + sum;
    r.rolled = true;
    r.castScore = sum / static_cast<float>(performerScores.size());
    r.chance = StuntSuccessChance(r.castScore, difficulty, luckyCharm, t);
    r.failed = !(NextRandomUnit(seed) < r.chance);  // success only if the draw is below the chance
    return r;
}

// orig: 0x004E2240
float StuntHealthLoss(float stuntsTrait, float difficulty, bool failed, const StuntTuning& t) {
    const float skill = Clamp01(t.damageSkillMultiplier * stuntsTrait);
    const float danger = Clamp01(difficulty - skill);
    const float hi = failed ? t.maxHealthLossFailure : t.maxHealthLossSuccess;
    const float lo = failed ? t.minHealthLossFailure : t.minHealthLossSuccess;
    return Clamp01((hi - lo) * danger + lo);
}

// orig: 0x0057C410
float StuntExperienceGain(float difficulty, bool success, bool jobIsStuntman, float naturalTalentMultiplier, const StuntTuning& t) {
    float xp = success ? (t.xpSuccessMax - t.xpSuccessMin) * difficulty + t.xpSuccessMin
                       : (t.xpFailureMax - t.xpFailureMin) * difficulty + t.xpFailureMin;
    if (naturalTalentMultiplier >= 0.0f) xp = naturalTalentMultiplier * xp;
    if (!jobIsStuntman) xp = t.actorStuntSkillModifier * xp;
    return xp;
}

// orig: 0x0057C410
float AddStuntExperience(TraitMap& traits, float difficulty, bool success, bool jobIsStuntman, float naturalTalentMultiplier,
                         float traitBonus, const StuntTuning& t) {
    return traits.Add("Stunts", StuntExperienceGain(difficulty, success, jobIsStuntman, naturalTalentMultiplier, t), traitBonus);
}

// orig: 0x0083D1A0
float StuntTrainingXp(float sessionLevel, float stuntsTrait, bool success, float health, float naturalTalentMultiplier,
                      const StuntTuning& t) {
    const float match = 1.0f - std::fabs(sessionLevel - stuntsTrait);
    const float lo = success ? t.trainingXpSuccessMin : t.trainingXpFailureMin;
    const float hi = success ? t.trainingXpSuccessMax : t.trainingXpFailureMax;
    float xp = (Clamp01(hi) - lo) * match + lo;
    if (naturalTalentMultiplier >= 0.0f) xp = naturalTalentMultiplier * xp;
    if (xp <= t.trainingXpIncreaseMin) xp = t.trainingXpIncreaseMin;
    if (health < t.healthThreshold) xp = t.trainingLowHealthMultiplier * xp;
    return xp;
}

}  // namespace otm::staff
