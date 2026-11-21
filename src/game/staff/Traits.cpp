#include "game/staff/Traits.hpp"

namespace otm::staff {

namespace {
float Clamp01(float v) {
    if (v >= 0.0f) return v <= 1.0f ? v : 1.0f;
    return 0.0f;
}
}  // namespace

// orig: 0x00441750
float TraitMap::Get(std::string_view name) const {
    const auto it = values_.find(std::string(name));
    return it == values_.end() ? 0.0f : it->second;
}

bool TraitMap::Has(std::string_view name) const { return values_.count(std::string(name)) != 0; }

// orig: 0x00442490
void TraitMap::Set(std::string_view name, float value) { values_[std::string(name)] = Clamp01(value); }

// orig: 0x004425F0
float TraitMap::Add(std::string_view name, float gain, float bonusMultiplier) {
    gain = bonusMultiplier * gain;
    const auto it = values_.find(std::string(name));
    if (it == values_.end()) {
        Set(name, gain);
        return gain;
    }
    const float old = it->second;
    const float delta = (1.0f - old) * gain;
    Set(name, old + delta);
    return delta;
}

// orig: 0x00440130
float ExperienceTable::Get(Experience e) const {
    const float v = values[static_cast<size_t>(e)];
    if (v < 0.0f) return 0.0f;
    return v > 1.0f ? 1.0f : v;
}

// orig: 0x0057C250
float GenreExperienceGain(CastRole role, bool jobIsStuntman, const ExperienceTable& table, float stuntmanGenreModifier) {
    Experience e = Experience::MoviesStuntman;
    switch (role) {
        case CastRole::Director: e = Experience::MoviesDirector; break;
        case CastRole::Lead: e = Experience::MoviesLeadRole; break;
        case CastRole::Support: e = Experience::MoviesSupportRole; break;
        case CastRole::Other: break;
    }
    float gain = table.Get(e);
    if (jobIsStuntman) gain = stuntmanGenreModifier * gain;
    return gain;
}

}  // namespace otm::staff
