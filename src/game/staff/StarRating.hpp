// A star's rating: how the components (movies, salary, performance, image, ...) combine, and how a film updates the two
// components that come from the star's film record.
//
// Reimplemented from CStar_ComputeStarRating (0x591720), CStar_AddMovieRating / AddPerformanceRating (0x585750 / 0x588070),
// CStar_ComputeEntourageComponent (0x587E40) and CStar_GetAwardsRatingComponent (0x590B00). Derivation: docs/MOVIE_SUCCESS.md
// sections 3aa-3ac.
//
// The salary, relationships, image, trailer and press-bar components depend on game objects and are inputs here: the
// formulas inside them are not all decoded (see the doc). Nothing is verified against the running game.
#pragma once

#include "game/movie/MovieSuccess.hpp"  // DecayValue

namespace otm::staff {

// global.ini [star] and [project]-adjacent keys.
struct StarRatingTuning {
    float weightMovies = 0.174f;         // starratingweightmovies
    float weightSalary = 0.139f;         // starratingweightsalary
    float weightPerformance = 0.139f;    // starratingweightperformance
    float weightImage = 0.104f;          // starratingweightimage
    float weightEntourage = 0.104f;      // starratingweightentourage
    float weightTrailer = 0.104f;        // starratingweighttrailer
    float weightPressBar = 0.102f;       // starratingweightpressbar
    float weightRelationships = 0.07f;   // starratingweightrelationships
    float weightAwards = 0.07f;          // starratingweightawards
    float ratingsMultiplier = 0.4f;      // [star] ratingsmultiplier: share of a film's success/performance that is added
    float ratingsHalfLife = 10.0f;       // [star] ratingshalflife, game years
    float entourageMembersForFull = 6.0f;// the entourage component is members / 6
    float awardsPerAward = 0.5263158f;   // the awards component is awards * 1/1.9 (two awards give the full value)
};

// The nine components, each 0..1 (clamped again here).
struct StarComponents {
    float movies = 0.0f;
    float salary = 0.0f;
    float performance = 0.0f;
    float image = 0.0f;
    float entourage = 0.0f;
    float trailer = 0.0f;
    float pressBar = 0.0f;
    float relationships = 0.0f;
    float awards = 0.0f;
};

// CStar_ComputeStarRating: rating = clamp01(base + sum of clamp01(weight * component)), accumulated in the game's order
// (salary, relationships, image, trailer, entourage, awards, movies, performance, press bar) with a clamp to 0..1 after each
// step. base is the star's unweighted term (+0xCCC).
// orig: 0x00591720
float ComputeStarRating(const StarComponents& c, float base = 0.0f, const StarRatingTuning& t = {});

// CStar_ComputeEntourageComponent for the player's own stars: entourage members / 6, at most 1.
// orig: 0x00587E40
float EntourageComponent(int members, const StarRatingTuning& t = {});

// CStar_GetAwardsRatingComponent: awards won * 0.526, at most 1.
// orig: 0x00590B00
float AwardsComponent(int awardsWon, const StarRatingTuning& t = {});

// CStar_AddMovieRating / CStar_AddPerformanceRating: a released film adds clamp01(ratingsMultiplier * value) to the star's
// decaying value, where value is the film's success clamped to 0..1 (movies) or the star's mean shot performance
// (performance). The component read back is the value clamped to 0..1. nowYear is the game clock in years.
// orig: 0x00585750
// orig: 0x00588070
void AddFilmRating(movie::DecayValue& value, float filmValue, double nowYear, const StarRatingTuning& t = {});

// A new decaying rating value with the configured half-life.
movie::DecayValue NewRatingValue(const StarRatingTuning& t = {});

// CStar_GetMoviesComponent / the performance component: the decayed value clamped to 0..1.
// orig: 0x005857E0
float RatingComponent(const movie::DecayValue& value, double nowYear);

}  // namespace otm::staff
