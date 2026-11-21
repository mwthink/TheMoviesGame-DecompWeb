// Movie quality rating: how a shot's and a whole movie's quality (0..1) is computed.
//
// Reimplemented from CQualityRating_Compute and its helpers, and CProject_ComputeFinalQuality.
// Derivation, constants and measured checks: docs/MOVIE_QUALITY.md.
//
// Pure functions only: the inputs are the already-gathered numbers (cast performance, script quality, ...), not game
// objects. Gathering them (walking the cast list, reading traits) belongs to the classes that own that data and comes later.
// Arithmetic is done in float like the original; the original also uses x87 80-bit intermediates in places, so results can
// differ from the game in the last bits.
#pragma once

#include <cstdint>
#include <vector>

namespace otm::movie {

// Tuning constants, from Data\releasing_movies.ini [min_max] / [quality_overall] / [pre_production].
// The defaults are the values shipped with the game (docs/MOVIE_QUALITY.md); loading the ini is not implemented yet.
struct QualityTuning {
    float unspreadPerformanceMin = 0.75f;   // unspread_performance_min
    float unspreadPerformanceMax = 1.5f;    // unspread_performance_max
    float setRepairMin = 0.9f;              // set_repair_value_min
    float setRepairMax = 1.0f;              // set_repair_value_max
    float starGenreExperienceMin = 0.8f;    // star_genre_experience_min
    float starGenreExperienceMax = 1.2f;    // star_genre_experience_max
    float starRelationshipMin = 0.8f;       // star_relationship_min
    float starRelationshipMax = 1.2f;       // star_relationship_max
    float starRelationshipRangeWidth = 0.5f;// star_relationship_range_width
    float crewMin = 0.9f;                   // crew_min
    float crewMax = 1.1f;                   // crew_max
    float overallShifterMidPoint = 0.4f;    // quality_overall_shifter_mid_point
    float overallMaxShifter = 0.1f;         // quality_overall_max_shifter
    float overallMaxAdder = 0.8f;           // quality_overall_max_adder
    float preProductionTime = 300.0f;       // pre_production
};

// The five numbers a shot's rating is built from (fields +0xA4, +0xAC, +0xB0, +0xB4, +0xB8 of CQualityRating).
struct ProductionFactors {
    float castPerformance = 1.0f;   // +0xA4  about 1.0 when everyone is average
    float scriptQuality = 0.0f;     // +0xAC  0..1, the base of the rating
    float starRelationship = 1.0f;  // +0xB0  0.8..1.2
    float setCondition = 1.0f;      // +0xB4  0.9..1.0
    float crew = 1.0f;              // +0xB8  0.9..1.1
};

// One shot of the movie that has a scene state: its weight (SceneState_GetShotWeight) and its rating.
struct ShotRating {
    int32_t weight = 0;
    float quality = 0.0f;
};

// Everything CProject_ComputeFinalQuality reads from the project.
struct FinalQualityInput {
    bool hasPreProduction = false;      // project+0x348 is non-null
    uint32_t ticksInPreProduction = 0;  // project+0x35C
    float preProductionQuality = 0.0f;  // the pre-production record's rating (+0x90)
    std::vector<ShotRating> shots;      // only shots that have a controller and a scene state
};

float Clamp01(float v);

// CQualityRating +0xA8: the cast performance mapped to 0..1 for the post-release breakdown screen.
// orig: 0x005D75F0
float NormalizePerformance(float performance, const QualityTuning& t = {});

// CQualityRating +0xB4. repair is the set's repair value 0..1 (1.0 when the shot has no set).
float SetConditionFactor(float repair, const QualityTuning& t = {});

// CQualityRating +0xB8, the mapping part of CQualityRating_CrewFactor: meanMoviesTrait is the mean "Movies" trait of the crew.
// Collecting the crew and the fallback for "no crew record" (FUN_005D8E10) are not reimplemented.
// orig: 0x005D9130
float CrewFactor(float meanMoviesTrait, const QualityTuning& t = {});

// The mapping part of CQualityRating_StarRelationshipFactor. chemistrySum is the sum of the per-star chemistry values
// (QualityCalc_StarChemistry) over the lead cast stars plus the director if a star; counted is how many values were summed.
// With nobody counted the original skips the 0..1 mapping and returns the minimum (0.8), so a movie without stars gets the
// worst relationship factor, not a neutral one.
// orig: 0x005D9520
float StarRelationshipFactor(float chemistrySum, int counted, const QualityTuning& t = {});

// QualityCalc_GenreExperienceFactor: genre is the actor's trait for the movie's primary genre, otherGenres the traits for
// every other genre. Other genres add their mean, capped at half of the headroom (1 - genre).
// orig: 0x005D9390
float GenreExperienceFactor(float genre, const std::vector<float>& otherGenres, const QualityTuning& t = {});

// CQualityRating_CastPerformance: mean of the lead cast members' performance with the director counted once.
// orig: 0x005DC900
float AverageCastPerformance(const std::vector<float>& leadCastPerformance, float directorPerformance);

// Diminishing returns on the production bonus: linear below zero, above zero every further 0.1 is worth 20% less than the
// previous one (bounded by 0.4 with the default adder).
float DiminishingBonus(float x);

// The final formula of CQualityRating_Compute: the script quality is the base, production factors above 1.0 add a capped
// bonus, below 1.0 subtract linearly.
// orig: 0x005DCB10
float ComputeQuality(const ProductionFactors& f, const QualityTuning& t = {});

// Share of the pre-production rating that counts after the movie spent this many updates in pre-production
// (0 at the start, 1 at preProductionTime * 10 updates; ease-out cubic).
float PreProductionWeight(uint32_t ticksInPreProduction, const QualityTuning& t = {});

// The movie's final quality, frozen when it enters post-production: 25% pre-production (weighted by time spent) plus 75% of
// the shot ratings averaged by shot weight, clamped to 0..1. Award bonuses are added afterwards by other code.
// orig: 0x005B6FB0 verified
float ComputeFinalQuality(const FinalQualityInput& in, const QualityTuning& t = {});

}  // namespace otm::movie
