// The .hd head morph files (Data\Heads\*.hd, and the star.hd a StarMaker star saves). Layout: docs/CHARACTERS.md, tools/hd_dump.py.
//
//   0x00  u32 4, u32 hash, u32 hash
//   0x0c  texture name, NUL padded, 32 bytes (a star.hd also has a second texture at 0x2c and the head file names at 0x4c / 0x6c)
//   0x94  three arrays of 996 vertices x 6 floats (position, normal): A = the base shape, B = the weight morph, C = the age morph
//
// vertex = A + weight * B + age * C; two heads are mixed with (1 - mix) / mix; normals are summed alike and renormalised.
// Reimplemented from CharacterHead_ApplyHdMorph (0x009DB5F0); the array roles are confirmed by StarMaker's star.hd writer (docs/STARMAKER.md 10).
#pragma once

#include <array>
#include <string>
#include <vector>

namespace otm::character {

constexpr int kHeadVertexCount = 996;      // 760 face + 58 eyes + 178 mouth interior, the vertices of generic_head.msh / generic_facialskin.msh

struct HeadVertex {
    float pos[3];
    float normal[3];
};

struct HeadFile {
    std::string names[4];                          // 0x0c texture 0, 0x2c texture 1, 0x4c head 0, 0x6c head 1 (empty where absent)
    std::vector<HeadVertex> a, b, c;               // 996 each

    static bool Parse(const std::string& bytes, HeadFile& out, std::string* err = nullptr);
    // The three arrays written back to a file (header words and names copied from `header`, which must be at least 0x94 bytes).
    std::string Serialize(const std::string& header) const;
};

// orig: 0x009DB5F0. second may be null (then mix is ignored). weight and age are the morph amounts 0..1.
void ApplyHdMorph(const HeadFile& first, const HeadFile* second, float mix, float weight, float age, std::vector<HeadVertex>& out);

}  // namespace otm::character
