#include "game/movie/MovieQuality.hpp"

#include <algorithm>
#include <cmath>

namespace otm::movie {

namespace {
// Literals in the original code (not read from the ini).
constexpr float kBonusChunk = 0.1f;       // the bonus is summed in chunks of this size ...
constexpr float kBonusDecay = 0.8f;       // ... each worth this much of the previous chunk
constexpr float kPreProductionShare = 0.25f;
constexpr float kShotShare = 0.75f;
constexpr float kTickSeconds = 0.1f;      // one project update is 0.1 s
}  // namespace

// The original clamps with "if (0 <= v) { if (v > 1) v = 1 } else v = 0", so NaN ends up as 0.
float Clamp01(float v) {
    if (v >= 0.0f) return v <= 1.0f ? v : 1.0f;
    return 0.0f;
}

// orig: 0x005D75F0
float NormalizePerformance(float performance, const QualityTuning& t) {
    return Clamp01((performance - t.unspreadPerformanceMin) / (t.unspreadPerformanceMax - t.unspreadPerformanceMin));
}

float SetConditionFactor(float repair, const QualityTuning& t) {
    return (t.setRepairMax - t.setRepairMin) * repair + t.setRepairMin;
}

// orig: 0x005D9130
float CrewFactor(float meanMoviesTrait, const QualityTuning& t) {
    return (t.crewMax - t.crewMin) * meanMoviesTrait + t.crewMin;
}

// orig: 0x005D9520
float StarRelationshipFactor(float chemistrySum, int counted, const QualityTuning& t) {
    float v = chemistrySum;
    if (counted != 0) {
        const float width = t.starRelationshipRangeWidth;
        v = Clamp01((chemistrySum / static_cast<float>(counted) - (1.0f - width) * 0.5f) / width);
    }
    return (t.starRelationshipMax - t.starRelationshipMin) * v + t.starRelationshipMin;
}

// orig: 0x005D9390
float GenreExperienceFactor(float genre, const std::vector<float>& otherGenres, const QualityTuning& t) {
    float other = 0.0f;
    if (!otherGenres.empty()) {
        float sum = 0.0f;
        for (float v : otherGenres) sum += v;
        other = sum / static_cast<float>(otherGenres.size());
        other = std::min(other, (1.0f - genre) * 0.5f);
    }
    return (other + genre) * (t.starGenreExperienceMax - t.starGenreExperienceMin) + t.starGenreExperienceMin;
}

// orig: 0x005DC900
float AverageCastPerformance(const std::vector<float>& leadCastPerformance, float directorPerformance) {
    float sum = 0.0f;
    for (float v : leadCastPerformance) sum += v;
    return (directorPerformance + sum) / static_cast<float>(leadCastPerformance.size() + 1);
}

float DiminishingBonus(float x) {
    if (!(x > 0.0f)) return x;  // penalties are linear and uncapped
    float bonus = 0.0f;
    float weight = kBonusDecay;
    float left = x;
    do {
        const float chunk = left > kBonusChunk ? kBonusChunk : left;
        left -= kBonusChunk;
        bonus += chunk * weight;
        weight *= kBonusDecay;
    } while (left > 0.0f);
    return bonus;
}

// orig: 0x005DCB10
float ComputeQuality(const ProductionFactors& f, const QualityTuning& t) {
    const float production = f.setCondition * f.crew * f.starRelationship * f.castPerformance;
    const float scriptOffset = f.scriptQuality - t.overallShifterMidPoint;
    // Better scripts get a slightly smaller bonus: the shift is -2 * (S - midpoint) * maxShifter.
    const float x = ((production - 1.0f) + (scriptOffset + scriptOffset) * -1.0f * t.overallMaxShifter) * t.overallMaxAdder;
    return Clamp01(DiminishingBonus(x) + f.scriptQuality);
}

float PreProductionWeight(uint32_t ticksInPreProduction, const QualityTuning& t) {
    // MOVIE_QUALITY.md section 7: the argument is clamped to 0..1. The clamp is not visible in the decompiled code (the value
    // goes through the x87 stack into pow), so it is documented behaviour rather than read from the code.
    const float x = Clamp01(static_cast<float>(ticksInPreProduction) * kTickSeconds / t.preProductionTime);
    return 1.0f - std::pow(1.0f - x, 3.0f);
}

// orig: 0x005B6FB0 verified
// Verified: reproduces the finalQuality logged by the running game for two player movies (docs/MOVIE_QUALITY.md section 7,
// tests/MovieQualityTest.cpp), both exact to the logged 5 digits. Only in-range inputs were measured.
float ComputeFinalQuality(const FinalQualityInput& in, const QualityTuning& t) {
    float quality = 0.0f;
    if (in.hasPreProduction) {
        quality = Clamp01(kPreProductionShare * in.preProductionQuality * PreProductionWeight(in.ticksInPreProduction, t));
    }
    int32_t totalWeight = 0;
    for (const ShotRating& s : in.shots) totalWeight += s.weight;
    float shotSum = 0.0f;
    for (const ShotRating& s : in.shots) {
        shotSum = (static_cast<float>(s.weight) / static_cast<float>(totalWeight)) * s.quality + shotSum;
    }
    return Clamp01(shotSum * kShotShare + quality);
}

}  // namespace otm::movie
