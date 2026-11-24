#include "game/character/FaceRig.hpp"

#include <cmath>
#include <cstdlib>

namespace otm::character {

std::vector<SliderDef> ParseSliderIni(const std::string& text) {
    std::vector<SliderDef> out;
    size_t pos = 0;
    while (pos < text.size()) {
        size_t end = text.find('\n', pos);
        if (end == std::string::npos) end = text.size();
        const std::string line = text.substr(pos, end - pos);
        pos = end + 1;
        std::vector<std::string> fields;
        size_t i = 0;
        while ((i = line.find('[', i)) != std::string::npos) {
            const size_t j = line.find(']', i);
            if (j == std::string::npos) break;
            fields.push_back(line.substr(i + 1, j - i - 1));
            i = j + 1;
        }
        if (fields.size() < 4) continue;
        SliderDef d;
        d.group = fields[0];
        d.name = fields[1];
        d.firstFrame = std::atoi(fields[2].c_str());
        d.axis = std::atoi(fields[3].c_str());
        out.push_back(d);
    }
    return out;
}

bool FaceRig::Init(MshFile mesh, AnmFile anim, std::string* err) {
    auto fail = [&](const char* why) { if (err) *err = why; return false; };
    mesh_ = std::move(mesh);
    anim_ = std::move(anim);
    skin_.clear();
    for (const MshPrimitive& p : mesh_.primitives) {
        if (p.skin.size() != p.vertices.size()) return fail("a primitive has no skin records");
        skin_.insert(skin_.end(), p.skin.begin(), p.skin.end());
    }
    if (mesh_.bones.empty() || static_cast<int>(mesh_.bones.size()) < anim_.channelCount) return fail("mesh has fewer bones than the animation has channels");
    firstAnimated_ = static_cast<int>(mesh_.bones.size()) - anim_.channelCount;
    invBind_.clear();
    for (const MshBone& b : mesh_.bones) invBind_.push_back(InverseRigid(b.bindWorld));
    return true;
}

std::vector<Vec3> FaceRig::BindPositions() const {
    std::vector<Vec3> out;
    for (const MshPrimitive& p : mesh_.primitives)
        for (const MshVertex& v : p.vertices) out.push_back({v.pos[0], v.pos[1], v.pos[2]});
    return out;
}

std::vector<RigidMatrix> FaceRig::SkinMatrices(double frame) const {
    const int last = anim_.frameCount - 1;
    if (frame < 0) frame = 0;
    int f0 = static_cast<int>(std::floor(frame));
    if (f0 > last) f0 = last;
    const int f1 = f0 + 1 > last ? last : f0 + 1;
    const double u = frame - f0;
    std::vector<RigidMatrix> world(mesh_.bones.size());
    for (size_t i = 0; i < world.size(); ++i) world[i] = mesh_.bones[i].bindWorld;
    for (int c = 0; c < anim_.channelCount; ++c) {
        const RigidMatrix& a = anim_.frames[f0][c];
        const RigidMatrix& b = anim_.frames[f1][c];
        RigidMatrix local;
        for (int i = 0; i < 3; ++i)
            for (int j = 0; j < 3; ++j) local.r[i][j] = a.r[i][j] * (1 - u) + b.r[i][j] * u;
        for (int k = 0; k < 3; ++k) local.t[k] = a.t[k] * (1 - u) + b.t[k] * u;
        const int bone = firstAnimated_ + c;
        // an animation parent is a channel index; without one the channel is local to the mesh skeleton's parent bone
        int parent = anim_.parents[c] >= 0 ? firstAnimated_ + anim_.parents[c] : mesh_.bones[bone].parent;
        world[bone] = parent < 0 ? local : Multiply(local, world[parent]);
    }
    std::vector<RigidMatrix> skin(world.size());
    for (size_t i = 0; i < world.size(); ++i) skin[i] = Multiply(invBind_[i], world[i]);
    return skin;
}

std::vector<Vec3> FaceRig::Skin(const std::vector<Vec3>& positions, double frame) const {
    const std::vector<RigidMatrix> s = SkinMatrices(frame);
    std::vector<Vec3> out(positions.size());
    for (size_t v = 0; v < positions.size(); ++v) {
        Vec3 acc = {0, 0, 0};
        for (int k = 0; k < 4; ++k) {
            const double w = skin_[v].weight[k];
            if (w == 0) continue;
            const Vec3 q = Transform(positions[v], s[skin_[v].bone[k]]);
            for (int j = 0; j < 3; ++j) acc[j] += w * q[j];
        }
        out[v] = acc;
    }
    return out;
}

std::vector<Vec3> ApplyFaceSliders(const FaceRig& rig, const std::vector<SliderDef>& defs, const float values[kSliderCount],
                                   std::vector<Vec3> positions, SliderMode mode) {
    for (size_t i = 0; i < defs.size() && i < static_cast<size_t>(kSliderCount); ++i) {
        // a difference between two saved stars already contains the neutral passes of both: only the sliders that were moved count
        if (mode == SliderMode::DeltaFromNeutral && values[i] == kSliderNeutral) continue;
        const double frame = SliderFrame(defs[i], values[i]);
        if (mode == SliderMode::Replace) {
            positions = rig.Skin(positions, frame);
        } else {
            const std::vector<Vec3> moved = rig.Skin(positions, frame);
            const std::vector<Vec3> neutral = rig.Skin(positions, defs[i].firstFrame + 1.0);
            for (size_t v = 0; v < positions.size(); ++v)
                for (int j = 0; j < 3; ++j) positions[v][j] += moved[v][j] - neutral[v][j];
        }
    }
    return positions;
}

std::vector<Vec3> ApplyExpression(const FaceRig& rig, const std::vector<Vec3>& positions, int expressionFrame, float intensity) {
    const std::vector<Vec3> posed = rig.Skin(positions, expressionFrame);
    std::vector<Vec3> out(positions.size());
    for (size_t v = 0; v < positions.size(); ++v)
        for (int j = 0; j < 3; ++j) out[v][j] = positions[v][j] + intensity * (posed[v][j] - positions[v][j]);
    return out;
}

float ExpressionEnvelope(float ticks) {
    if (ticks <= 0) return 0.0f;
    if (ticks >= 400) return 0.0f;
    return ticks >= 200 ? 1.0f - (ticks - 200) * 0.005f : ticks * 0.005f;
}

}  // namespace otm::character
