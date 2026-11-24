// The StarMaker star file (Documents\The Movies\StarMaker\<yyyy_mm_dd_hh_mm_ss>\info.sm). Layout: docs/STARMAKER.md section 6; every field was
// matched to a control with saved stars and to the editor's load code (StarMaker_ApplyInfoSmToUI 0x004043EB) and save code (StarMaker_BuildInfoSm
// 0x00407D7F, StarMaker_ReadInfoSm 0x00427180).
//
//   0x00 u32 version (2)     0x04 u32 file size       0x08 u32 id (a checksum of the data; the algorithm is not known, kept as read)
//   0x0c u32 gender (1 male, 0 female)
//   0x10 14 x f32 attributes: looks, trimness, chest/breast, action, comedy, horror, romance, sci-fi, stress, boredom, drink, food, mood upper, mood lower
//        (the order of the last six is a guess; looks and trimness are confirmed)
//   0x48 char[32] first head file     0x68 char[32] second head file (empty if none)     0x88 char[32] hair file
//   0xa8 f32 head shape blend slider  0xac f32 skin tone blend slider  0xb0 u32 eye colour  0xb4 f32 age slider  0xb8 u32 hair colour
//   0xbc..0xcc 5 x u32 makeup choices: eyebrows, eye makeup, eye makeup colour, facial hair, lipstick
//   0xd0 43 x f32 face sliders (0.5 neutral)     0x17c u32 0 (a pointer slot filled at load time)     0x180 UTF-16 name, NUL terminated
#pragma once

#include <array>
#include <cstdint>
#include <string>

#include "game/character/HeadFile.hpp"

namespace otm::character {

struct StarInfo {
    uint32_t version = 2;
    uint32_t id = 0;
    uint32_t gender = 1;
    std::array<float, 14> attributes{};
    std::string head0, head1, hair;
    float headBlend = 0.5f, skinBlend = 0.5f;
    uint32_t eyeColour = 0;
    float ageSlider = 0.0f;
    uint32_t hairColour = 0;
    uint32_t eyebrow = 1, eyeMakeup = 0, makeupColour = 1, beard = 0, lipstick = 0;
    std::array<float, 43> sliders{};
    std::u16string name;
};

enum Attribute { kLooks = 0, kTrimness = 1, kChest = 2 };

constexpr uint32_t kInfoSmVersion = 2;
constexpr size_t kInfoSmFixedSize = 0x182;      // size = 0x182 + 2 * name length (the name's terminator is included)

// orig: StarMaker_ReadInfoSm 0x00427180 (checks the version is 2)
bool ParseInfoSm(const std::string& bytes, StarInfo& out, std::string* err = nullptr);
// orig: StarMaker_BuildInfoSm 0x00407D7F
std::string BuildInfoSm(const StarInfo& info);

// The age slider: years = slider * 47 + 18 (18..65). orig: StarMaker_AgeFromSlider 0x00427130
inline float AgeYearsFromSlider(float slider) { return slider * 47.0f + 18.0f; }

// The age morph amount for an age in years: 0 below 30, +0.025 per year, 1.0 at 70. orig: CharacterModel_SetAgeMorph 0x009D63A0
inline float AgeMorphFromYears(float years) {
    float m = (years - 30.0f) * 0.025f;
    return m < 0 ? 0 : (m > 1 ? 1 : m);
}

// The head texture names a star.hd carries in its header, and the shared blend rules.
struct StarHeadInfo {
    std::string texture0, texture1;
};

// Where a saved star's head comes from: the finished .hd (positions with the head blend and the face sliders already applied; array B is the
// weight morph and C the age morph, both at full amount). orig: StarMaker_WriteStarHd 0x004070B1
inline StarHeadInfo StarHeadFromHd(const HeadFile& hd) { return {hd.names[0], hd.names[1]}; }

}  // namespace otm::character
