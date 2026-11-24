// Reader for The Movies .anm animations (version 12). Format notes: docs/ANM_FORMAT.md, tools/anm_dump.py.
//
// Reimplemented from Anim_ReadHeader (0x00984AD0), Anim_ReadSetHeader (0x00984B40), Anim_ReadTrackSet (0x009859C0), Anim_ReadChannel
// (0x00A4E030), Anim_ExpandChannel (0x00A4DB20), Anim_BuildTranslationTable (0x009852C0) and the Euler-to-matrix conversion (0x009AB3F0).
// Only what the face rig needs is kept: per channel and frame a rotation and a translation, local to the channel's parent.
#pragma once

#include <string>
#include <vector>

#include "game/character/RigidMatrix.hpp"

namespace otm::character {

struct AnmFile {
    int version = 0;
    int frameCount = 0;
    int channelCount = 0;
    float translationScale = 10.0f;
    std::vector<int> parents;                       // per channel, -1 = no parent in this animation
    std::vector<std::vector<RigidMatrix>> frames;   // frames[t][channel]

    // Parses a whole file (plain or `zcmp`). On failure returns false and, if err is not null, says why.
    // orig: 0x00984AD0 (and the functions listed above)
    static bool Parse(const std::string& fileBytes, AnmFile& out, std::string* err = nullptr);
};

}  // namespace otm::character
