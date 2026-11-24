// The face rig: a skeleton of face bones posed from an animation, with the head mesh skinned to it (4 weights per vertex).
//
// Two users share it (docs/STARMAKER.md sections 7 and 8):
//   * the StarMaker face sliders: sm_generic.msh (108 bones) + mannequin_sm.anm (frame 0 = base pose; a slider owns frames a, a+1, a+2 =
//     minimum, neutral, maximum, and its value v selects the frame a + 1.99 * v);
//   * facial expressions (.fan files): generic_facialskin.msh (65 bones: 30 body bones + 35 face bones) + the head's fe_<head>.anm (53 frames,
//     one per expression index, 35 channels = the face bones), blended with an intensity.
//
// Reimplemented from StarMaker's slider code (StarMaker_ApplyAllSliders 0x0040EDD9, FaceSlider_PoseAtValue 0x004066A1, FaceSlider_SkinHeadAtValue
// 0x0040676B) and the shared pose code (AnimInstance_EvaluatePose, game 0x00A03C40). The game's own use for expressions is
// FaceController_SetExpression (0x00A304F0) and its update functions (0x00A30990, 0x00A30CB0).
#pragma once

#include <string>
#include <vector>

#include "game/character/AnmFile.hpp"
#include "game/character/MshFile.hpp"
#include "game/character/RigidMatrix.hpp"

namespace otm::character {

// One line of Data\StarMaker\starmaker.ini: `[group] [name] [a][b]`. `a` is the slider's first animation frame (not 1 + 3 * index: the ini
// has gaps, e.g. teeth_move_in_out has a = 130), `b` the colour of the arrow in the slider's picture (0 x, 1 y, 2 z): not part of the mechanism.
struct SliderDef {
    std::string group, name;
    int firstFrame = 0;
    int axis = 0;
};

constexpr int kSliderCount = 43;
constexpr float kSliderNeutral = 0.5f;

// orig: StarMaker_ParseSliderIni 0x00406354 (editor only)
std::vector<SliderDef> ParseSliderIni(const std::string& text);

// The animation frame of a slider at a value in [0, 1]: a + 1.99 * v (the game stores frames in hundredths: a * 100 - round(v * -199)).
// orig: FaceSlider_PoseAtValue 0x004066A1
inline double SliderFrame(const SliderDef& s, float value) { return s.firstFrame + 1.99 * value; }

class FaceRig {
public:
    // The mesh needs skin records on every primitive; the animation's channels map to the mesh's LAST bones.
    bool Init(MshFile mesh, AnmFile anim, std::string* err = nullptr);

    int VertexCount() const { return static_cast<int>(skin_.size()); }
    // The mesh's own vertex positions (the bind shape), concatenated over the primitives.
    std::vector<Vec3> BindPositions() const;
    const MshFile& Mesh() const { return mesh_; }
    const AnmFile& Anim() const { return anim_; }

    // Skin matrices (inverse bind world x current world) for a fractional animation frame: the two neighbouring frames are interpolated
    // linearly (rotations and translations), then chained up the bone tree. Body bones stay at their bind pose.
    // orig: AnimInstance_EvaluatePose 0x00A03C40 (the sampling), Mesh_GetPrimitiveSkinRecords 0x009D9D50 (the weights)
    std::vector<RigidMatrix> SkinMatrices(double frame) const;

    // The weighted sum of each vertex moved by its four bones' skin matrices at the frame.
    std::vector<Vec3> Skin(const std::vector<Vec3>& positions, double frame) const;

private:
    MshFile mesh_;
    AnmFile anim_;
    std::vector<MshSkin> skin_;
    std::vector<RigidMatrix> invBind_;
    int firstAnimated_ = 0;
};

enum class SliderMode {
    // What the editor does: each slider's pass REPLACES the positions with the skinned ones at its frame, in ini order (the neutral frame is
    // not exactly the identity, so 43 neutral passes add up to about a millimetre).
    Replace,
    // The change a slider makes relative to its neutral frame (a + 1), added to the current positions: this is what a difference between two
    // saved stars shows. Used to check the sliders against saved star.hd files.
    DeltaFromNeutral,
};

// Applies the sliders (values in ini order, 0.5 = neutral) to the head positions. orig: StarMaker_ApplyAllSliders 0x0040EDD9
std::vector<Vec3> ApplyFaceSliders(const FaceRig& rig, const std::vector<SliderDef>& defs, const float values[kSliderCount],
                                   std::vector<Vec3> positions, SliderMode mode);

// Facial expression: the positions moved to frame `expressionFrame` of the head's expression animation, blended by intensity (0 = unchanged,
// 1 = the full pose). The blending rule is the renderer's choice (linear towards the bind pose); the game scales the pose weight by an envelope.
// orig: FaceController_SetExpression 0x00A304F0 (selection), FUN_00A30CB0 (weighting)
std::vector<Vec3> ApplyExpression(const FaceRig& rig, const std::vector<Vec3>& positions, int expressionFrame, float intensity);

// The face controller's envelope: ticks 0..200 rise, 200..400 fall (weight 0..1..0); the stored scale is 0.005 per tick.
// orig: FUN_00A30CB0 (the 200.0 / 0.005 constants)
float ExpressionEnvelope(float ticks);

}  // namespace otm::character
