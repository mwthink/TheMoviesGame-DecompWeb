// otm_movie_calc: estimates a movie's quality, success and box office from plain inputs, and compares marketing levels.
//
//   otm_movie_calc --script 0.6 --stars 0.7,0.5 --hype 0.3 --marketing 3
//   otm_movie_calc --quality 0.62 --hype 0.31 --compare-marketing --tech --stars 0.94
//
// Tuning comes from the game's data files when --data <dir> is given (or ./data/game_data exists); otherwise the built-in
// defaults, which are the shipped values. Run with --help for the options.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "core/Strings.hpp"
#include "game/movie/MovieEstimate.hpp"
#include "game/movie/TuningLoader.hpp"

using namespace otm;
using namespace otm::movie;

static void Usage() {
    std::printf(
        "usage: otm_movie_calc [options]\n"
        "quality:  --script S        script quality 0..1 (default 0.6)\n"
        "          --cast-perf P     mean actor performance (default 1.0)\n"
        "          --chemistry C     mean relationship between cast stars 0..1 (default 0.5)\n"
        "          --no-stars        the movie has no stars (relationship factor 0.8)\n"
        "          --set-repair R    0..1 (default 1)      --crew M   mean crew 'Movies' trait (default 0.5 = neutral)\n"
        "          --preprod N       pre-production updates (default 3000 = full weight; 10 per second)\n"
        "          --quality Q       skip the quality chain and use Q as the movie's quality\n"
        "market:   --stars a,b,c     the cast stars' ratings (default none)\n"
        "          --trend T         audience taste for the genre 0..1 (default 0.5)\n"
        "          --saturation S    genre saturation 0..1 (default 0)     --trendsetter   Trendsetter bonus active\n"
        "          --sets a,b,c      boredom of each set (default one fresh set)\n"
        "          --cast-boredom a,b  boredom of each cast member and the director\n"
        "          --tech            a moviemaking technology is ahead of its time (x1.1)\n"
        "          --hype H          accumulated PR hype 0..1 (default 0)   --on-the-radar   On The Radar bonus active\n"
        "          --marketing L     marketing level 0..5 (default 1: none)\n"
        "          --symmetric-imbalance   read the hype/marketing imbalance as |hype - D| (the older notes' reading)\n"
        "other:    --compare-marketing     table of levels 1..5        --data DIR   directory with the game's .ini files\n");
}

static std::vector<float> List(const char* text) {
    std::vector<float> v;
    for (std::string_view part : core::Split(text, ',')) {
        if (const auto d = core::ParseDouble(part)) v.push_back(static_cast<float>(*d));
    }
    return v;
}

static void PrintResult(const EstimateInput& in, const EstimateResult& r) {
    std::printf("quality   shot %.4f   movie Qm %.4f\n", r.shotQuality, r.finalQuality);
    std::printf("market    PI %.4f (hype counted %.3f, marketing D %.3f, coverage %.3f)   SR %.4f   GP %.4f   BO %.4f   TP %.2f\n",
                r.factors.publicInterest, r.cappedHype, r.marketingD, r.coverage, r.factors.starRatings, r.factors.genrePopularity,
                r.factors.boredom, r.factors.techPioneering);
    std::printf("success   S %.4f   star rating %.4f\n", r.success, r.starRating);
    std::printf("revenue   box office $%.0f   marketing level %d costs $%.0f   net $%.0f   %.0f%% paid in the first year\n", r.boxOffice,
                in.marketingLevel, r.marketingCost, r.netBoxOffice, 100.0 * r.firstYearShare);
}

int main(int argc, char** argv) {
    EstimateInput in;
    std::string dataDir;
    bool compare = false;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        const auto next = [&]() -> const char* {
            if (i + 1 >= argc) {
                std::fprintf(stderr, "missing value for %s\n", a.c_str());
                std::exit(2);
            }
            return argv[++i];
        };
        const auto number = [&]() { return static_cast<float>(std::atof(next())); };
        if (a == "--help" || a == "-h") { Usage(); return 0; }
        else if (a == "--script") in.scriptQuality = number();
        else if (a == "--cast-perf") in.castPerformance = number();
        else if (a == "--chemistry") in.chemistry = number();
        else if (a == "--no-stars") in.hasStars = false;
        else if (a == "--set-repair") in.setRepair = number();
        else if (a == "--crew") in.crewMoviesTrait = number();
        else if (a == "--preprod") in.preProductionTicks = static_cast<unsigned>(std::atof(next()));
        else if (a == "--quality") in.qualityOverride = number();
        else if (a == "--stars") in.starRatings = List(next());
        else if (a == "--trend") in.genreTrend = number();
        else if (a == "--saturation") in.genreSaturation = number();
        else if (a == "--trendsetter") in.trendsetter = true;
        else if (a == "--sets") in.setBoredom = List(next());
        else if (a == "--cast-boredom") in.castBoredom = List(next());
        else if (a == "--tech") in.techPioneer = true;
        else if (a == "--hype") in.hype = number();
        else if (a == "--on-the-radar") in.onTheRadar = true;
        else if (a == "--marketing") in.marketingLevel = std::atoi(next());
        else if (a == "--symmetric-imbalance") in.symmetricImbalance = true;
        else if (a == "--compare-marketing") compare = true;
        else if (a == "--data") dataDir = next();
        else { std::fprintf(stderr, "unknown option %s (try --help)\n", a.c_str()); return 2; }
    }

    MovieTuning tuning;
    if (dataDir.empty()) {
        core::IniFile probe;
        if (core::IniFile::Load("data/game_data/releasing_movies.ini", probe)) dataDir = "data/game_data";
    }
    if (!dataDir.empty()) {
        LoadReport report;
        tuning = LoadMovieTuning(dataDir, report);
        for (const std::string& p : report.problems) std::fprintf(stderr, "tuning: %s\n", p.c_str());
        std::printf("tuning from %s\n", dataDir.c_str());
    } else {
        std::printf("tuning: built-in defaults (the shipped values)\n");
    }

    if (!compare) {
        PrintResult(in, EstimateMovie(in, tuning.success, tuning.quality));
        return 0;
    }
    const std::vector<EstimateResult> levels = CompareMarketingLevels(in, tuning.success, tuning.quality);
    std::printf("Qm %.4f   hype counted %.3f\n", levels[0].finalQuality, levels[0].cappedHype);
    std::printf("level  cost       D      PI      S       box office   net of cost   vs level 1\n");
    int best = 0;
    for (int i = 0; i < 5; ++i) {
        const EstimateResult& r = levels[i];
        std::printf("%5d  %8.0f  %.3f  %.4f  %.4f  %11.0f  %12.0f  %+10.0f\n", i + 1, r.marketingCost, r.marketingD, r.factors.publicInterest,
                    r.success, r.boxOffice, r.netBoxOffice, r.netBoxOffice - levels[0].netBoxOffice);
        if (r.netBoxOffice > levels[best].netBoxOffice) best = i;
    }
    std::printf("best level: %d\n", best + 1);
    return 0;
}
