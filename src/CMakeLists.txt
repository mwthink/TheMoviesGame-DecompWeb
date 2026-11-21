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
