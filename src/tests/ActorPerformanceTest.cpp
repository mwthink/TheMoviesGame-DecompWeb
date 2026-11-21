// Checks ActorPerformance against the worked examples in docs/TRAITS_AND_EXPERIENCE.md (stunts, likeness) and hand-computed
// values for the formulas the notes do not give numbers for (mood bands, chemistry, genre fit).
#include <cmath>
#include <cstdio>

#include "game/movie/ActorPerformance.hpp"

using namespace otm::movie;

static int g_failures = 0;

static void Near(const char* what, double got, double want, double tol) {
    if (!(std::fabs(got - want) <= tol)) {
        std::printf("FAIL %s: got %.6f, want %.6f (+-%g)\n", what, got, want, tol);
        ++g_failures;
    }
}

int main() {
    // ---- Likeness (docs/TRAITS_AND_EXPERIENCE.md 3b, "consequences") ----
    {
        LikenessTraits star{false, 30.0f, 70.0f, 0.5f, 0.5f};
        Near("identical characters", Likeness(star, star), 1.0, 1e-6);
        LikenessTraits other = star;
        other.female = true;
        Near("gender mismatch alone costs 0.5", Likeness(star, other), 0.5, 1e-6);
        Near("... factor 0.95", LikenessFactor(Likeness(star, other), false), 0.95, 1e-6);
        other = star;
        other.age = 60.0f;
        Near("30 year age gap: 0.15 * 0.6", Likeness(star, other), 1.0 - 0.09, 1e-6);
        Near("... factor 0.991", LikenessFactor(Likeness(star, other), false), 0.991, 1e-6);
        other = star;
        other.weight = 110.0f;
        Near("40 unit weight gap: factor 0.996", LikenessFactor(Likeness(star, other), false), 0.996, 1e-6);
        LikenessTraits worst{true, 100.0f, 200.0f, 1.0f, 1.0f};
        LikenessTraits best{false, 0.0f, 0.0f, 0.0f, 0.0f};
        Near("total mismatch", Likeness(best, worst), 0.0, 1e-6);
        Near("... reaches the 0.9 floor", LikenessFactor(0.0f, false), 0.9, 1e-6);
        Near("the star doubling for themselves", LikenessFactor(1.0f, true), 1.1, 1e-6);
        Near("a good double is still -9%", LikenessFactor(1.0f, false), 1.0, 1e-6);
    }

    // ---- Stunt performance ----
    {
        Near("skill factor, no skill", StuntSkillFactor(0.0f, false), 0.9, 1e-6);
        Near("skill factor, expert", StuntSkillFactor(1.0f, false), 1.1, 1e-6);
        Near("skill factor, nobody", StuntSkillFactor(1.0f, true), 0.9, 1e-6);
        Near("health factor, healthy", HealthFactor(1.0f, false), 1.1, 1e-6);
        Near("health factor, half", HealthFactor(0.5f, false), 1.0, 1e-6);
        Near("health factor, injured", HealthFactor(0.005f, false), (0.9 + 0.2 * 0.005) * 0.9, 1e-6);
        Near("health factor, nobody", HealthFactor(1.0f, true), 0.9, 1e-6);
        Near("success factor", StuntSuccessFactor(true), 1.25, 1e-6);
        Near("failure factor", StuntSuccessFactor(false), 0.8, 1e-6);
        Near("level factor, easy", StuntLevelFactor(0.0f), 0.9, 1e-6);
        Near("level factor, hardest", StuntLevelFactor(1.0f), 1.4, 1e-6);
        // "a perfect-looking stunt shot (1.1 x 1.1 x 1.1 x 1.4 x 1.25 about 2.3)"
        Near("perfect stunt shot", StuntPerformance(1.1f, 1.1f, 1.1f, 1.0f, true), 1.1 * 1.1 * 1.1 * 1.4 * 1.25, 1e-5);
        Near("poor failed stunt shot", StuntPerformance(0.9f, 0.9f, 0.9f, 0.0f, false), 0.9 * 0.9 * 0.9 * 0.9 * 0.8, 1e-5);
        Near("normalise: bottom", NormalizeStuntScore(0.47f), 0.0, 0.0);
        Near("normalise: top", NormalizeStuntScore(2.3f), 1.0, 0.0);
        Near("normalise: middle", NormalizeStuntScore(1.3f), 0.5, 1e-6);
    }

    // ---- Mood bands (shipped step 0.25: outer band width 1/6; middle band 0.41667..0.58333) ----
    {
        // thresholds as capped by Easy To Please: lower 0.15, upper 0.75
        Near("mood 0 (worst)", MoodPerformanceFactor(0.0f, 0.15f, 0.75f), 0.8, 1e-6);
        Near("mood just below the lower threshold", MoodPerformanceFactor(0.1499f, 0.15f, 0.75f), 0.8 + 0.4 * (1.0 / 6.0), 1e-3);
        Near("mood at the lower threshold", MoodPerformanceFactor(0.15f, 0.15f, 0.75f), 0.8 + 0.4 * (0.25 + 1.0 / 6.0), 1e-6);
        Near("mood in the middle", MoodPerformanceFactor(0.45f, 0.15f, 0.75f), 0.8 + 0.4 * (5.0 / 12.0 + (1.0 / 6.0) * 0.5), 1e-6);
        Near("mood at the upper threshold", MoodPerformanceFactor(0.75f, 0.15f, 0.75f), 0.8 + 0.4 * (5.0 / 6.0), 1e-6);
        Near("mood 1 (best)", MoodPerformanceFactor(1.0f, 0.15f, 0.75f), 1.2, 1e-6);
        Near("mood out of range", MoodPerformanceFactor(1.5f, 0.15f, 0.75f), 0.8, 1e-6);
        Near("threshold out of range", MoodPerformanceFactor(0.5f, -0.1f, 0.75f), 0.8, 1e-6);
        Near("upper threshold 1", MoodPerformanceFactor(1.0f, 0.3f, 1.0f), 1.2, 1e-6);
        // Steps: happier is never worse inside a band, and each band starts above where the previous ended.
        float prev = 0.0f;
        for (int i = 0; i <= 100; ++i) {
            const float m = i / 100.0f;
            const float f = MoodPerformanceFactor(m, 0.25f, 0.75f);
            if (f < 0.8f - 1e-6f || f > 1.2f + 1e-6f) {
                std::printf("FAIL mood factor out of 0.8..1.2 at %.2f: %.4f\n", m, f);
                ++g_failures;
            }
            if (f + 1e-6f < prev) {
                std::printf("FAIL mood factor decreases at %.2f: %.4f < %.4f\n", m, f, prev);
                ++g_failures;
            }
            prev = f;
        }
    }

    // ---- Genre fit and the actor record ----
    {
        Near("fit score, perfect", GenreFitScore(0.0f, 0.0f, 0.0f, 2.0f), 1.0, 1e-6);
        Near("fit score, halfway", GenreFitScore(0.25f, 0.25f, 0.25f, 2.0f), 0.5, 1e-6);
        Near("fit score, mixed", GenreFitScore(0.0f, 0.5f, 1.0f, 1.0f), (1.0 + 0.5 + 0.0) / 3.0, 1e-6);
        Near("fit score, far off", GenreFitScore(2.0f, 2.0f, 2.0f, 1.0f), 0.0, 0.0);
        Near("fit score, perfect fit bonus clamps", GenreFitScore(0.0f, 0.0f, 0.0f, 1.0f, 1.2f), 1.0, 0.0);
        Near("fit score, perfect fit bonus", GenreFitScore(0.25f, 0.25f, 0.25f, 2.0f, 1.2f), 0.6, 1e-6);
        Near("fit factor, best", GenreFitFactor(1.0f, false), 1.1, 1e-6);
        Near("fit factor, worst", GenreFitFactor(0.0f, false), 0.9, 1e-6);
        Near("fit factor, director is neutral", GenreFitFactor(0.0f, true), 1.0, 0.0);
        Near("fit factor, neither star nor extra", GenreFitFactor(1.0f, false, false), 0.9, 1e-6);

        ActorPerformance p = ComputeActorPerformance(1.2f, 1.1f, 1.2f, 0.7f);
        Near("performance is the product", p.performance, 1.2 * 1.1 * 1.2, 1e-5);
        Near("normalised performance", p.normalized, (1.2 * 1.1 * 1.2 - 0.75) / 0.75 > 1.0 ? 1.0 : (1.2 * 1.1 * 1.2 - 0.75) / 0.75, 1e-5);
        p = ComputeActorPerformance(0.8f, 0.9f, 0.8f, -1.0f);
        Near("weak extra", p.performance, 0.8 * 0.9 * 0.8, 1e-6);
        Near("weak extra normalises to 0", p.normalized, 0.0, 0.0);
        Near("average actor", ComputeActorPerformance(1.0f, 1.0f, 1.0f, 0.5f).normalized, (1.0 - 0.75) / 0.75, 1e-6);
    }

    // ---- Chemistry and crew ----
    {
        Near("nobody to compare with", StarChemistry({}, nullptr), 0.5, 0.0);
        Near("one friend", StarChemistry({0.8f}, nullptr), 0.8, 1e-6);
        Near("two stars averaged", StarChemistry({0.8f, 0.4f}, nullptr), 0.6, 1e-6);
        const float director = 0.2f;
        Near("director counts double", StarChemistry({0.8f}, &director), (0.8 + 2 * 0.2) / 3.0, 1e-6);
        Near("director alone", StarChemistry({}, &director), 0.2, 1e-6);
        Near("crew mean", MeanMoviesTrait({0.1f, 0.3f}), 0.2, 1e-6);
        Near("no crew", MeanMoviesTrait({}), 0.0, 0.0);
    }

    // ---- The quality chain end to end: a shot built from these pieces ----
    {
        const ActorPerformance lead = ComputeActorPerformance(1.0f, 1.05f, 1.0f, 0.6f);
        const ActorPerformance director = ComputeActorPerformance(1.0f, 1.0f, 1.0f, 0.4f);
        const float cast = AverageCastPerformance({lead.performance}, director.performance);
        Near("cast performance of lead + director", cast, (1.05 + 1.0) / 2.0, 1e-6);
        ProductionFactors f;
        f.castPerformance = cast;
        f.scriptQuality = 0.6f;
        f.starRelationship = StarRelationshipFactor(StarChemistry({}, nullptr), 1);
        f.setCondition = SetConditionFactor(1.0f);
        f.crew = CrewFactor(MeanMoviesTrait({0.5f, 0.5f}));
        Near("neutral chemistry gives 1.0", f.starRelationship, 1.0, 1e-6);
        const float q = ComputeQuality(f);
        if (!(q > 0.568f && q < 1.0f)) {  // above the all-neutral 0.568 because cast and crew are slightly better than average
            std::printf("FAIL end-to-end shot quality %.4f\n", q);
            ++g_failures;
        }
    }

    if (g_failures) {
        std::printf("%d check(s) failed\n", g_failures);
        return 1;
    }
    std::printf("all ActorPerformance checks passed\n");
    return 0;
}
