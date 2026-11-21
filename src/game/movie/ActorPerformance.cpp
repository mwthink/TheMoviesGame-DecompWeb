#include "game/movie/ActorPerformance.hpp"

#include <cmath>

namespace otm::movie {

// orig: 0x005DB140
ActorPerformance ComputeActorPerformance(float genreExperience, float genreFit, float mood, float starRating,
                                         const QualityTuning& q) {
    ActorPerformance r;
    r.genreExperience = genreExperience;
    r.genreFit = genreFit;
    r.mood = mood;
    r.starRating = starRating;
    r.performance = genreExperience * genreFit * mood;
    r.normalized = Clamp01(NormalizePerformance(r.performance, q));
    return r;
}

// orig: 0x005D79A0
float MoodPerformanceFactor(float mood, float lowerThreshold, float upperThreshold, const ActorTuning& t) {
    const float outerBand = (1.0f - (t.starMoodStep + t.starMoodStep)) * 0.33333334f;
    if (lowerThreshold < 0.0f || lowerThreshold > 1.0f || upperThreshold < 0.0f || upperThreshold > 1.0f || mood < 0.0f ||
        mood > 1.0f) {
        return t.starMoodMin;
    }
    double f;
    if (lowerThreshold > 0.0f && mood < lowerThreshold) {
        f = static_cast<double>(mood) / lowerThreshold * outerBand;  // unhappy: first band
    } else if (upperThreshold <= 0.0f || upperThreshold <= mood) {
        if (upperThreshold == 1.0f) {
            f = mood;
        } else {
            const double top = 1.0 - outerBand;  // happy: top band reaching 1.0
            f = (1.0 - top) * ((mood - upperThreshold) / (1.0 - upperThreshold)) + top;
        }
    } else {
        double along = 0.0;  // between the thresholds: a narrow band around 0.5
        if (upperThreshold != lowerThreshold && lowerThreshold != 0.0f) {
            along = (mood - lowerThreshold) / (upperThreshold - lowerThreshold);
        }
        const double start = static_cast<double>(t.starMoodStep) + outerBand;
        f = start + ((1.0 - start) - start) * along;
    }
    return static_cast<float>((t.starMoodMax - t.starMoodMin) * f + t.starMoodMin);
}

// orig: 0x005882E0
// orig: 0x0056F940
float GenreFitScore(float diff1, float diff2, float diff3, float k, float perfectFitMultiplier) {
    float fit = ((1.0f - std::fabs(diff1) * k) + (1.0f - std::fabs(diff2) * k) + (1.0f - std::fabs(diff3) * k)) * 0.33333334f;
    if (perfectFitMultiplier >= 0.0f) fit = perfectFitMultiplier * fit;
    return Clamp01(fit);
}

// orig: 0x005D7B90
// orig: 0x005D7CB0
float GenreFitFactor(float fitScore, bool isDirector, bool isStarOrExtra, const ActorTuning& t) {
    if (isDirector) return 1.0f;
    const float score = isStarOrExtra ? fitScore : 0.0f;
    float scaled = (t.genreFitMax - t.genreFitMin) * score;
    if (scaled < 0.0f) return t.genreFitMin;
    if (scaled > 1.0f) scaled = 1.0f;
    return scaled + t.genreFitMin;
}

// orig: 0x005D87A0
// orig: 0x005D8C80
float StarChemistry(const std::vector<float>& otherStarRelationships, const float* directorRelationship) {
    float sum = 0.0f;
    int count = 0;
    for (float r : otherStarRelationships) {
        sum += r;
        ++count;
    }
    if (directorRelationship) {
        sum = *directorRelationship + *directorRelationship + sum;
        count += 2;
    }
    if (count == 0) return 0.5f;
    return sum / static_cast<float>(count);
}

// orig: 0x005D8E10
float MeanMoviesTrait(const std::vector<float>& crewMoviesTrait) {
    if (crewMoviesTrait.empty()) return 0.0f;
    float sum = 0.0f;
    for (float v : crewMoviesTrait) sum += v;
    return sum / static_cast<float>(crewMoviesTrait.size());
}

// orig: 0x00597820
float Likeness(const LikenessTraits& a, const LikenessTraits& b, const ActorTuning& t) {
    const float genderDiff = a.female != b.female ? 1.0f : 0.0f;
    const float ageTerm = Clamp01(std::fabs(a.age - b.age) * 0.02f);        // 50 years apart = 1
    const float weightTerm = Clamp01(std::fabs(a.weight - b.weight) * 0.01f);  // 100 units apart = 1
    const float looksTerm = std::fabs(a.looks - b.looks);
    const float sexTerm = std::fabs(a.sexAppeal - b.sexAppeal);
    const float likeness = 1.0f - (t.genderFactor * genderDiff + t.ageFactor * ageTerm + t.weightFactor * weightTerm +
                                   looksTerm * t.looksFactor + sexTerm * t.sexFactor);
    return Clamp01(likeness);
}

// orig: 0x005D78A0
float LikenessFactor(float likeness, bool sameActor, const ActorTuning& t) {
    if (sameActor) return t.likenessBonus;
    const float scaled = (t.likenessMax - t.likenessMin) * likeness;
    if (scaled < 0.0f) return t.likenessMin;
    return (scaled > 1.0f ? 1.0f : scaled) + t.likenessMin;
}

// orig: 0x005D7920
float HealthFactor(float health, bool noPerformer, const ActorTuning& t) {
    if (noPerformer) return t.healthMin;
    const float f = (t.healthMax - t.healthMin) * health + t.healthMin;
    return health < t.healthThreshold ? f * t.healthInjuryMultiplier : f;
}

// orig: 0x005D8920
float StuntSkillFactor(float stuntsTrait, bool noPerformer, const ActorTuning& t) {
    if (noPerformer) return t.stuntSkillMin;
    return (t.stuntSkillMax - t.stuntSkillMin) * stuntsTrait + t.stuntSkillMin;
}

float StuntSuccessFactor(bool succeeded, const ActorTuning& t) {
    return succeeded ? t.successMax : t.successMin;
}

float StuntLevelFactor(float difficulty, const ActorTuning& t) {
    return t.levelMin + Clamp01((t.levelMax - t.levelMin) * difficulty);
}

// orig: 0x005D8BD0
float StuntPerformance(float skillFactor, float healthFactor, float likenessFactor, float difficulty, bool succeeded,
                       const ActorTuning& t) {
    return skillFactor * (healthFactor * likenessFactor) * StuntLevelFactor(Clamp01(difficulty), t) * StuntSuccessFactor(succeeded, t);
}

// orig: 0x006F9CF0
float NormalizeStuntScore(float score, const ActorTuning& t) {
    if (score <= t.releaseScreenMin) score = t.releaseScreenMin;
    if (t.releaseScreenMax <= score) score = t.releaseScreenMax;
    return Clamp01((score - t.releaseScreenMin) / (t.releaseScreenMax - t.releaseScreenMin));
}

}  // namespace otm::movie
