// Character traits and the experience table: how skills grow.
//
// Reimplemented from TraitContainer_Get/Set/Add (0x441750 / 0x442490 / 0x4425F0), ExperienceTable_Get (0x440130) and
// CStaff_AddGenreExperience (0x57C250). Derivation: docs/TRAITS_AND_EXPERIENCE.md sections 1, 2.
//
// A trait is a named float in [0, 1] ("Stunts", "Movies", one per genre, ...). Experience gains are fractions of the
// remaining headroom: new = old + (1 - old) * gain, so skills level off as they approach 1.
#pragma once

#include <array>
#include <map>
#include <string>
#include <string_view>

namespace otm::staff {

class TraitMap {
public:
    // TraitContainer_Get: the value, or 0 if the trait does not exist.
    // orig: 0x00441750
    float Get(std::string_view name) const;
    bool Has(std::string_view name) const;
    // TraitContainer_Set: stores clamp01(value).
    // orig: 0x00442490
    void Set(std::string_view name, float value);
    // TraitContainer_Add: a diminishing-returns gain. bonusMultiplier is the experience award bonus value (award bonus 1) when
    // that bonus is active, 1 otherwise. A trait that does not exist yet starts at the gain itself. Returns the amount gained
    // before clamping (the original's return value for an existing trait; for a new trait it returns the gain).
    // orig: 0x004425F0
    float Add(std::string_view name, float gain, float bonusMultiplier = 1.0f);

    const std::map<std::string, float>& All() const { return values_; }

private:
    std::map<std::string, float> values_;  // keys are case-sensitive as in the game ("Stunts", "Movies"); genres are lower-case
};

// Index into the 20-entry table loaded from experience.ini (the order of ExperienceTable_Load).
enum class Experience : int {
    LotPerHammerBuild = 0,
    LotPerLitterSwept,
    LotPerHammerRepair,
    SetRehearseLoop,
    SetWatchRehearseLoop,
    SetWatchShootLoop,
    SetRehearseIncrement,
    SetWatchIncrement,
    SetWatchShootIncrement,
    SetRehearseTime,
    MoviesWriterStart,
    MoviesScientistStart,
    MoviesScientistIncrementPerMonth,
    MoviesCrewPerShot,   // 0x0D
    MoviesLeadRole,      // 0x0E
    MoviesSupportRole,   // 0x0F
    MoviesDirector,      // 0x10
    ScriptQualityGain,
    ScriptExpGain,
    MoviesStuntman,      // 0x13
    Count
};

struct ExperienceTable {
    // Defaults are the shipped experience.ini values.
    std::array<float, static_cast<size_t>(Experience::Count)> values = {
        0.0006f, 0.004f, 0.0003f, 0.01f, 0.005f, 0.0075f, 0.1f, 0.05f, 0.75f, 600.0f,
        0.1f, 0.1f, 0.011f, 0.02f, 0.026f, 0.013f, 0.026f, 0.0004f, 0.00002f, 0.013f};
    float starsExperienceInterval = 5.0f;   // stars_experience_interval
    float starsExperienceDecay = 0.002f;    // stars_experience_decay
    float staffStartMinExp = 0.1f;          // StaffStartMinExp / MaxExp
    float staffStartMaxExp = 0.1f;
    float crewStartMinExp = 0.1f;           // CrewStartMinExp / MaxExp
    float crewStartMaxExp = 0.1f;

    // ExperienceTable_Get: the entry clamped to 0..1 (negative gives 0).
    // orig: 0x00440130
    float Get(Experience e) const;
};

// What a cast member is in the project, which decides the genre experience a take gives them.
enum class CastRole { Director, Lead, Support, Other };

// The amount CStaff_AddGenreExperience adds to the trait named after the movie's genre: the director gets MoviesDirector,
// a lead actor MoviesLeadRole, a supporting actor MoviesSupportRole and anyone else MoviesStuntman; a character whose job is
// stuntman (job 16) gets it times stuntmanGenreModifier (stunts.ini [experience] stuntmangenremodifier, 0.7).
// orig: 0x0057C250
float GenreExperienceGain(CastRole role, bool jobIsStuntman, const ExperienceTable& table, float stuntmanGenreModifier = 0.7f);

}  // namespace otm::staff
