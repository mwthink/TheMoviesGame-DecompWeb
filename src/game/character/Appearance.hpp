// How a star's looks are put together, from the character parameters: makeup layer file names, the draw order of the face texture layers,
// hair, iris and age effects. Docs: docs/STARMAKER.md sections 9 and 10. The functions are shared engine code, so the same rules build every
// character's face in the game.
//
// Pixel work (decoding the DDS layers, alpha-over compositing) is not here; this produces the plan: which files, in which order, with which weights.
#pragma once

#include <string>
#include <vector>

#include "game/character/StarFile.hpp"

namespace otm::character {

// Makeup categories (the argument of MakeupLayer_GetFileName). Categories 0 and 1 both name `mup_eyes_v` files.
enum class MakeupCategory : int {
    EyeMakeupShape = 0,
    EyeMakeupColour = 1,
    Lips = 2,
    Beard = 3,
    Tattoo = 4,
    MaleEyebrow = 5,
    FemaleEyebrow = 6,
    Nails = 7,
    Mask = 8,
};

// The character parameter types and the categories they select (a switch in the game).
// orig: CharacterParam_TypeToMakeupCategory 0x009CD5E0
enum class ParamType : int {
    EyeMakeupColour = 2, EyeMakeupShape = 3, Lipstick = 4, FacialHair = 5, Mask = 6, MaleEyebrow = 10, FemaleEyebrow = 11, Nails = 12, Tattoo = 13,
};
int MakeupCategoryForParamType(int paramType);          // unknown types give 0

// The layer file name for a choice: "" for index 0 (none), else <prefix> + (index - 1) in two digits + ".dds" (more digits for 100 and over).
// orig: MakeupLayer_GetFileName 0x00A5EE00
std::string MakeupLayerFileName(MakeupCategory category, int index);

// The number of choices of a category with `fileCount` files (the highest file index + 1), including "none": fileCount + 1.
// orig: MakeupLayer_GetOptionCount 0x00A5EF20
inline int MakeupOptionCount(int fileCount) { return fileCount + 1; }

// The hair colour suffix table of the exe (index 0..5): "", _bd (blond), _bk (black), _rd (red), _db (dark brown), _px (platinum).
const char* HairColourSuffix(int index);

// Eye colour: the atlas eyes.dds (256x256) holds the eight irises in two rows of four 64-pixel cells; the eye mesh's UVs sit in cell 0.
// Returns the UV offset of iris `index` (0..7).
struct UvOffset { float u, v; };
UvOffset IrisUvOffset(int index);

// Hair and beard textures show their grey (`_gy`) variant blended over the coloured one at alpha = the age morph.
// orig: CharacterHead_ComposeHairTexture 0x00A176D0, CharacterHead_ComposeFaceLayers 0x00A17300
inline int GreyOverlayAlpha(float ageMorph) {
    const int a = static_cast<int>(ageMorph * 255.0f + 0.5f);
    return a < 0 ? 0 : (a > 255 ? 255 : a);
}

struct FaceLayer {
    std::string file;               // the layer file (512x512 DXT5 with alpha, in the face texture's UVs)
    std::string colourFile;         // eye makeup only: the colour layer drawn with the shape (file = shape)
    std::string greyFile;           // beard and hair: the `_gy` variant to blend over `file`
    int greyAlpha = 0;              // 0..255, = GreyOverlayAlpha(age morph)
};

// The face texture layers in draw order, over the base head texture (two head textures mixed by the skin blend first). Slot order of the game:
// eye makeup pair (only when a shape is chosen; the colour alone draws nothing), lips, beard, tattoo (not used by stars), eyebrows (male or
// female by gender), nails (skipped), mask; a texture-layer hair style (a .msh with no geometry) comes last. `hairIsTexture` says whether the
// hair file has no geometry (the caller reads that from the .msh).
// orig: CharacterHead_ComposeFaceLayers 0x00A17300
std::vector<FaceLayer> BuildFaceLayerPlan(const StarInfo& star, bool hairIsTexture);

// The texture file of a hair mesh or layer for a colour: stem (the file name without .msh/.dds) + suffix + ".dds".
std::string HairTextureFile(const std::string& stem, int hairColour);

// --- facial expressions (docs/STARMAKER.md section 8) ---

// A .fan file (Data\Animations\Facials\<name>.fan, 28 bytes): [entry count, 0, expression frame, intensity, 0, flag word, 0].
// `frame` is the frame of the head's expression animation, `intensity` the strength it is played at. The flag word (99, 998, 9998 ...) is not understood.
struct FanFile {
    uint32_t entries = 0;
    uint32_t frame = 0;
    float intensity = 1.0f;
    uint32_t flagWord = 0;
};
constexpr int kExpressionFrameCount = 53;       // valid frames 0..52 (FaceController_SetExpression rejects anything else)

bool ParseFan(const std::string& bytes, FanFile& out);

// The expression animation of a head file: "head_m_white_joe.hd" -> "fe_m_white_joe.anm" ("" for a name that is not head_f_* / head_m_* .hd).
// orig: FUN_00A30360 (the name builder used by FUN_00A31110)
std::string ExpressionAnimationFile(const std::string& headFile);

}  // namespace otm::character
