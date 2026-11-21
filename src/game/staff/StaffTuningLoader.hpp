// Loads the staff tuning (experience table, stunts, star rating weights, award bonus values) from the game's data files.
//
// Sources (extract with tools/pak_extract.py): experience.ini, stunts.ini, global.ini ([star]), awardsbonuses.ini.
// Like TuningLoader: a missing or unreadable value keeps its default and is listed in the report; loading never fails.
#pragma once

#include <string>
#include <vector>

#include "core/Ini.hpp"
#include "game/staff/StarRating.hpp"
#include "game/staff/Stunts.hpp"
#include "game/staff/Traits.hpp"

namespace otm::staff {

struct StaffBonusTuning {
    // awardsbonuses.ini: values of the bonuses that change experience. Which key belongs to which character type for the
    // generic experience bonus (award bonus 1, "Quick Learner") is not decoded, so all five are loaded.
    float naturalTalent = 1.2f;            // natural_talent_factor: multiplies stunt XP (award bonus 0xF)
    float starsExperienceBoost = 1.1f;     // stars_experience_boost
    float crewExperienceBoost = 1.1f;      // crew_experience_boost
    float lotExperienceBoost = 1.1f;       // lot_experience_boost
    float writersExperienceBoost = 1.1f;   // writers_experience_boost
    float researchersExperienceBoost = 1.1f;// researchers_experience_boost
    float thickSkinFactor = 0.8f;          // thick_skin_factor: scales damage taken
};

struct StaffTuning {
    ExperienceTable experience;
    StuntTuning stunts;
    StarRatingTuning starRating;
    StaffBonusTuning bonuses;
};

struct StaffTuningSources {
    core::IniFile experience;
    core::IniFile stunts;
    core::IniFile global;
    core::IniFile awardsBonuses;
};

// Builds the tuning from parsed sources (no file access). Problems are appended to `problems`.
StaffTuning BuildStaffTuning(const StaffTuningSources& sources, std::vector<std::string>& problems);

// Reads the four files from a directory.
StaffTuning LoadStaffTuning(const std::string& dataDir, std::vector<std::string>& problems);

}  // namespace otm::staff
