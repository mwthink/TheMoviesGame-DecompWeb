// Loads the movie quality / success / performance tuning constants from the game's data files, so the Tuning structs in
// MovieQuality.hpp, MovieSuccess.hpp and ActorPerformance.hpp hold the values of the installed game instead of the defaults
// copied from the docs.
//
// Sources (extract them with tools/pak_extract.py):
//   releasing_movies.ini  [min_max] [overall] [boredom] [pre_production] [star_mood_step] [genre_fit] [public_interest] [tech] [income]
//   global.ini            [project] (star rating weights), [genre] (saturation boost and half-life)
//   stunts.ini            likeness weights and health threshold (before the first section), [performance]
//   awardsbonuses.ini     award bonus values (before the first section)
//   timeline.csv          [constants] halflife and the dated genre events of the audience taste
// A value that is missing or unreadable keeps the default and is listed in LoadReport::problems; the loader never fails.
#pragma once

#include <map>
#include <string>
#include <vector>

#include "core/Csv.hpp"
#include "core/Ini.hpp"
#include "game/movie/ActorPerformance.hpp"
#include "game/movie/MovieQuality.hpp"
#include "game/movie/MovieSuccess.hpp"

namespace otm::movie {

// Award bonus values (awardsbonuses.ini) the movie formulas use. The key names are matched to the bonus by their names
// (docs/MOVIE_SUCCESS.md 3k-6); Trendsetter and On The Radar are confirmed by logged values, the others by name only.
struct AwardBonusTuning {
    float publicAwarenessBoost = 2.0f;  // public_awareness_boost: On The Radar doubles PR
    float trendsetter = 1.0f;           // trendsetter_boost: replaces the genre trend (pass to GenrePopularity)
    float perfectFit = 2.0f;            // genre_fit_boost: multiplies the genre-fit score (GenreFitScore)
    float brainwasher = 0.5f;           // boredom_factor: multiplies set boredom (BoredomFactor input)
    float lowerMoodThreshold = 0.15f;   // lower_mood_val: Easy To Please (MoodPerformanceFactor)
    float upperMoodThreshold = 0.75f;   // upper_mood_val
};

struct MovieTuning {
    QualityTuning quality;
    SuccessTuning success;
    ActorTuning actor;
    AwardBonusTuning bonuses;
    // Audience taste events per genre (lower-case name without the "genre_" prefix), sorted by year; for GenreTrend.
    std::map<std::string, std::vector<TasteEvent>> genreEvents;
};

struct TuningSources {
    core::IniFile releasingMovies;
    core::IniFile global;
    core::IniFile stunts;
    core::IniFile awardsBonuses;
    std::vector<core::CsvRow> timeline;
};

struct LoadReport {
    std::vector<std::string> problems;  // "file [section] key: missing" and unreadable files
    bool Ok() const { return problems.empty(); }
};

// Builds the tuning from already-parsed sources (no file access: usable in tests).
MovieTuning BuildMovieTuning(const TuningSources& sources, LoadReport& report);

// Reads the five files from a directory. A file that cannot be read is reported and its values keep their defaults.
MovieTuning LoadMovieTuning(const std::string& dataDir, LoadReport& report);

// The dated genre events of timeline.csv, by genre.
std::map<std::string, std::vector<TasteEvent>> ParseGenreEvents(const std::vector<core::CsvRow>& timeline);

}  // namespace otm::movie
