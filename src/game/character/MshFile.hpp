// Reader for the parts of a The Movies .msh model the character code needs: render primitives (vertices, triangles, 4-weight skin records)
// and the skeleton. Layout: docs/MSH_FORMAT.md, tools/msh_dump.py.
//
// Reimplemented from LH_LoadMeshBinary (0x009DEB10); the skin record is the `f0 & 1` block (20 bytes per vertex: 4 f32 weights and 4 u8 bone
// indices), read by Mesh_GetPrimitiveSkinRecords (0x009D9D50).
#pragma once

#include <array>
#include <string>
#include <vector>

#include "game/character/RigidMatrix.hpp"

namespace otm::character {

struct MshVertex {
    float pos[3];
    float normal[3];
    float uv[2];
};

struct MshSkin {
    float weight[4];
    unsigned char bone[4];
};

struct MshPrimitive {
    int material = 0;
    std::vector<MshVertex> vertices;
    std::vector<std::array<unsigned short, 3>> triangles;
    std::vector<MshSkin> skin;   // empty when the primitive has no skin block
};

struct MshBone {
    std::string name;
    int parent = -1;
    RigidMatrix bindWorld;       // the bone's world bind pose: three axis rows plus the translation (row-vector convention)
};

struct MshFile {
    std::vector<std::string> textures;
    std::vector<MshPrimitive> primitives;   // all nodes' primitives in file order
    std::vector<MshBone> bones;

    // orig: 0x009DEB10
    static bool Parse(const std::string& fileBytes, MshFile& out, std::string* err = nullptr);
};

}  // namespace otm::character
