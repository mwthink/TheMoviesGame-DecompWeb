#include "game/staff/StaffTuningLoader.hpp"

#include "core/IniRead.hpp"

namespace otm::staff {

namespace {

// experience.ini keys in the order of the Experience enum.
const char* const kExperienceKeys[static_cast<size_t>(Experience::Count)] = {
    "LOT_PERHAMMERBUILD", "LOT_PERLITTERSWEPT", "LOT_PERHAMMERREPAIR", "SET_REHEARSELOOP", "SET_WATCHREHEARSELOOP",
    "SET_WATCHSHOOTLOOP", "SET_REHEARSE_INCREMENT", "SET_WATCH_INCREMENT", "SET_WATCHSHOOT_INCREMENT", "SET_REHEARSE_TIME",
    "MOVIES_WRITERSTART", "MOVIES_SCIENTISTSTART", "MOVIES_SCIENTIST_INCREMENT_PER_MONTH", "MOVIES_CREWPERSHOT",
    "MOVIES_LEADROLE", "MOVIES_SUPPORTROLE", "MOVIES_DIRECTOR", "SCRIPT_QUALITY_GAIN", "SCRIPT_EXP_GAIN", "MOVIES_STUNTMAN"};

}  // namespace

StaffTuning BuildStaffTuning(const StaffTuningSources& s, std::vector<std::string>& problems) {
    StaffTuning t;
    const auto R = [&](const core::IniFile& ini, const char* file, const char* section, const char* key, float& dst) {
        core::ReadFloat(ini, file, section, key, dst, problems);
    };

    const char* EF = "experience.ini";
    for (size_t i = 0; i < t.experience.values.size(); ++i) R(s.experience, EF, "", kExperienceKeys[i], t.experience.values[i]);
    R(s.experience, EF, "", "stars_experience_interval", t.experience.starsExperienceInterval);
    R(s.experience, EF, "", "stars_experience_decay", t.experience.starsExperienceDecay);
    R(s.experience, EF, "", "StaffStartMinExp", t.experience.staffStartMinExp);
    R(s.experience, EF, "", "StaffStartMaxExp", t.experience.staffStartMaxExp);
    R(s.experience, EF, "", "CrewStartMinExp", t.experience.crewStartMinExp);
    R(s.experience, EF, "", "CrewStartMaxExp", t.experience.crewStartMaxExp);

    const char* SF = "stunts.ini";
    StuntTuning& u = t.stunts;
    R(s.stunts, SF, "", "healththreshold", u.healthThreshold);
    R(s.stunts, SF, "successfailure", "stuntabilityinjurymodifier", u.abilityInjuryModifier);
    R(s.stunts, SF, "successfailure", "maxhealthability", u.maxHealthAbility);
    R(s.stunts, SF, "successfailure", "minhealthability", u.minHealthAbility);
    R(s.stunts, SF, "successfailure", "stuntchancelow", u.chanceLow);
    R(s.stunts, SF, "successfailure", "stuntchancemedium", u.chanceMedium);
    R(s.stunts, SF, "successfailure", "stuntchancehigh", u.chanceHigh);
    R(s.stunts, SF, "successfailure", "stuntchancemin", u.chanceMin);
    R(s.stunts, SF, "successfailure", "stuntchancemax", u.chanceMax);
    R(s.stunts, SF, "successfailure", "luckycharmbonus", u.luckyCharmBonus);
    R(s.stunts, SF, "injuries", "stuntdamageskillmultiplier", u.damageSkillMultiplier);
    R(s.stunts, SF, "injuries", "maxhealthlossstuntfailure", u.maxHealthLossFailure);
    R(s.stunts, SF, "injuries", "minhealthlossstuntfailure", u.minHealthLossFailure);
    R(s.stunts, SF, "injuries", "maxhealthlossstuntsuccess", u.maxHealthLossSuccess);
    R(s.stunts, SF, "injuries", "minhealthlossstuntsuccess", u.minHealthLossSuccess);
    R(s.stunts, SF, "experience", "stuntxpsuccessmin", u.xpSuccessMin);
    R(s.stunts, SF, "experience", "stuntxpsuccessmax", u.xpSuccessMax);
    R(s.stunts, SF, "experience", "stuntxpfailuremin", u.xpFailureMin);
    R(s.stunts, SF, "experience", "stuntxpfailuremax", u.xpFailureMax);
    R(s.stunts, SF, "experience", "actorstuntskillmodifier", u.actorStuntSkillModifier);
    R(s.stunts, SF, "experience", "stuntmangenremodifier", u.stuntmanGenreModifier);
    R(s.stunts, SF, "training", "stuntxpsuccessmin", u.trainingXpSuccessMin);
    R(s.stunts, SF, "training", "stuntxpsuccessmax", u.trainingXpSuccessMax);
    R(s.stunts, SF, "training", "stuntxpfailuremin", u.trainingXpFailureMin);
    R(s.stunts, SF, "training", "stuntxpfailuremax", u.trainingXpFailureMax);
    R(s.stunts, SF, "training", "stuntxpincreasemin", u.trainingXpIncreaseMin);
    R(s.stunts, SF, "training", "lowhealthmultiplier", u.trainingLowHealthMultiplier);

    const char* GF = "global.ini";
    StarRatingTuning& r = t.starRating;
    R(s.global, GF, "star", "starratingweightmovies", r.weightMovies);
    R(s.global, GF, "star", "starratingweightsalary", r.weightSalary);
    R(s.global, GF, "star", "starratingweightperformance", r.weightPerformance);
    R(s.global, GF, "star", "starratingweightimage", r.weightImage);
    R(s.global, GF, "star", "starratingweightentourage", r.weightEntourage);
    R(s.global, GF, "star", "starratingweighttrailer", r.weightTrailer);
    R(s.global, GF, "star", "starratingweightpressbar", r.weightPressBar);
    R(s.global, GF, "star", "starratingweightrelationships", r.weightRelationships);
    R(s.global, GF, "star", "starratingweightawards", r.weightAwards);
    R(s.global, GF, "star", "ratingsmultiplier", r.ratingsMultiplier);
    R(s.global, GF, "star", "ratingshalflife", r.ratingsHalfLife);

    const char* AF = "awardsbonuses.ini";
    StaffBonusTuning& b = t.bonuses;
    R(s.awardsBonuses, AF, "", "natural_talent_factor", b.naturalTalent);
    R(s.awardsBonuses, AF, "", "stars_experience_boost", b.starsExperienceBoost);
    R(s.awardsBonuses, AF, "", "crew_experience_boost", b.crewExperienceBoost);
    R(s.awardsBonuses, AF, "", "lot_experience_boost", b.lotExperienceBoost);
    R(s.awardsBonuses, AF, "", "writers_experience_boost", b.writersExperienceBoost);
    R(s.awardsBonuses, AF, "", "researchers_experience_boost", b.researchersExperienceBoost);
    R(s.awardsBonuses, AF, "", "thick_skin_factor", b.thickSkinFactor);
    return t;
}

StaffTuning LoadStaffTuning(const std::string& dataDir, std::vector<std::string>& problems) {
    StaffTuningSources s;
    const std::string dir = dataDir.empty() || dataDir.back() == '/' ? dataDir : dataDir + "/";
    const auto load = [&](const char* name, core::IniFile& out) {
        if (!core::IniFile::Load(dir + name, out)) problems.push_back(std::string(name) + ": cannot be read");
    };
    load("experience.ini", s.experience);
    load("stunts.ini", s.stunts);
    load("global.ini", s.global);
    load("awardsbonuses.ini", s.awardsBonuses);
    return BuildStaffTuning(s, problems);
}

}  // namespace otm::staff
