// How one actor's (or stunt performer's) contribution to a shot's quality is computed: the inputs that
// MovieQuality::AverageCastPerformance and MovieQuality::StarRelationshipFactor consume.
//
// Reimplemented from QualityCalc_ActorPerformance, CStar_GetMoodPerformanceFactor, the genre-fit and star chemistry helpers
// and the stunt performance factors. Derivation: docs/MOVIE_QUALITY.md section 3, docs/TRAITS_AND_EXPERIENCE.md section 3.
//
// Pure arithmetic again: the numbers that need game objects (an actor's traits, mood, age, the cast list) are parameters.
// Nothing here is marked "verified": no measurement from the running game isolates these functions (the logs only cover
// the totals), so they follow the decompiled code. Where the decompiled code disagrees with the older notes the comments say so.
#pragma once

#include <vector>

#include "game/movie/MovieQuality.hpp"

namespace otm::movie {

// Tuning constants: releasing_movies.ini [min_max] (mood, genre fit) and stunts.ini [performance] / [likeness].
struct ActorTuning {
    float starMoodMin = 0.8f;                 // star_mood_min
    float starMoodMax = 1.2f;                 // star_mood_max
    float starMoodStep = 0.25f;               // star_mood_step: width of the outer mood bands
    float genreFitMin = 0.9f;                 // stars' genre fit min
    float genreFitMax = 1.1f;                 // stars' genre fit max
    float genreFitMaxFromIdeal = 0.5f;        // [genre_fit] max_from_ideal: GenreFitScore's k is 1 / this
    float stuntSkillMin = 0.9f;               // stuntskillminimum
    float stuntSkillMax = 1.1f;               // stuntskillmaximum
    float healthMin = 0.9f;                   // healthminimum
    float healthMax = 1.1f;                   // healthmaximum
    float healthInjuryMultiplier = 0.9f;      // injurymultiplier
    float healthThreshold = 0.01f;            // healththreshold: below this the performer counts as injured
    float likenessMin = 0.9f;                 // likenessminimum
    float likenessMax = 1.0f;                 // likenessmaximum
    float likenessBonus = 1.1f;               // likenessbonus: the star doubles for themselves
    float successMin = 0.8f;                  // successminimum: the take failed
    float successMax = 1.25f;                 // successmaximum: the take succeeded
    float levelMin = 0.9f;                    // stuntlevelminimum
    float levelMax = 1.4f;                    // stuntlevelmaximum
    float releaseScreenMin = 0.6f;            // releasescreenminbound
    float releaseScreenMax = 2.0f;            // releasescreenmaxbound
    float genderFactor = 0.5f;                // likeness weights (they sum to 1)
    float sexFactor = 0.1f;
    float weightFactor = 0.1f;
    float ageFactor = 0.15f;
    float looksFactor = 0.15f;
};

// The record QualityCalc_ActorPerformance builds for one actor (0x90 bytes, kept for the release screen).
struct ActorPerformance {
    float genreExperience = 1.0f;   // +0x7C  0.8..1.2
    float genreFit = 1.0f;          // +0x80  0.9..1.1 (the older notes called this the cast relationship factor; it is not)
    float mood = 1.0f;              // +0x8C  0.8..1.2
    float normalized = 0.0f;        // +0x88  the product mapped to 0..1 for display
    float starRating = -1.0f;       // +0x84  -1 for extras
    float performance = 0.0f;       // what the quality rating averages: genreExperience * genreFit * mood
};

// QualityCalc_ActorPerformance, after the three factors are known. Extras use starMoodMin as their mood and have no rating.
// orig: 0x005DB140
ActorPerformance ComputeActorPerformance(float genreExperience, float genreFit, float mood, float starRating,
                                         const QualityTuning& q = {});

// CStar_GetMoodPerformanceFactor: the star's mood (0..1) mapped onto 0.8..1.2 in three bands. Below the lower mood threshold
// the first band (width (1 - 2 * step) / 3) is used, between the thresholds a middle band centred on 0.5, above the upper
// threshold a top band reaching 1.0; each band is linear inside and the bands do not join up (the curve has steps).
// The older notes said the middle was flat; the code interpolates it between the thresholds (factor 0.97 .. 1.03 with the
// shipped step 0.25). Any value outside 0..1 gives starMoodMin.
// orig: 0x005D79A0
float MoodPerformanceFactor(float mood, float lowerThreshold, float upperThreshold, const ActorTuning& t = {});

// The genre-fit score of a character against the movie's genre: the mean of three terms 1 - |difference| * k, where k is
// 1 / max_from_ideal ([genre_fit]) and the differences are how far the character's age/looks/body are from the genre's ideal.
// Perfect Fit (award bonus 7) multiplies the result; pass < 0 for "not active". Gathering the three differences from a
// character is not reimplemented, and the tuning value max_from_ideal is not decoded, so k is a parameter.
// orig: 0x005882E0
// orig: 0x0056F940
float GenreFitScore(float diff1, float diff2, float diff3, float k, float perfectFitMultiplier = -1.0f);

// FUN_005D7B90 / FUN_005D7CB0: the genre-fit factor of an actor, 0.9..1.1. The director always gets 1.0; a character who is
// neither star nor extra gets the minimum. (The older notes called this the actor's relationship with the cast.)
// orig: 0x005D7B90
// orig: 0x005D7CB0
float GenreFitFactor(float fitScore, bool isDirector, bool isStarOrExtra = true, const ActorTuning& t = {});

// QualityCalc_StarChemistry: mean of the stored relationship values between this star and the other lead cast stars;
// the director (if a star, and not excluded) counts double. 0.5 when there is nobody to compare with.
// orig: 0x005D87A0
// orig: 0x005D8C80
float StarChemistry(const std::vector<float>& otherStarRelationships, const float* directorRelationship);

// CQualityRating_CrewFactor input / FUN_005D8E10: the mean of the crew members' "Movies" trait, 0 when there are none.
// orig: 0x005D8E10
float MeanMoviesTrait(const std::vector<float>& crewMoviesTrait);

// ---- Stunt performance (a stunt shot's actor score; docs/TRAITS_AND_EXPERIENCE.md section 3) ----

// What QualityCalc_ComputeLikeness compares between the stunt double and the star (current costume values).
struct LikenessTraits {
    bool female = false;
    float age = 0.0f;
    float weight = 0.0f;
    float looks = 0.0f;
    float sexAppeal = 0.0f;
};

// orig: 0x00597820
float Likeness(const LikenessTraits& a, const LikenessTraits& b, const ActorTuning& t = {});

// 0.9 + 0.1 * likeness; 1.1 when the star does the stunt themselves (or there is no double and no star).
// orig: 0x005D78A0
float LikenessFactor(float likeness, bool sameActor, const ActorTuning& t = {});

// 0.9 + 0.2 * health, times the injury multiplier below the health threshold; a missing performer gets the minimum.
// orig: 0x005D7920
float HealthFactor(float health, bool noPerformer, const ActorTuning& t = {});

// 0.9 + 0.2 * the "Stunts" trait; a missing performer gets the minimum.
// orig: 0x005D8920
float StuntSkillFactor(float stuntsTrait, bool noPerformer, const ActorTuning& t = {});

// Success factor of the take: 1.25 if it succeeded, 0.8 if it failed.
float StuntSuccessFactor(bool succeeded, const ActorTuning& t = {});

// Level factor from the scene's stunt difficulty (0..1): 0.9 + clamp01((1.4 - 0.9) * difficulty), as documented in
// TRAITS_AND_EXPERIENCE.md. The decompiled QualityCalc_StuntPerformance only shows a clamp01 of its difficulty argument
// followed by a multiplication; the floating-point mapping to 0.9..1.4 is not visible there (x87 code), so the documented
// formula is used. Not verified against the running game.
float StuntLevelFactor(float difficulty, const ActorTuning& t = {});

// QualityCalc_StuntPerformance: skill * (health * likeness) * level * success, with the level factor derived from the
// scene's stunt difficulty. A perfect shot scores about 2.3, a poor failed one about 0.5.
// orig: 0x005D8BD0
float StuntPerformance(float skillFactor, float healthFactor, float likenessFactor, float difficulty, bool succeeded,
                       const ActorTuning& t = {});

// ReleaseScreen_NormalizeScore: a stunt score clamped to 0.6..2.0 and mapped to 0..1.
// orig: 0x006F9CF0
float NormalizeStuntScore(float score, const ActorTuning& t = {});

}  // namespace otm::movie
