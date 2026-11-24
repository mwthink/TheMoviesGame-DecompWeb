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
    core/Inflate.cpp
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
    game/boot/CommandLine.cpp
    game/frontend/FrontEnd.cpp
    game/sandbox/SandboxOptions.cpp
    game/character/AnmFile.cpp
    game/character/MshFile.cpp
    game/character/HeadFile.cpp
    game/character/FaceRig.cpp
    game/character/StarFile.cpp
    game/character/Appearance.cpp
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

# The face rig, star file and appearance rules. Needs extracted game files for the rig parts (data/game_data/sm_assets, see CharacterTest.cpp)
# and saved StarMaker stars in OTM_STAR_DIR; without them only the inline checks run.
add_executable(character_test tests/CharacterTest.cpp)
target_link_libraries(character_test PRIVATE otm_game)
target_include_directories(character_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
add_test(NAME character COMMAND character_test)
set_tests_properties(character PROPERTIES
    ENVIRONMENT "OTM_GAME_DATA=${CMAKE_CURRENT_SOURCE_DIR}/../data/game_data"
    SKIP_RETURN_CODE 77)

# The command-line switches (-reenter, -editor, -download, -safemode); docs/BOOT.md.
add_executable(command_line_test tests/CommandLineTest.cpp)
target_link_libraries(command_line_test PRIVATE otm_game)
add_test(NAME command_line COMMAND command_line_test)

# The main menu (WFrontEnd): state machine, event handler and tables; docs/FRONTEND.md.
add_executable(front_end_test tests/FrontEndTest.cpp)
target_link_libraries(front_end_test PRIVATE otm_game)
add_test(NAME front_end COMMAND front_end_test)

# The nine start options (CSandbox Option[0..8]) and the sandbox checkboxes; docs/FRONTEND.md.
add_executable(sandbox_options_test tests/SandboxOptionsTest.cpp)
target_link_libraries(sandbox_options_test PRIVATE otm_game)
add_test(NAME sandbox_options COMMAND sandbox_options_test)
