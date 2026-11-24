#include "game/character/HeadFile.hpp"

#include <cmath>
#include <cstring>

namespace otm::character {
namespace {
constexpr size_t kHeaderSize = 0x94;
constexpr size_t kArrayBytes = kHeadVertexCount * sizeof(HeadVertex);
}  // namespace

bool HeadFile::Parse(const std::string& bytes, HeadFile& out, std::string* err) {
    if (bytes.size() < kHeaderSize + 3 * kArrayBytes) {
        if (err) *err = "file too short for a .hd";
        return false;
    }
    out = HeadFile();
    const size_t offs[4] = {0x0c, 0x2c, 0x4c, 0x6c};
    for (int i = 0; i < 4; ++i) {
        std::string s = bytes.substr(offs[i], 32);
        const size_t z = s.find('\0');
        out.names[i] = z == std::string::npos ? s : s.substr(0, z);
    }
    std::vector<HeadVertex>* arrays[3] = {&out.a, &out.b, &out.c};
    for (int k = 0; k < 3; ++k) {
        arrays[k]->resize(kHeadVertexCount);
        std::memcpy(arrays[k]->data(), bytes.data() + kHeaderSize + k * kArrayBytes, kArrayBytes);
    }
    return true;
}

std::string HeadFile::Serialize(const std::string& header) const {
    std::string out = header.substr(0, kHeaderSize);
    for (const std::vector<HeadVertex>* arr : {&a, &b, &c})
        out.append(reinterpret_cast<const char*>(arr->data()), kArrayBytes);
    return out;
}

void ApplyHdMorph(const HeadFile& first, const HeadFile* second, float mix, float weight, float age, std::vector<HeadVertex>& out) {
    out.resize(kHeadVertexCount);
    for (int i = 0; i < kHeadVertexCount; ++i) {
        float v[6];
        for (int k = 0; k < 6; ++k) {
            const float* a0 = k < 3 ? &first.a[i].pos[k] : &first.a[i].normal[k - 3];
            const float* b0 = k < 3 ? &first.b[i].pos[k] : &first.b[i].normal[k - 3];
            const float* c0 = k < 3 ? &first.c[i].pos[k] : &first.c[i].normal[k - 3];
            float x = *a0 + weight * *b0 + age * *c0;
            if (second) {
                const float* a1 = k < 3 ? &second->a[i].pos[k] : &second->a[i].normal[k - 3];
                const float* b1 = k < 3 ? &second->b[i].pos[k] : &second->b[i].normal[k - 3];
                const float* c1 = k < 3 ? &second->c[i].pos[k] : &second->c[i].normal[k - 3];
                x = (1 - mix) * x + mix * (*a1 + weight * *b1 + age * *c1);
            }
            v[k] = x;
        }
        const float len = std::sqrt(v[3] * v[3] + v[4] * v[4] + v[5] * v[5]);
        for (int k = 0; k < 3; ++k) {
            out[i].pos[k] = v[k];
            out[i].normal[k] = len > 0 ? v[3 + k] / len : v[3 + k];
        }
    }
}

}  // namespace otm::character
