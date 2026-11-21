#include "game/movie/TuningLoader.hpp"

#include <algorithm>

#include "core/IniRead.hpp"
#include "core/Strings.hpp"

namespace otm::movie {

namespace {

using core::IniFile;

void Read(const IniFile& ini, const char* file, const char* section, const char* key, float& dst, LoadReport& report) {
    core::ReadFloat(ini, file, section, key, dst, report.problems);
}

}  // namespace

std::map<std::string, std::vector<TasteEvent>> ParseGenreEvents(const std::vector<core::CsvRow>& timeline) {
    std::map<std::string, std::vector<TasteEvent>> events;
    size_t header = timeline.size();
    for (size_t i = 0; i < timeline.size(); ++i) {
        if (!timeline[i].empty() && core::EqualsNoCase(core::Trim(timeline[i][0]), "[timeline]")) {
            header = i;
            break;
        }
    }
    if (header == timeline.size()) return events;
    const core::CsvRow& names = timeline[header];
    size_t yearColumn = names.size();
    std::vector<std::pair<size_t, std::string>> genres;
    for (size_t c = 0; c < names.size(); ++c) {
        const std::string name = core::ToLower(core::Trim(names[c]));
        if (name == "year") yearColumn = c;
        if (name.rfind("genre_", 0) == 0) genres.emplace_back(c, name.substr(6));
    }
    if (yearColumn == names.size()) return events;
    for (size_t r = header + 1; r < timeline.size(); ++r) {
        const core::CsvRow& row = timeline[r];
        if (yearColumn >= row.size()) continue;
        const auto year = core::ParseDouble(row[yearColumn]);
        if (!year) continue;
        for (const auto& g : genres) {
            if (g.first >= row.size()) continue;
            const auto value = core::ParseDouble(row[g.first]);
            if (value) events[g.second].push_back({*year, static_cast<float>(*value)});  // blank = no effect on that genre
        }
    }
    for (auto& kv : events) {
        std::stable_sort(kv.second.begin(), kv.second.end(), [](const TasteEvent& a, const TasteEvent& b) { return a.year < b.year; });
    }
    return events;
}

MovieTuning BuildMovieTuning(const TuningSources& s, LoadReport& report) {
    MovieTuning t;
    const IniFile& rm = s.releasingMovies;
    const char* F = "releasing_movies.ini";

    QualityTuning& q = t.quality;
    Read(rm, F, "min_max", "unspread_performance_min", q.unspreadPerformanceMin, report);
    Read(rm, F, "min_max", "unspread_performance_max", q.unspreadPerformanceMax, report);
    Read(rm, F, "min_max", "set_repair_value_min", q.setRepairMin, report);
    Read(rm, F, "min_max", "set_repair_value_max", q.setRepairMax, report);
    Read(rm, F, "min_max", "star_genre_experience_min", q.starGenreExperienceMin, report);
    Read(rm, F, "min_max", "star_genre_experience_max", q.starGenreExperienceMax, report);
    Read(rm, F, "min_max", "star_relationship_min", q.starRelationshipMin, report);
    Read(rm, F, "min_max", "star_relationship_max", q.starRelationshipMax, report);
    Read(rm, F, "min_max", "star_relationship_range_width", q.starRelationshipRangeWidth, report);
    Read(rm, F, "min_max", "crew_min", q.crewMin, report);
    Read(rm, F, "min_max", "crew_max", q.crewMax, report);
    Read(rm, F, "overall", "quality_overall_shifter_mid_point", q.overallShifterMidPoint, report);
    Read(rm, F, "overall", "quality_overall_max_shifter", q.overallMaxShifter, report);
    Read(rm, F, "overall", "quality_overall_max_adder", q.overallMaxAdder, report);
    Read(rm, F, "pre_production", "pre_production", q.preProductionTime, report);

    SuccessTuning& u = t.success;
    Read(rm, F, "min_max", "public_interest_min", u.publicInterestMin, report);
    Read(rm, F, "min_max", "public_interest_max", u.publicInterestMax, report);
    Read(rm, F, "public_interest", "public_interest_ratio", u.publicInterestRatio, report);
    Read(rm, F, "min_max", "star_ratings_of_cast_min", u.starRatingsMin, report);
    Read(rm, F, "min_max", "star_ratings_of_cast_max", u.starRatingsMax, report);
    Read(rm, F, "star_ratings_proportion", "star_ratings_proportion", u.starRatingsProportion, report);
    Read(rm, F, "min_max", "genre_popularity_min", u.genrePopularityMin, report);
    Read(rm, F, "min_max", "genre_popularity_max", u.genrePopularityMax, report);
    Read(rm, F, "boredom", "genre_boredom_bound", u.genreBoredomBound, report);
    Read(rm, F, "boredom", "set_boredom_bound", u.setBoredomBound, report);
    Read(rm, F, "boredom", "star_boredom_bound", u.starBoredomBound, report);
    Read(rm, F, "tech", "technology_pioneering_bonus", u.technologyPioneeringBonus, report);
    Read(rm, F, "overall", "success_overall_shifter_mid_point", u.overallShifterMidPoint, report);
    Read(rm, F, "overall", "success_overall_max_shifter", u.overallMaxShifter, report);
    Read(rm, F, "overall", "success_overall_max_adder", u.overallMaxAdder, report);
    Read(rm, F, "income", "revenue_multiplier", u.revenueMultiplier, report);
    Read(rm, F, "income", "revenue_base", u.revenueBase, report);
    Read(rm, F, "income", "pi_effect", u.piEffect, report);
    Read(rm, F, "income", "adder_percentage", u.adderPercentage, report);
    Read(rm, F, "income", "base_percentage", u.basePercentage, report);
    Read(rm, F, "income", "increase_percentage", u.increasePercentage, report);
    Read(s.global, "global.ini", "project", "starratingboxoffice", u.starRatingBoxOffice, report);
    Read(s.global, "global.ini", "project", "starratingquality", u.starRatingQuality, report);
    Read(s.global, "global.ini", "project", "starratingawards", u.starRatingAwards, report);
    Read(s.global, "global.ini", "genre", "boredomboost", u.genreBoredomBoost, report);
    Read(s.global, "global.ini", "genre", "boredomhalflife", u.genreBoredomHalfLife, report);

    Read(s.miscCosts, "misc_costs.ini", "project", "marketing_spend_lowest", u.marketingSpendCost[1], report);
    Read(s.miscCosts, "misc_costs.ini", "project", "marketing_spend_low", u.marketingSpendCost[2], report);
    Read(s.miscCosts, "misc_costs.ini", "project", "marketing_spend_medium", u.marketingSpendCost[3], report);
    Read(s.miscCosts, "misc_costs.ini", "project", "marketing_spend_high", u.marketingSpendCost[4], report);
    Read(s.miscCosts, "misc_costs.ini", "project", "marketing_spend_highest", u.marketingSpendCost[5], report);

    ActorTuning& a = t.actor;
    Read(rm, F, "min_max", "star_mood_min", a.starMoodMin, report);
    Read(rm, F, "min_max", "star_mood_max", a.starMoodMax, report);
    Read(rm, F, "star_mood_step", "star_mood_step", a.starMoodStep, report);
    Read(rm, F, "min_max", "stars_genre_fit_min", a.genreFitMin, report);
    Read(rm, F, "min_max", "stars_genre_fit_max", a.genreFitMax, report);
    Read(rm, F, "genre_fit", "max_from_ideal", a.genreFitMaxFromIdeal, report);
    const char* SF = "stunts.ini";
    Read(s.stunts, SF, "performance", "stuntskillminimum", a.stuntSkillMin, report);
    Read(s.stunts, SF, "performance", "stuntskillmaximum", a.stuntSkillMax, report);
    Read(s.stunts, SF, "performance", "healthminimum", a.healthMin, report);
    Read(s.stunts, SF, "performance", "healthmaximum", a.healthMax, report);
    Read(s.stunts, SF, "performance", "injurymultiplier", a.healthInjuryMultiplier, report);
    Read(s.stunts, SF, "", "healththreshold", a.healthThreshold, report);
    Read(s.stunts, SF, "performance", "likenessminimum", a.likenessMin, report);
    Read(s.stunts, SF, "performance", "likenessmaximum", a.likenessMax, report);
    Read(s.stunts, SF, "performance", "likenessbonus", a.likenessBonus, report);
    Read(s.stunts, SF, "performance", "successminimum", a.successMin, report);
    Read(s.stunts, SF, "performance", "successmaximum", a.successMax, report);
    Read(s.stunts, SF, "performance", "stuntlevelminimum", a.levelMin, report);
    Read(s.stunts, SF, "performance", "stuntlevelmaximum", a.levelMax, report);
    Read(s.stunts, SF, "performance", "releasescreenminbound", a.releaseScreenMin, report);
    Read(s.stunts, SF, "performance", "releasescreenmaxbound", a.releaseScreenMax, report);
    Read(s.stunts, SF, "", "genderfactor", a.genderFactor, report);
    Read(s.stunts, SF, "", "sexfactor", a.sexFactor, report);
    Read(s.stunts, SF, "", "weightfactor", a.weightFactor, report);
    Read(s.stunts, SF, "", "agefactor", a.ageFactor, report);
    Read(s.stunts, SF, "", "looksfactor", a.looksFactor, report);

    AwardBonusTuning& b = t.bonuses;
    const char* AF = "awardsbonuses.ini";
    Read(s.awardsBonuses, AF, "", "public_awareness_boost", b.publicAwarenessBoost, report);
    Read(s.awardsBonuses, AF, "", "trendsetter_boost", b.trendsetter, report);
    Read(s.awardsBonuses, AF, "", "genre_fit_boost", b.perfectFit, report);
    Read(s.awardsBonuses, AF, "", "boredom_factor", b.brainwasher, report);
    Read(s.awardsBonuses, AF, "", "lower_mood_val", b.lowerMoodThreshold, report);
    Read(s.awardsBonuses, AF, "", "upper_mood_val", b.upperMoodThreshold, report);

    // timeline.csv: "[constants],..." then rows "halflife,4,..."
    bool inConstants = false, haveHalfLife = false;
    for (const core::CsvRow& row : s.timeline) {
        if (row.empty()) continue;
        const std::string first = core::ToLower(core::Trim(row[0]));
        if (!first.empty() && first[0] == '[') {
            inConstants = first == "[constants]";
            continue;
        }
        if (inConstants && first == "halflife" && row.size() > 1) {
            if (const auto v = core::ParseDouble(row[1])) {
                t.success.trendHalfLife = static_cast<float>(*v);
                haveHalfLife = true;
            }
        }
    }
    if (!haveHalfLife) report.problems.push_back("timeline.csv [constants] halflife: missing");
    t.genreEvents = ParseGenreEvents(s.timeline);
    if (t.genreEvents.empty()) report.problems.push_back("timeline.csv: no genre events found");
    return t;
}

MovieTuning LoadMovieTuning(const std::string& dataDir, LoadReport& report) {
    TuningSources s;
    const std::string dir = dataDir.empty() || dataDir.back() == '/' ? dataDir : dataDir + "/";
    const auto ini = [&](const char* name, IniFile& out) {
        if (!IniFile::Load(dir + name, out)) report.problems.push_back(std::string(name) + ": cannot be read");
    };
    ini("releasing_movies.ini", s.releasingMovies);
    ini("global.ini", s.global);
    ini("stunts.ini", s.stunts);
    ini("awardsbonuses.ini", s.awardsBonuses);
    ini("misc_costs.ini", s.miscCosts);
    if (!core::LoadCsv(dir + "timeline.csv", s.timeline)) report.problems.push_back("timeline.csv: cannot be read");
    return BuildMovieTuning(s, report);
}

}  // namespace otm::movie
