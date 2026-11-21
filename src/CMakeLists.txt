cmake_minimum_required(VERSION 3.20)
project(OpenTheMovies LANGUAGES CXX)

# The reimplementation. Plain portable C++17 with no platform dependencies so it builds and tests anywhere
# (the injected debugger in ../debugger is the Windows/32-bit part).
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(otm_game
    game/movie/MovieQuality.cpp
)
target_include_directories(otm_game PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

enable_testing()
add_executable(movie_quality_test tests/MovieQualityTest.cpp)
target_link_libraries(movie_quality_test PRIVATE otm_game)
add_test(NAME movie_quality COMMAND movie_quality_test)
