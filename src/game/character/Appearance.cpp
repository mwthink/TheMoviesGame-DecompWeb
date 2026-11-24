#include "game/character/Appearance.hpp"

#include <cstdio>
#include <cstring>

namespace otm::character {

int MakeupCategoryForParamType(int paramType) {
    switch (paramType) {
        case 2: return 1;
        case 4: return 2;
        case 5: return 3;
        case 6: return 8;
        case 10: return 5;
        case 11: return 6;
        case 12: return 7;
        case 13: return 4;
        default: return 0;
    }
}

std::string MakeupLayerFileName(MakeupCategory category, int index) {
    if (index < 1) return "";
    const char* prefix = nullptr;
    switch (category) {
        case MakeupCategory::EyeMakeupShape:
        case MakeupCategory::EyeMakeupColour: prefix = "mup_eyes_v"; break;
        case MakeupCategory::Lips: prefix = "mup_lips_v"; break;
        case MakeupCategory::Beard: prefix = "mup_beard_v"; break;
        case MakeupCategory::Tattoo: prefix = "mup_tatoo_v"; break;
        case MakeupCategory::MaleEyebrow: prefix = "mup_meyebrow_v"; break;
        case MakeupCategory::FemaleEyebrow: prefix = "mup_feyebrow_v"; break;
        case MakeupCategory::Nails: prefix = "mup_nails_v"; break;
        case MakeupCategory::Mask: prefix = "mup_mask_v"; break;
        default: return "";
    }
    char buf[64];
    std::snprintf(buf, sizeof buf, index - 1 > 9 ? "%s%d.dds" : "%s0%d.dds", prefix, index - 1);
    return buf;
}

const char* HairColourSuffix(int index) {
    static const char* const table[6] = {"", "_bd", "_bk", "_rd", "_db", "_px"};
    return index >= 0 && index < 6 ? table[index] : "";
}

UvOffset IrisUvOffset(int index) {
    const int cell = index < 0 ? 0 : index % 8;
    return {(cell % 4) * 0.25f, (cell / 4) * 0.25f};
}

std::string HairTextureFile(const std::string& stem, int hairColour) { return stem + HairColourSuffix(hairColour) + ".dds"; }

std::vector<FaceLayer> BuildFaceLayerPlan(const StarInfo& star, bool hairIsTexture) {
    std::vector<FaceLayer> plan;
    const int alpha = GreyOverlayAlpha(AgeMorphFromYears(AgeYearsFromSlider(star.ageSlider)));
    const char* suffix = HairColourSuffix(static_cast<int>(star.hairColour));
    if (star.eyeMakeup >= 1 && star.makeupColour >= 1) {
        FaceLayer l;
        l.file = MakeupLayerFileName(MakeupCategory::EyeMakeupShape, static_cast<int>(star.eyeMakeup));
        l.colourFile = MakeupLayerFileName(MakeupCategory::EyeMakeupColour, static_cast<int>(star.makeupColour));
        plan.push_back(l);
    }
    if (star.lipstick >= 1) plan.push_back({MakeupLayerFileName(MakeupCategory::Lips, static_cast<int>(star.lipstick)), "", "", 0});
    if (star.beard >= 1) {
        std::string f = MakeupLayerFileName(MakeupCategory::Beard, static_cast<int>(star.beard));
        const std::string stem = f.substr(0, f.size() - 4);
        plan.push_back({stem + suffix + ".dds", "", stem + suffix + "_gy.dds", alpha});
    }
    if (star.eyebrow >= 1)
        plan.push_back({MakeupLayerFileName(star.gender == 1 ? MakeupCategory::MaleEyebrow : MakeupCategory::FemaleEyebrow, static_cast<int>(star.eyebrow)), "", "", 0});
    if (hairIsTexture && star.hair.size() > 4) {
        const std::string stem = star.hair.substr(0, star.hair.size() - 4);
        plan.push_back({stem + suffix + ".dds", "", stem + suffix + "_gy.dds", alpha});
    }
    return plan;
}

bool ParseFan(const std::string& bytes, FanFile& out) {
    if (bytes.size() < 28) return false;
    uint32_t w[7];
    std::memcpy(w, bytes.data(), 28);
    float f;
    std::memcpy(&f, &w[3], 4);
    out.entries = w[0];
    out.frame = w[2];
    out.intensity = f;
    out.flagWord = w[5];
    return true;
}

std::string ExpressionAnimationFile(const std::string& headFile) {
    if (headFile.size() < 9 || (headFile.compare(0, 7, "head_f_") != 0 && headFile.compare(0, 7, "head_m_") != 0)) return "";
    if (headFile.compare(headFile.size() - 3, 3, ".hd") != 0) return "";
    return "fe_" + headFile.substr(5, headFile.size() - 5 - 3) + ".anm";
}

}  // namespace otm::character
