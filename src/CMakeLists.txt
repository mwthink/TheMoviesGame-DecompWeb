cmake_minimum_required(VERSION 3.20)
project(OpenTheMovies LANGUAGES CXX)

# The reimplementation. Plain portable C++17 with no platform dependencies so it builds and tests anywhere
# (the injected debugger in ../debugger is the Windows/32-bit part).
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(otm_game
    core/Strings.cpp
    core/File.cpp
    core/Ini.cpp
    core/Csv.cpp
    game/movie/MovieQuality.cpp
    game/movie/MovieSuccess.cpp
    game/movie/ActorPerformance.cpp
    game/movie/TuningLoader.cpp
    game/movie/MovieEstimate.cpp
    game/ai/AiStudio.cpp
    game/studio/StudioRating.cpp
    game/staff/Traits.cpp
    game/staff/Stunts.cpp
    game/staff/StarRating.cpp
    game/staff/StaffTuningLoader.cpp
    game/boot/IntroSequence.cpp
)
target_include_directories(otm_game PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

enable_testing()
add_executable(movie_quality_test tests/MovieQualityTest.cpp)
target_link_libraries(movie_quality_test PRIVATE otm_game)
add_test(NAME movie_quality COMMAND movie_quality_test)

add_executable(movie_success_test tests/MovieSuccessTest.cpp)
target_link_libraries(movie_success_test PRIVATE otm_game)
add_test(NAME movie_success COMMAND movie_success_test)

add_executable(actor_performance_test tests/ActorPerformanceTest.cpp)
target_link_libraries(actor_performance_test PRIVATE otm_game)
add_test(NAME actor_performance COMMAND actor_performance_test)

add_executable(ai_studio_test tests/AiStudioTest.cpp)
target_link_libraries(ai_studio_test PRIVATE otm_game)
add_test(NAME ai_studio COMMAND ai_studio_test)

add_executable(studio_rating_test tests/StudioRatingTest.cpp)
target_link_libraries(studio_rating_test PRIVATE otm_game)
add_test(NAME studio_rating COMMAND studio_rating_test)

add_executable(core_test tests/CoreTest.cpp)
target_link_libraries(core_test PRIVATE otm_game)
add_test(NAME core COMMAND core_test)

# Checks the loader against the real game files when they have been extracted (tools/pak_extract.py -> data/game_data);
# otherwise only the inline checks run and the test is reported as skipped.
add_executable(tuning_loader_test tests/TuningLoaderTest.cpp)
target_link_libraries(tuning_loader_test PRIVATE otm_game)
add_test(NAME tuning_loader COMMAND tuning_loader_test)
set_tests_properties(tuning_loader PROPERTIES
    ENVIRONMENT "OTM_GAME_DATA=${CMAKE_CURRENT_SOURCE_DIR}/../data/game_data"
    SKIP_RETURN_CODE 77)

add_executable(staff_test tests/StaffTest.cpp)
target_link_libraries(staff_test PRIVATE otm_game)
add_test(NAME staff COMMAND staff_test)
set_tests_properties(staff PROPERTIES
    ENVIRONMENT "OTM_GAME_DATA=${CMAKE_CURRENT_SOURCE_DIR}/../data/game_data"
    SKIP_RETURN_CODE 77)

# otm_movie_calc: estimate a movie's quality, success and box office, and compare marketing levels.
add_executable(otm_movie_calc apps/MovieCalc.cpp)
target_link_libraries(otm_movie_calc PRIVATE otm_game)

add_executable(estimate_test tests/EstimateTest.cpp)
target_link_libraries(estimate_test PRIVATE otm_game)
add_test(NAME estimate COMMAND estimate_test)

# The intro splash sequence and WinMain's boot fork (docs/BOOT.md).
add_executable(intro_sequence_test tests/IntroSequenceTest.cpp)
target_link_libraries(intro_sequence_test PRIVATE otm_game)
add_test(NAME intro_sequence COMMAND intro_sequence_test)
