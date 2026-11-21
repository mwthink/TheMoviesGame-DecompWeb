#include "game/staff/StarRating.hpp"

namespace otm::staff {

namespace {
float Clamp01(float v) {
    if (v >= 0.0f) return v <= 1.0f ? v : 1.0f;
    return 0.0f;
}
}  // namespace

// orig: 0x00591720
float ComputeStarRating(const StarComponents& c, float base, const StarRatingTuning& t) {
    float s = 0.0f;
    s = Clamp01(t.weightSalary * Clamp01(c.salary) + s);
    s = Clamp01(t.weightRelationships * Clamp01(c.relationships) + s);
    s = Clamp01(t.weightImage * Clamp01(c.image) + s);
    s = Clamp01(t.weightTrailer * Clamp01(c.trailer) + s);
    s = Clamp01(t.weightEntourage * Clamp01(c.entourage) + s);
    s = Clamp01(t.weightAwards * Clamp01(c.awards) + s);
    s = Clamp01(t.weightMovies * Clamp01(c.movies) + s);
    s = Clamp01(t.weightPerformance * Clamp01(c.performance) + s);
    s = Clamp01(t.weightPressBar * Clamp01(c.pressBar) + s);
    return Clamp01(s + base);
}

// orig: 0x00587E40
float EntourageComponent(int members, const StarRatingTuning& t) {
    return Clamp01(static_cast<float>(members) / t.entourageMembersForFull);
}

// orig: 0x00590B00
float AwardsComponent(int awardsWon, const StarRatingTuning& t) {
    return Clamp01(static_cast<float>(awardsWon) * t.awardsPerAward);
}

// orig: 0x00585750
// orig: 0x00588070
void AddFilmRating(movie::DecayValue& value, float filmValue, double nowYear, const StarRatingTuning& t) {
    value.Add(Clamp01(t.ratingsMultiplier * Clamp01(filmValue)), nowYear);
}

movie::DecayValue NewRatingValue(const StarRatingTuning& t) {
    movie::DecayValue v;
    v.halfLifeYears = t.ratingsHalfLife;
    return v;
}

// orig: 0x005857E0
float RatingComponent(const movie::DecayValue& value, double nowYear) {
    return static_cast<float>(value.Clamped01(nowYear));
}

}  // namespace otm::staff
