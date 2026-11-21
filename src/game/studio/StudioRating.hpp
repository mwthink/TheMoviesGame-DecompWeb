// A studio's rating (the number behind the studio stars and the Studio milestone achievement).
//
// Reimplemented from CStudio_ComputeStarRating (0x50AB70, which the project's names call a star rating but which belongs to
// the studio) and CStudio_GetDecayedReputation (0x50A860). Derivation and measurements: docs/MOVIE_SUCCESS.md section 3aw.
#pragma once

namespace otm::studio {

// The weights of the five terms. The three at 0xE521B4..0xE521BC were read from the executable (0.239, 0.239, 0.144); the
// other two were fitted to the logged ratings (0.1447 and 0.2386, i.e. the same 0.144 and 0.239) because their constants
// have not been read.
struct StudioRatingTuning {
    float weightAppearance = 0.144f;
    float weightReputation = 0.239f;
    float weightMoney = 0.239f;          // 0xE521B4
    float weightStarPower = 0.239f;      // 0xE521B8
    float weightAwards = 0.144f;         // 0xE521BC
    float reputationHalfLifeYears = 5.0f;  // decay constant 0xE52188 = ln 2 / 5 = 0.138629
};

// The component values, each 0..1.
struct StudioComponents {
    float appearance = 0.0f;   // studio +0x12C
    float reputation = 0.0f;   // the decayed reputation
    float money = 0.0f;        // CStudio_GetMoneyRatingComponent (0x50CFE0)
    float starPower = 0.0f;    // CStudio_GetStarPowerRatingComponent (0x50FC90)
    float awards = 0.0f;       // CStudio_GetAwardsRatingComponent (0x50D8E0): awards owned * 0.1695
};

// rating = clamp01(...clamp01(clamp01(w_app*appearance + w_rep*reputation) + w_money*money) + w_star*starPower) + w_awards*awards),
// clamping after each addition.
// orig: 0x0050AB70 verified (run6, 2026-11-21: 27 studio rows, the sequential clamped sum matches the logged rating to 1e-4 in
// 26 of them and to 1e-3 in the other, where the cached rating was a tick older than the components)
float ComputeStudioRating(const StudioComponents& c, const StudioRatingTuning& t = {});

// CStudio_GetDecayedReputation: the stored reputation (+0x138) fades exponentially from the year it was stored (+0x13C).
// orig: 0x0050A860 verified (run6: 27 rows within 1e-4 of base * exp(-ln2/5 * years))
float DecayedReputation(float storedReputation, double yearsSinceStored, const StudioRatingTuning& t = {});

}  // namespace otm::studio
