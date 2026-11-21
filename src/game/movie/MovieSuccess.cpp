#include "game/movie/MovieSuccess.hpp"

#include <algorithm>
#include <cmath>
#include <functional>

namespace otm::movie {

// orig: 0x005C8B90
float MarketingSpendCost(int marketingLevel, const SuccessTuning& t) {
    if (marketingLevel < 0 || marketingLevel > 5) return 0.0f;
    return t.marketingSpendCost[marketingLevel];
}

// orig: 0x005B2BD0
float CappedHype(float hype, float qm) {
    const float cap = Clamp01(qm * 0.5f);
    return hype <= cap ? hype : cap;
}

// orig: 0x005B29E0 verified
float MarketingPublicInterest(float cappedHype, float qm, int marketingLevel, bool onTheRadar, const SuccessTuning&) {
    float d = 1.0f - cappedHype;
    switch (marketingLevel) {
        case 2: d = d * 0.25f; break;
        case 3: d = d * 0.5f; break;
        case 4: d = d * 0.75f; break;
        case 5: break;
        default: d = 0.0f; break;  // none and "lowest" give no bonus
    }
    if (onTheRadar) {
        float hype = cappedHype;
        const float cap = Clamp01(qm * 0.5f);
        if (cap < hype) hype = Clamp01(qm * 0.5f);
        const float target = Clamp01(qm - hype);
        if (target != d) d = d - (d - target) * 0.5f;
    }
    if (d < 0.0f) return 0.0f;
    if (d > 1.0f) return 1.0f;
    return d;
}

// orig: 0x005DCFD0 verified
float PublicInterestCoverage(float cappedHype, float marketingD, float qm, const SuccessTuning& t, bool symmetricImbalance) {
    float hype = cappedHype;
    const float halfQuality = Clamp01(qm * 0.5f);
    if (halfQuality < hype) hype = halfQuality;

    const float rawSum = marketingD + hype;
    const float total = Clamp01(rawSum);  // total publicity

    float cover = 0.0f;
    if (qm != 0.0f) {
        float missed;
        if (total > qm) {
            missed = std::pow(Clamp01(total - qm), 3.0f);  // too much publicity: cubic penalty
        } else {
            missed = Clamp01(qm - total) / qm;
        }
        cover = 1.0f - missed;
    }

    // Hype and marketing are worth most in balance. The original takes |clamp01(D - hype)|, so a surplus of hype over D is not
    // counted as imbalance (every measured release had D > hype, so that side is not covered by the logs).
    float imbalance = 0.0f;
    if (rawSum > 0.0f) {
        const float gap = symmetricImbalance ? std::fabs(marketingD - hype) : std::fabs(Clamp01(marketingD - hype));
        imbalance = gap / Clamp01(marketingD + hype);
    }
    return (1.0f - t.publicInterestRatio * imbalance) * cover;
}

float PublicInterestFactor(float coverage, const SuccessTuning& t) {
    return (t.publicInterestMax - t.publicInterestMin) * coverage + t.publicInterestMin;
}

// orig: 0x005DD2D0 verified
float PublicInterestFactorAI(float hype, float quality, const SuccessTuning& t) {
    float missed;
    if (hype > quality || quality == 0.0f) {
        missed = std::pow(Clamp01(hype - quality), 3.0f);  // AI hype is not capped by quality: over-hyped movies are penalised
    } else {
        missed = Clamp01(quality - hype) / quality;
    }
    return t.publicInterestRatio * (1.0f - missed) * (t.publicInterestMax - t.publicInterestMin) + t.publicInterestMin;
}

// orig: 0x005DE8F0
float CastStarRatingsFactor(std::vector<float> starRatings, float qm, const SuccessTuning& t) {
    std::sort(starRatings.begin(), starRatings.end(), std::greater<float>());
    float sum = 0.0f;
    float weight = t.starRatingsProportion;
    for (float rating : starRatings) {
        sum += Clamp01(weight * rating);
        weight = weight * weight;
    }
    if (qm < 0.2f) qm = 0.2f;
    const float x = Clamp01(sum / (qm * 3.0f - 0.3f));
    return Clamp01((t.starRatingsMax - t.starRatingsMin) * x) + t.starRatingsMin;
}

// orig: 0x005DD3D0 verified
float GenrePopularity(float trend, float saturation, float trendOverride, const SuccessTuning& t) {
    const float effectiveTrend = trendOverride >= 0.0f ? trendOverride : trend;
    const float popularity = (t.genrePopularityMax - t.genrePopularityMin) * effectiveTrend + t.genrePopularityMin;
    const float freshness = 1.0f - Clamp01(saturation);
    return popularity * (t.genreBoredomBound + (1.0f - t.genreBoredomBound) * freshness);
}

// orig: 0x005DE3F0 verified
BoredomResult BoredomFactor(const std::vector<float>& setBoredom, const std::vector<float>& castBoredom, const SuccessTuning& t) {
    BoredomResult r;
    const size_t n = setBoredom.size() + castBoredom.size();
    if (n == 0) return r;
    float termSum = 0.0f;
    float boredomSum = 0.0f;
    for (float b : setBoredom) {
        boredomSum += b;
        termSum += (1.0f - b) * (1.0f - t.setBoredomBound) + t.setBoredomBound;
    }
    for (float b : castBoredom) {
        boredomSum += b;
        termSum += (1.0f - b) * (1.0f - t.starBoredomBound) + t.starBoredomBound;
    }
    const float inv = 1.0f / static_cast<float>(n);
    r.meanBoredom = Clamp01(boredomSum * inv);
    r.factor = inv * termSum;
    return r;
}

// orig: 0x005DD570
float TechPioneeringFactor(bool pioneerTechnologyActive, const SuccessTuning& t) {
    return pioneerTechnologyActive ? t.technologyPioneeringBonus : 1.0f;
}

// orig: 0x005DEDC0 verified
float ComputeSuccess(float qm, const SuccessFactors& f, const SuccessTuning& t) {
    if (qm < -1e-06f || qm > 1.000001f) qm = 1.0f;
    const float production = f.techPioneering * f.starRatings * f.genrePopularity * f.boredom * f.publicInterest;
    const float offset = qm - t.overallShifterMidPoint;
    const float x = ((production - 1.0f) + (offset + offset) * -1.0f * t.overallMaxShifter) * t.overallMaxAdder;
    const float s = DiminishingBonus(x) + qm;
    return s < 0.0f ? 0.0f : s;
}

// orig: 0x005B8C90 verified
float MovieStarRating(float success, float qm, bool hasAward, const SuccessTuning& t) {
    float r = Clamp01(t.starRatingBoxOffice * Clamp01(success));
    r = Clamp01(t.starRatingQuality * qm + r);
    r = Clamp01(t.starRatingAwards * (hasAward ? 1.0f : 0.0f) + r);
    return r;
}

namespace {
IncomeRecord MakeIncome(float success, float interest, bool emptyPool, const SuccessTuning& t) {
    IncomeRecord r;
    r.initialPool = static_cast<double>(t.revenueMultiplier) * std::pow(static_cast<double>(success), 2.0) + t.revenueBase;
    r.pool = r.initialPool;
    r.adderMaximum = r.initialPool * t.adderPercentage;
    // piFactor: with no public interest the payout rate is (1 - pi_effect) of its maximum.
    const double piFactor = (1.0 - t.piEffect) + t.piEffect * interest;
    r.dailyPercentage = t.basePercentage * piFactor;
    r.dailyMultiplier = 1.0 + t.increasePercentage * piFactor;
    if (emptyPool) r.pool = 0.0;
    return r;
}
}  // namespace

// orig: 0x005CDB80 verified
IncomeRecord CreatePlayerIncome(float success, float marketingD, float cappedHype, const SuccessTuning& t) {
    return MakeIncome(success, Clamp01(marketingD + cappedHype), false, t);
}

// orig: 0x005CDD90 verified
IncomeRecord CreateAIIncome(float success, float hype, bool backCatalog, const SuccessTuning& t) {
    return MakeIncome(success, hype, backCatalog, t);
}

// orig: 0x005CCE10
double DailyPayout(IncomeRecord& income, double randomUnit) {
    if (income.pool == 0.0) return 0.0;
    double payout = income.pool * income.dailyPercentage + randomUnit * income.adderMaximum;
    if (payout >= income.pool) payout = income.pool;  // the last day pays out the remainder
    income.pool -= payout;
    income.dailyPercentage *= income.dailyMultiplier;
    return payout;
}

// orig: 0x005216E0 verified
float GenreTrend(const std::vector<TasteEvent>& events, double nowYear, const SuccessTuning& t) {
    const TasteEvent* latest = nullptr;
    for (const TasteEvent& e : events) {
        if (e.year > nowYear) break;
        latest = &e;
    }
    if (!latest) return 0.5f;
    const double decay = std::exp2(-(nowYear - latest->year) / t.trendHalfLife);
    return Clamp01(static_cast<float>(0.5 + (latest->value - 0.5) * decay));
}

// orig: 0x00494FC0 verified
double DecayValue::Current(double nowYear) const {
    if (value0 == 0.0) return value0;
    return value0 * std::exp2(-(nowYear - stampYear) / halfLifeYears);
}

// orig: 0x004950C0
double DecayValue::Clamped01(double nowYear) const {
    const double v = Current(nowYear);
    return v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v);
}

// orig: 0x004950A0
void DecayValue::Add(double amount, double nowYear) {
    value0 = Current(nowYear) + amount;
    stampYear = nowYear;
}

// orig: 0x0044D120
float SaturationPushAmount(double nowYear, float weight, const SuccessTuning& t) {
    const double years = nowYear - 1920.0;
    if (years <= 10.0) return 0.0f;
    const float ramp = Clamp01(static_cast<float>((years - 10.0) * 0.1));
    return t.genreBoredomBoost * ramp * weight;
}

}  // namespace otm::movie
