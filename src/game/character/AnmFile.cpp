#include "game/character/AnmFile.hpp"

#include <cmath>
#include <cstdint>
#include <cstring>

#include "core/Inflate.hpp"

namespace otm::character {
namespace {

constexpr double kPi = 3.14159265358979323846;

uint16_t U16(const std::string& d, size_t p) {
    uint16_t v;
    std::memcpy(&v, d.data() + p, 2);
    return v;
}
uint32_t U32(const std::string& d, size_t p) {
    uint32_t v;
    std::memcpy(&v, d.data() + p, 4);
    return v;
}
float F32(const std::string& d, size_t p) {
    float v;
    std::memcpy(&v, d.data() + p, 4);
    return v;
}

size_t Align4(size_t p) { return (p + 3) & ~static_cast<size_t>(3); }

// One run-length array of n u16 values: a mask word, then words; a word without the mask bit is a literal, with it a run of the next word.
bool ReadRle(const std::string& d, size_t& pos, int n, std::vector<uint16_t>& out) {
    out.clear();
    if (pos + 2 > d.size()) return false;
    const uint16_t mask = U16(d, pos);
    pos += 2;
    while (static_cast<int>(out.size()) < n) {
        if (pos + 2 > d.size()) return false;
        const uint16_t w = U16(d, pos);
        if ((w & mask) == 0) {
            out.push_back(w);
            pos += 2;
        } else {
            if (pos + 4 > d.size()) return false;
            const uint32_t a = ((static_cast<uint32_t>(w) - mask) >> 1) & 0xFFFF;
            const uint32_t b = (~(static_cast<uint32_t>(mask) - 1) >> 1) & 0xFFFF;
            const uint32_t count = (a & b) | ((static_cast<uint32_t>(mask) - 1) & w);
            out.insert(out.end(), count, U16(d, pos + 2));
            pos += 4;
        }
    }
    return static_cast<int>(out.size()) == n;
}

// Rows are the axes: [cy*cz, cy*sz, -sy], [sx*sy*cz - cx*sz, cx*cz + sx*sy*sz, sx*cy], [sx*sz + sy*cx*cz, sy*cx*sz - sx*cz, cx*cy]. orig: 0x009AB3F0
void EulerMatrix(double ax, double ay, double az, double r[3][3]) {
    const double cx = std::cos(ax), sx = std::sin(ax), cy = std::cos(ay), sy = std::sin(ay), cz = std::cos(az), sz = std::sin(az);
    r[0][0] = cy * cz;               r[0][1] = cy * sz;               r[0][2] = -sy;
    r[1][0] = sx * sy * cz - cx * sz; r[1][1] = cx * cz + sx * sy * sz; r[1][2] = sx * cy;
    r[2][0] = sx * sz + sy * cx * cz; r[2][1] = sy * cx * sz - sx * cz; r[2][2] = cx * cy;
}

}  // namespace

bool AnmFile::Parse(const std::string& fileBytes, AnmFile& out, std::string* err) {
    auto fail = [&](const char* why) {
        if (err) *err = why;
        return false;
    };
    std::string d;
    if (!core::UnpackZcmp(fileBytes, d)) return fail("zcmp inflate failed");
    if (d.size() < 0x60) return fail("file too short");
    out = AnmFile();
    out.version = static_cast<int>(U32(d, 0));
    if (out.version < 12) return fail("unsupported .anm version");
    size_t pos = 0x3C;
    uint32_t nframes = U32(d, pos);
    out.channelCount = U16(d, pos + 4);
    const uint8_t setFlags = static_cast<uint8_t>(d[pos + 7]);
    pos += (setFlags & 2) ? 0x1C : 0x18;
    out.translationScale = 10.0f;
    if (setFlags & 1) {
        out.translationScale = F32(d, pos);
        pos += 4;
    }
    out.frameCount = static_cast<int>(nframes & 0x7FFF);
    if (pos + out.channelCount > d.size()) return fail("truncated");
    for (int c = 0; c < out.channelCount; ++c) {
        const uint8_t b = static_cast<uint8_t>(d[pos + c]);
        out.parents.push_back(b == 0xFF ? -1 : b);
    }
    pos = Align4(pos + out.channelCount);

    struct Chan {
        std::vector<uint16_t> rot[3], tr[3];
    };
    std::vector<Chan> chans(out.channelCount);
    for (int c = 0; c < out.channelCount; ++c) {
        if (pos + 4 > d.size()) return fail("truncated channel");
        const uint8_t flags = static_cast<uint8_t>(d[pos]);
        pos += 4;
        for (int k = 0; k < 3; ++k)
            if (!ReadRle(d, pos, out.frameCount, chans[c].rot[k])) return fail("rotation RLE overran");
        pos = Align4(pos);
        if (flags & 1) {                         // constant translation: Anim_BuildTranslationTable stores round(((1 / scale) * c + 1) * 32767)
            if (pos + 12 > d.size()) return fail("truncated constant translation");
            for (int k = 0; k < 3; ++k) {
                const double v = std::floor(((1.0 / out.translationScale) * F32(d, pos + 4 * k) + 1.0) * 32767.0 + 0.5);
                chans[c].tr[k].assign(out.frameCount, static_cast<uint16_t>(v));
            }
            pos += 12;
        } else {
            for (int k = 0; k < 3; ++k)
                if (!ReadRle(d, pos, out.frameCount, chans[c].tr[k])) return fail("translation RLE overran");
            pos = Align4(pos);
        }
    }
    out.frames.assign(out.frameCount, std::vector<RigidMatrix>(out.channelCount));
    for (int t = 0; t < out.frameCount; ++t) {
        for (int c = 0; c < out.channelCount; ++c) {
            double ang[3];
            for (int k = 0; k < 3; ++k) ang[k] = ((chans[c].rot[k][t] - 0.5) / 32768.0 - 1.0) * kPi;
            RigidMatrix& m = out.frames[t][c];
            EulerMatrix(ang[0], ang[1], ang[2], m.r);
            for (int k = 0; k < 3; ++k) m.t[k] = (chans[c].tr[k][t] / 32767.0 - 1.0) * out.translationScale;
        }
    }
    return true;
}

}  // namespace otm::character
