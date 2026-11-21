// Tests for game/staff: traits and experience, stunts, star rating, and the staff tuning loader. The first part uses inline values
// and doc examples and always runs. The last part loads the real game files from $OTM_GAME_DATA (see tools/pak_extract.py) and is
// skipped (exit 77) when they are not there.
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <type_traits>

#include "game/staff/StaffTuningLoader.hpp"

using namespace otm;
using namespace otm::staff;

static int g_failures = 0;

#define CHECK(cond)                                             \
    do {                                                        \
        if (!(cond)) {                                          \
            std::printf("FAIL line %d: %s\n", __LINE__, #cond); \
            ++g_failures;                                       \
        }                                                       \
    } while (0)

static bool Near(double a, double b, double tol = 1e-5) { return std::fabs(a - b) <= tol; }

#define NEAR(a, b, tol)                                                                              \
    do {                                                                                             \
        const double va_ = (a), vb_ = (b);                                                           \
        if (!Near(va_, vb_, tol)) {                                                                  \
            std::printf("FAIL line %d: %s = %.6f, want %.6f (+-%g)\n", __LINE__, #a, va_, vb_, (double)(tol)); \
            ++g_failures;                                                                            \
        }                                                                                            \
    } while (0)

template <class T>
static void ExpectSame(const char* what, const T& loaded, const T& defaults) {
    static_assert(std::is_standard_layout<T>::value && sizeof(T) % sizeof(float) == 0, "float-only struct");
    const size_t n = sizeof(T) / sizeof(float);
    float a[128], b[128];
    std::memcpy(a, &loaded, sizeof(T));
    std::memcpy(b, &defaults, sizeof(T));
    for (size_t i = 0; i < n; ++i) {
        if (!Near(a[i], b[i], 1e-6)) {
            std::printf("FAIL %s: field %zu is %.6f in the game files but %.6f in the defaults\n", what, i, a[i], b[i]);
            ++g_failures;
        }
    }
}

int main() {
    // ---- traits (docs/TRAITS_AND_EXPERIENCE.md section 1) ----
    {
        TraitMap t;
        CHECK(!t.Has("Stunts"));
        NEAR(t.Get("Stunts"), 0.0, 0.0);                    // a missing trait reads as 0
        t.Set("Stunts", 1.5f);
        NEAR(t.Get("Stunts"), 1.0, 0.0);                    // Set clamps to 0..1
        t.Set("Stunts", -0.2f);
        NEAR(t.Get("Stunts"), 0.0, 0.0);
        // "a 0.026 lead-role gain moves a 0.5 skill by 0.013 and a 0.9 skill by 0.0026"
        t.Set("comedy", 0.5f);
        NEAR(t.Add("comedy", 0.026f), 0.013, 1e-6);
        NEAR(t.Get("comedy"), 0.513, 1e-6);
        t.Set("action", 0.9f);
        NEAR(t.Add("action", 0.026f), 0.0026, 1e-6);
        NEAR(t.Get("action"), 0.9026, 1e-6);
        // a trait that does not exist starts at the gain
        TraitMap fresh;
        NEAR(fresh.Add("horror", 0.1f), 0.1, 1e-6);
        NEAR(fresh.Get("horror"), 0.1, 1e-6);
        // the experience award bonus multiplies the gain
        TraitMap boosted;
        boosted.Set("Movies", 0.0f);
        NEAR(boosted.Add("Movies", 0.1f, 1.1f), 0.11, 1e-6);
        // a skill never exceeds 1
        TraitMap capped;
        capped.Set("Stunts", 0.99f);
        for (int i = 0; i < 100; ++i) capped.Add("Stunts", 0.5f);
        CHECK(capped.Get("Stunts") <= 1.0f);
        CHECK(capped.Get("Stunts") > 0.999f);
        TraitMap cs;
        cs.Set("Stunts", 0.5f);
        CHECK(!cs.Has("stunts"));                           // names are case-sensitive
    }

    // ---- experience table ----
    {
        ExperienceTable e;
        NEAR(e.Get(Experience::MoviesLeadRole), 0.026, 1e-7);
        NEAR(e.Get(Experience::MoviesStuntman), 0.013, 1e-7);
        NEAR(e.Get(Experience::SetRehearseTime), 1.0, 0.0);  // 600 is clamped to 1 by ExperienceTable_Get
        e.values[0] = -0.5f;
        NEAR(e.Get(Experience::LotPerHammerBuild), 0.0, 0.0);
        NEAR(GenreExperienceGain(CastRole::Director, false, ExperienceTable{}), 0.026, 1e-7);
        NEAR(GenreExperienceGain(CastRole::Lead, false, ExperienceTable{}), 0.026, 1e-7);
        NEAR(GenreExperienceGain(CastRole::Support, false, ExperienceTable{}), 0.013, 1e-7);
        NEAR(GenreExperienceGain(CastRole::Other, false, ExperienceTable{}), 0.013, 1e-7);
        NEAR(GenreExperienceGain(CastRole::Lead, true, ExperienceTable{}), 0.7 * 0.026, 1e-7);  // a stuntman learns 70%
    }

    // ---- stunt roll (docs/STUNT_SYSTEM.md section 2) ----
    {
        const StuntTuning t;
        // worked numbers from the doc
        NEAR(StuntSuccessChance(0.5f, 0.5f, false, t), 0.80, 1e-6);   // equal to the difficulty: 80%
        NEAR(StuntSuccessChance(0.5f, 0.5f, true, t), 0.90, 1e-6);    // with a lucky charm 90%
        NEAR(StuntSuccessChance(0.0f, 0.5f, false, t), 0.20, 1e-6);   // 0.5 below: 0.80 - 0.60
        NEAR(StuntSuccessChance(0.0f, 1.0f, false, t), 0.05, 1e-6);   // 1.0 below: clamped to 5%
        NEAR(StuntSuccessChance(1.0f, 0.5f, false, t), 0.95, 1e-6);   // 0.5 above: 0.95
        NEAR(StuntSuccessChance(1.0f, 0.2f, false, t), 0.98, 1e-6);   // 0.8 above: capped at 98%
        NEAR(StuntSuccessChance(0.5f, 0.4f, false, t), 0.83, 1e-6);   // "0.1 above gives 83%"
        NEAR(StuntSuccessChance(0.4f, 0.5f, false, t), 0.68, 1e-6);   // "0.1 below gives 68%"
        NEAR(StuntSuccessChance(0.5f, 0.6f, true, t), 0.78, 1e-6);    // lucky charm adds a flat 10 points
        // performers' scores
        NEAR(StuntActorScore(1.0f, 1.0f, t), 1.0, 1e-6);              // best skill, full health
        NEAR(StuntActorScore(1.0f, 0.0f, t), 0.35, 1e-6);             // no health: ability 0.5, injured x0.7
        NEAR(StuntActorScore(0.8f, 0.5f, t), 0.8 * 0.75, 1e-6);       // ability 0.5 + 0.5 * 0.5
        NEAR(StuntActorScore(0.8f, 0.01f, t), 0.8 * (0.5 + 0.5 * 0.01), 1e-6);  // at the threshold: not injured
        NEAR(StuntActorScore(0.0f, 1.0f, t), 0.0, 0.0);
        // the random generator (values computed independently from the constants)
        uint32_t seed = 1;
        NEAR(NextRandomUnit(seed), 0.8916441983729, 1e-6);
        CHECK(seed == 1015568748u);
        NEAR(NextRandomUnit(seed), 0.9541654231066999, 1e-6);
        NEAR(NextRandomUnit(seed), 0.0339361458961, 1e-6);
        // a roll: no performer, nothing rolled
        seed = 7;
        StuntRoll none = RollStuntOutcome({}, 0.5f, false, seed, t);
        CHECK(!none.rolled && !none.failed);
        CHECK(seed == 7u);                                            // the generator is not advanced
        // a roll with a known draw: seed 1 gives 0.8916 on the first draw
        seed = 1;
        StuntRoll r = RollStuntOutcome({0.5f, 0.5f}, 0.5f, false, seed, t);  // chance 0.80, draw 0.8916 >= 0.80: failure
        CHECK(r.rolled && r.failed);
        NEAR(r.castScore, 0.5, 1e-6);
        NEAR(r.chance, 0.8, 1e-6);
        seed = 1;
        r = RollStuntOutcome({0.5f}, 0.5f, true, seed, t);             // chance 0.90, draw 0.8916 < 0.90: success
        CHECK(r.rolled && !r.failed);
        // the cast score is the mean of the performers
        seed = 1;
        r = RollStuntOutcome({0.2f, 0.8f}, 0.5f, false, seed, t);
        NEAR(r.castScore, 0.5, 1e-6);
        // over many rolls the success rate matches the chance (score / difficulty pairs for chances 0.2, 0.8 and 0.95)
        struct Case { float score, difficulty; double chance; };
        for (const Case c : {Case{0.0f, 0.5f, 0.20}, Case{0.5f, 0.5f, 0.80}, Case{1.0f, 0.5f, 0.95}}) {
            uint32_t s = 20061;
            int ok = 0;
            const int n = 200000;
            for (int i = 0; i < n; ++i) ok += RollStuntOutcome({c.score}, c.difficulty, false, s, t).failed ? 0 : 1;
            NEAR(static_cast<double>(ok) / n, c.chance, 0.005);
        }
    }

    // ---- injuries (docs/STUNT_SYSTEM.md section 5) ----
    {
        const StuntTuning t;
        NEAR(StuntHealthLoss(1.0f, 0.1f, true, t), 0.10, 1e-6);       // skilled actor, easy stunt: about 0.10 even on failure
        NEAR(StuntHealthLoss(0.0f, 1.0f, true, t), 0.80, 1e-6);       // unskilled, hard: up to 0.80
        NEAR(StuntHealthLoss(0.0f, 1.0f, false, t), 0.20, 1e-6);      // success: 0.10 .. 0.20
        NEAR(StuntHealthLoss(0.0f, 0.0f, true, t), 0.10, 1e-6);
        NEAR(StuntHealthLoss(0.5f, 0.55f, true, t), 0.1 + 0.7 * (0.55 - 0.15), 1e-6);  // skill reduces the danger by 0.3 * skill
        CHECK(StuntHealthLoss(0.3f, 0.9f, true, t) > StuntHealthLoss(0.3f, 0.5f, true, t));  // harder is worse
        CHECK(StuntHealthLoss(0.9f, 0.9f, true, t) < StuntHealthLoss(0.1f, 0.9f, true, t));  // skill helps
    }

    // ---- stunt experience (docs/STUNT_SYSTEM.md section 5) ----
    {
        const StuntTuning t;
        NEAR(StuntExperienceGain(1.0f, true, true, -1.0f, t), 0.06, 1e-6);    // stuntman, hardest, success
        NEAR(StuntExperienceGain(0.0f, true, true, -1.0f, t), 0.02, 1e-6);
        NEAR(StuntExperienceGain(1.0f, false, true, -1.0f, t), 0.04, 1e-6);
        NEAR(StuntExperienceGain(0.0f, false, true, -1.0f, t), 0.01, 1e-6);
        NEAR(StuntExperienceGain(1.0f, true, false, -1.0f, t), 0.06 * 0.7, 1e-6);   // an actor learns 70%
        NEAR(StuntExperienceGain(1.0f, true, false, 1.2f, t), 0.06 * 1.2 * 0.7, 1e-6);  // natural talent
        CHECK(StuntExperienceGain(0.5f, true, true, -1.0f, t) > StuntExperienceGain(0.5f, false, true, -1.0f, t));
        TraitMap traits;
        traits.Set("Stunts", 0.5f);
        const float gain = AddStuntExperience(traits, 1.0f, true, true, -1.0f, 1.0f, t);
        NEAR(gain, 0.5 * 0.06, 1e-6);
        NEAR(traits.Get("Stunts"), 0.53, 1e-6);
        // training
        NEAR(StuntTrainingXp(0.5f, 0.5f, true, 1.0f, -1.0f, t), 0.04, 1e-6);          // perfect match: top of the range
        NEAR(StuntTrainingXp(1.0f, 0.0f, true, 1.0f, -1.0f, t), 0.005, 1e-6);         // no match: -0.04, raised to the minimum
        NEAR(StuntTrainingXp(0.5f, 0.5f, false, 1.0f, -1.0f, t), 0.03, 1e-6);         // failure range is smaller
        NEAR(StuntTrainingXp(0.5f, 0.5f, true, 0.0f, -1.0f, t), 0.004, 1e-6);         // injured: x0.1
        NEAR(StuntTrainingXp(0.5f, 0.5f, true, 1.0f, 1.2f, t), 0.048, 1e-6);          // natural talent
        NEAR(StuntTrainingXp(0.5f, 0.0f, true, 1.0f, -1.0f, t), 0.005, 1e-6);          // half match: 0.0, raised to the minimum
        CHECK(StuntTrainingXp(0.5f, 0.0f, true, 1.0f, -1.0f, t) >= 0.005f);
    }

    // ---- star rating (docs/MOVIE_SUCCESS.md 3aa-3ac) ----
    {
        const StarRatingTuning t;
        StarComponents none;
        NEAR(ComputeStarRating(none, 0.0f, t), 0.0, 0.0);
        StarComponents all;
        all.movies = all.salary = all.performance = all.image = all.entourage = all.trailer = all.pressBar = all.relationships = all.awards = 1.0f;
        NEAR(ComputeStarRating(all, 0.0f, t), 1.0, 0.0);              // the weights add up to 1.006: capped at 1
        StarComponents movies;
        movies.movies = 1.0f;
        NEAR(ComputeStarRating(movies, 0.0f, t), 0.174, 1e-6);
        StarComponents mixed;
        mixed.movies = 0.5f;
        mixed.salary = 1.0f;
        mixed.entourage = 0.5f;
        NEAR(ComputeStarRating(mixed, 0.0f, t), 0.174 * 0.5 + 0.139 + 0.104 * 0.5, 1e-6);
        NEAR(ComputeStarRating(movies, 0.2f, t), 0.374, 1e-6);        // base term is added and clamped
        NEAR(ComputeStarRating(all, 0.5f, t), 1.0, 0.0);
        StarComponents wild;
        wild.movies = 5.0f;                                           // components are clamped to 0..1 first
        NEAR(ComputeStarRating(wild, 0.0f, t), 0.174, 1e-6);
        // components
        NEAR(EntourageComponent(0, t), 0.0, 0.0);
        NEAR(EntourageComponent(3, t), 0.5, 1e-6);
        NEAR(EntourageComponent(6, t), 1.0, 1e-6);
        NEAR(EntourageComponent(9, t), 1.0, 0.0);                     // six members give the full value
        NEAR(AwardsComponent(1, t), 0.5263158, 1e-6);
        NEAR(AwardsComponent(2, t), 1.0, 0.0);                        // two awards cap it
        // films feed the movies component (docs 3ac): S = 0.8 gains 0.32, a flop S = 0.3 only 0.12
        movie::DecayValue v = NewRatingValue(t);
        AddFilmRating(v, 0.8f, 1930.0, t);
        NEAR(RatingComponent(v, 1930.0), 0.32, 1e-6);
        NEAR(RatingComponent(v, 1940.0), 0.16, 1e-6);                 // halves after ten years
        AddFilmRating(v, 0.8f, 1932.0, t);                            // "two such films within a few years push it near 0.6"
        NEAR(RatingComponent(v, 1932.0), 0.32 * std::exp2(-0.2) + 0.32, 1e-5);
        CHECK(RatingComponent(v, 1932.0) > 0.55f && RatingComponent(v, 1932.0) < 0.65f);
        AddFilmRating(v, 0.8f, 1934.0, t);                            // "three near 0.9"
        CHECK(RatingComponent(v, 1934.0) > 0.8f && RatingComponent(v, 1934.0) < 0.9f);
        movie::DecayValue flop = NewRatingValue(t);
        AddFilmRating(flop, 0.3f, 1930.0, t);
        NEAR(RatingComponent(flop, 1930.0), 0.12, 1e-6);
        AddFilmRating(flop, 3.0f, 1930.0, t);                         // success above 1 counts as 1: 0.4
        NEAR(RatingComponent(flop, 1930.0), 0.12 + 0.4, 1e-6);
    }

    // ---- loader, inline sources ----
    {
        StaffTuningSources s;
        s.experience = core::IniFile::Parse("MOVIES_LEADROLE = 0.05\nSTARS_EXPERIENCE_DECAY = 0.01\n");
        s.stunts = core::IniFile::Parse("healththreshold = 0.1\n[successfailure]\nstuntchancemax = 0.9\n[training]\nlowhealthmultiplier = 0.2\n");
        s.global = core::IniFile::Parse("[star]\nratingshalflife = 5\nstarratingweightmovies = 0.3\n");
        s.awardsBonuses = core::IniFile::Parse("natural_talent_factor = 1.5\n");
        std::vector<std::string> problems;
        const StaffTuning t = BuildStaffTuning(s, problems);
        NEAR(t.experience.Get(Experience::MoviesLeadRole), 0.05, 1e-7);
        NEAR(t.experience.starsExperienceDecay, 0.01, 1e-7);          // key names are case-insensitive
        NEAR(t.stunts.healthThreshold, 0.1, 1e-7);
        NEAR(t.stunts.chanceMax, 0.9, 1e-7);
        NEAR(t.stunts.trainingLowHealthMultiplier, 0.2, 1e-7);
        NEAR(t.starRating.ratingsHalfLife, 5.0, 1e-7);
        NEAR(t.starRating.weightMovies, 0.3, 1e-7);
        NEAR(t.bonuses.naturalTalent, 1.5, 1e-7);
        NEAR(t.stunts.chanceLow, StuntTuning{}.chanceLow, 0.0);       // missing keys keep their defaults ...
        CHECK(!problems.empty());                                     // ... and are reported
        std::vector<std::string> none;
        LoadStaffTuning("/definitely/not/a/directory", none);
        CHECK(!none.empty());
    }

    // ---- the real game files ----
    const char* dir = std::getenv("OTM_GAME_DATA");
    bool real = false;
    if (dir) {
        core::IniFile probe;
        real = core::IniFile::Load(std::string(dir) + "/experience.ini", probe);
    }
    if (!real) {
        std::printf("game files not found (set OTM_GAME_DATA): skipping the checks against the real data\n");
        if (g_failures) {
            std::printf("%d check(s) failed\n", g_failures);
            return 1;
        }
        std::printf("inline checks passed\n");
        return 77;
    }
    std::vector<std::string> problems;
    const StaffTuning t = LoadStaffTuning(dir, problems);
    for (const std::string& p : problems) std::printf("problem: %s\n", p.c_str());
    CHECK(problems.empty());
    // The defaults in the headers were copied from the docs: they must equal what the installed game ships.
    ExpectSame("ExperienceTable", t.experience, ExperienceTable{});
    ExpectSame("StuntTuning", t.stunts, StuntTuning{});
    ExpectSame("StarRatingTuning", t.starRating, StarRatingTuning{});
    ExpectSame("StaffBonusTuning", t.bonuses, StaffBonusTuning{});

    if (g_failures) {
        std::printf("%d check(s) failed\n", g_failures);
        return 1;
    }
    std::printf("all Staff checks passed\n");
    return 0;
}
