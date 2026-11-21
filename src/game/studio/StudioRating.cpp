#include "game/studio/StudioRating.hpp"

#include <algorithm>
#include <cmath>

namespace otm::studio {

static float Clamp01(float v) { return std::min(1.0f, std::max(0.0f, v)); }

float ComputeStudioRating(const StudioComponents& c, const StudioRatingTuning& t) {
    float s = Clamp01(t.weightAppearance * c.appearance);
    s = Clamp01(s + t.weightReputation * c.reputation);
    s = Clamp01(s + t.weightMoney * c.money);
    s = Clamp01(s + t.weightStarPower * c.starPower);
    return Clamp01(s + t.weightAwards * c.awards);
}

float DecayedReputation(float stored, double years, const StudioRatingTuning& t) {
    const double k = std::log(2.0) / t.reputationHalfLifeYears;
    return Clamp01(static_cast<float>(stored * std::exp(-k * years)));
}

}  // namespace otm::studio
