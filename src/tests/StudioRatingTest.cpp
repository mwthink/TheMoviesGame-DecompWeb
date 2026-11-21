// Checks StudioRating against rows the running game logged (run6, STUDIO_COMPONENTS: appearance, decayed reputation, money,
// star power, awards and the studio's own rating at the same moment).
#include <cmath>
#include <cstdio>

#include "game/studio/StudioRating.hpp"

using namespace otm::studio;

static int g_failures = 0;
static void Near(const char* what, double got, double want, double tol) {
    if (!(std::fabs(got - want) <= tol)) { std::printf("FAIL %s: got %.6f, want %.6f (+-%g)\n", what, got, want, tol); ++g_failures; }
}

int main() {
    struct Row { float app, rep, money, star, awards, rating; };
    const Row rows[] = {
        {1.0000, 0.1244, 0.9110, 0.4104, 0.6780, 0.5872},
        {0.5770, 0.4401, 1.0000, 0.3836, 0.1695, 0.5434},
        {0.6733, 0.5043, 1.0000, 0.4729, 0.0000, 0.5695},
        {0.4027, 0.4872, 0.8704, 0.2176, 0.1695, 0.4589},
        {0.9447, 0.4412, 0.9518, 0.4848, 0.3390, 0.6337},
        {1.0000, 0.1201, 0.9033, 0.4066, 0.6780, 0.5834},
        {0.5195, 0.4822, 1.0000, 0.2397, 0.0000, 0.4864},
        {0.9223, 0.5796, 1.0000, 0.5012, 0.3390, 0.6790},
    };
    for (const Row& r : rows) {
        StudioComponents c;
        c.appearance = r.app; c.reputation = r.rep; c.money = r.money; c.starPower = r.star; c.awards = r.awards;
        Near("studio rating", ComputeStudioRating(c), r.rating, 1.5e-3);
    }
    // The player's studio at its first quarter: stored reputation 0.1717 stored in 1957.764, now 1960.0916.
    Near("decayed reputation (player)", DecayedReputation(0.1717f, 1960.0916 - 1957.7640), 0.1244, 2e-4);
    // An AI studio: base 0.4458 stored 1960.0, now 1960.0916 (logged 0.4401).
    Near("decayed reputation (AI)", DecayedReputation(0.4458f, 0.0916), 0.4401, 2e-4);
    // Clamping: every term maxed adds to 1.005 and is capped at 1; nothing is below 0.
    StudioComponents full; full.appearance = full.reputation = full.money = full.starPower = full.awards = 1.0f;
    Near("clamped at 1", ComputeStudioRating(full), 1.0, 0.0);
    Near("empty studio", ComputeStudioRating(StudioComponents{}), 0.0, 0.0);

    if (g_failures) { std::printf("%d failure(s)\n", g_failures); return 1; }
    std::printf("studio rating: all checks passed\n");
    return 0;
}
