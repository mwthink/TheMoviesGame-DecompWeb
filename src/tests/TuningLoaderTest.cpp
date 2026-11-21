// Tests for the tuning loader. The first half uses small inline files and always runs. The second half loads the real game
// files from $OTM_GAME_DATA (extracted with tools/pak_extract.py) and is skipped (exit code 77) when they are not there.
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <type_traits>

#include "game/movie/TuningLoader.hpp"

using namespace otm;
using namespace otm::movie;

static int g_failures = 0;

#define CHECK(cond)                                             \
    do {                                                        \
        if (!(cond)) {                                          \
            std::printf("FAIL line %d: %s\n", __LINE__, #cond); \
            ++g_failures;                                       \
        }                                                       \
    } while (0)

static bool NearF(float a, float b) { return std::fabs(a - b) < 1e-6f; }

// The tuning structs are plain float lists; compare them field by field through that view.
template <class T>
static void ExpectSame(const char* what, const T& loaded, const T& defaults) {
    static_assert(std::is_standard_layout<T>::value && sizeof(T) % sizeof(float) == 0, "float-only struct");
    const size_t n = sizeof(T) / sizeof(float);
    float a[64], b[64];
    std::memcpy(a, &loaded, sizeof(T));
    std::memcpy(b, &defaults, sizeof(T));
    for (size_t i = 0; i < n; ++i) {
        if (!NearF(a[i], b[i])) {
            std::printf("FAIL %s: field %zu is %.6f in the game files but %.6f in the defaults\n", what, i, a[i], b[i]);
            ++g_failures;
        }
    }
}

int main() {
    // ---- inline sources ----
    {
        TuningSources s;
        s.releasingMovies = core::IniFile::Parse(
            "[min_max]\n crew_min = 0.5\n crew_max = 1.5\n star_mood_min = 0.7\n"
            "[overall]\n quality_overall_max_adder = 0.9\n"
            "[income]\n revenue_base = 100\n");
        s.global = core::IniFile::Parse("[project]\n starratingboxoffice = 0.5\n[genre]\n boredomhalflife = 3\n");
        s.stunts = core::IniFile::Parse("healththreshold = 0.05\n[performance]\n likenessbonus = 1.3\n");
        s.awardsBonuses = core::IniFile::Parse("trendsetter_boost = 0.9\nupper_mood_val = 0.8\n");
        s.timeline = core::ParseCsv(
            "[constants],,,,,,,,,\nhalflife,6,,,,,,,,\n\n"
            "[timeline],year,technology,opinion_smoking,genre_action,genre_comedy,genre_horror,genre_romance,genre_sci-fi,month\n"
            ",1900,,,,,,,,\n"
            "timeline_B,1930.5,,,0,1,,,,6\n"
            "timeline_A,1924.5,,,1,,,,,7\n");
        LoadReport report;
        const MovieTuning t = BuildMovieTuning(s, report);
        CHECK(NearF(t.quality.crewMin, 0.5f) && NearF(t.quality.crewMax, 1.5f));
        CHECK(NearF(t.actor.starMoodMin, 0.7f));
        CHECK(NearF(t.quality.overallMaxAdder, 0.9f));
        CHECK(NearF(t.success.revenueBase, 100.0f));
        CHECK(NearF(t.success.starRatingBoxOffice, 0.5f));
        CHECK(NearF(t.success.genreBoredomHalfLife, 3.0f));
        CHECK(NearF(t.actor.healthThreshold, 0.05f));  // read from the section before the first [section]
        CHECK(NearF(t.actor.likenessBonus, 1.3f));
        CHECK(NearF(t.bonuses.trendsetter, 0.9f) && NearF(t.bonuses.upperMoodThreshold, 0.8f));
        CHECK(NearF(t.success.trendHalfLife, 6.0f));
        CHECK(NearF(t.quality.crewMin, 0.5f));
        // keys that are missing keep their defaults and are reported
        CHECK(NearF(t.quality.setRepairMin, QualityTuning{}.setRepairMin));
        CHECK(!report.Ok());
        bool reportedSetRepair = false;
        for (const std::string& p : report.problems) reportedSetRepair |= p.find("set_repair_value_min: missing") != std::string::npos;
        CHECK(reportedSetRepair);
        // events: per genre, sorted by year, blank cells skipped
        CHECK(t.genreEvents.at("action").size() == 2);
        CHECK(NearF(static_cast<float>(t.genreEvents.at("action")[0].year), 1924.5f));
        CHECK(t.genreEvents.at("comedy").size() == 1 && NearF(t.genreEvents.at("comedy")[0].value, 1.0f));
        CHECK(t.genreEvents.count("horror") == 0 && t.genreEvents.count("sci-fi") == 0);
        // and they drive the trend with the loaded half-life
        CHECK(NearF(GenreTrend(t.genreEvents.at("action"), 1924.5, t.success), 1.0f));
        CHECK(NearF(GenreTrend(t.genreEvents.at("action"), 1924.5 + 5.0, t.success), 0.5f + 0.5f * std::exp2(-5.0f / 6.0f)));  // half-life 6 from the file
        CHECK(NearF(GenreTrend(t.genreEvents.at("action"), 1930.5, t.success), 0.0f));  // the later event replaces the earlier one
    }
    {
        TuningSources empty;
        LoadReport report;
        const MovieTuning t = BuildMovieTuning(empty, report);
        ExpectSame("defaults with empty sources", t.quality, QualityTuning{});
        CHECK(report.problems.size() > 50);  // everything is reported
    }
    {
        LoadReport report;
        LoadMovieTuning("/definitely/not/a/directory", report);
        CHECK(!report.Ok());
        bool unreadable = false;
        for (const std::string& p : report.problems) unreadable |= p.find("cannot be read") != std::string::npos;
        CHECK(unreadable);
    }

    // ---- the real game files ----
    const char* dir = std::getenv("OTM_GAME_DATA");
    bool real = false;
    if (dir) {
        core::IniFile probe;
        real = core::IniFile::Load(std::string(dir) + "/releasing_movies.ini", probe);
    }
    if (real) {
        LoadReport report;
        const MovieTuning t = LoadMovieTuning(dir, report);
        for (const std::string& p : report.problems) std::printf("problem: %s\n", p.c_str());
        CHECK(report.Ok());
        // The defaults in the headers were copied from the docs: they must equal what the installed game ships.
        ExpectSame("QualityTuning", t.quality, QualityTuning{});
        ExpectSame("SuccessTuning", t.success, SuccessTuning{});
        ExpectSame("ActorTuning", t.actor, ActorTuning{});
        ExpectSame("AwardBonusTuning", t.bonuses, AwardBonusTuning{});
        // Audience taste timeline: event counts per genre from docs/MOVIE_SUCCESS.md 3f, plus the far-future sentinel rows
        // (2100.4 / 2150.4) that the doc mentions and that never trigger.
        CHECK(t.genreEvents.at("action").size() == 13 + 1);
        CHECK(t.genreEvents.at("comedy").size() == 10 + 2);
        CHECK(t.genreEvents.at("horror").size() == 8 + 2);
        CHECK(t.genreEvents.at("romance").size() == 7 + 1);
        CHECK(t.genreEvents.at("sci-fi").size() == 14 + 1);
        CHECK(t.genreEvents.at("action").back().year > 2100.0);
        // the logged trend: action event of 1924.5 (value 1), 0.357 years later the trend was 0.9700
        CHECK(std::fabs(GenreTrend(t.genreEvents.at("action"), 1924.857, t.success) - 0.9700f) < 1e-4f);
        // and before any event the trend is neutral
        CHECK(NearF(GenreTrend(t.genreEvents.at("action"), 1920.0, t.success), 0.5f));
    } else {
        std::printf("game files not found (set OTM_GAME_DATA): skipping the checks against the real data\n");
        if (g_failures) return 1;
        std::printf("inline checks passed\n");
        return 77;
    }

    if (g_failures) {
        std::printf("%d check(s) failed\n", g_failures);
        return 1;
    }
    std::printf("all TuningLoader checks passed\n");
    return 0;
}
