#include "game/character/StarFile.hpp"

#include <cstring>

namespace otm::character {
namespace {

uint32_t U32(const std::string& d, size_t p) { uint32_t v; std::memcpy(&v, d.data() + p, 4); return v; }
float F32(const std::string& d, size_t p) { float v; std::memcpy(&v, d.data() + p, 4); return v; }
void PutU32(std::string& d, size_t p, uint32_t v) { std::memcpy(&d[p], &v, 4); }
void PutF32(std::string& d, size_t p, float v) { std::memcpy(&d[p], &v, 4); }

std::string CStr(const std::string& d, size_t p) {
    std::string s = d.substr(p, 32);
    const size_t z = s.find('\0');
    return z == std::string::npos ? s : s.substr(0, z);
}

void PutStr(std::string& d, size_t p, const std::string& s) {
    std::memcpy(&d[p], s.data(), s.size() < 31 ? s.size() : 31);
}

}  // namespace

bool ParseInfoSm(const std::string& bytes, StarInfo& out, std::string* err) {
    auto fail = [&](const char* why) { if (err) *err = why; return false; };
    if (bytes.size() < 0x182) return fail("file too short");
    if (U32(bytes, 0) != kInfoSmVersion) return fail("unsupported version");
    out = StarInfo();
    out.version = U32(bytes, 0);
    out.id = U32(bytes, 8);
    out.gender = U32(bytes, 0x0c);
    for (int i = 0; i < 14; ++i) out.attributes[i] = F32(bytes, 0x10 + 4 * i);
    out.head0 = CStr(bytes, 0x48);
    out.head1 = CStr(bytes, 0x68);
    out.hair = CStr(bytes, 0x88);
    out.headBlend = F32(bytes, 0xa8);
    out.skinBlend = F32(bytes, 0xac);
    out.eyeColour = U32(bytes, 0xb0);
    out.ageSlider = F32(bytes, 0xb4);
    out.hairColour = U32(bytes, 0xb8);
    out.eyebrow = U32(bytes, 0xbc);
    out.eyeMakeup = U32(bytes, 0xc0);
    out.makeupColour = U32(bytes, 0xc4);
    out.beard = U32(bytes, 0xc8);
    out.lipstick = U32(bytes, 0xcc);
    for (int i = 0; i < 43; ++i) out.sliders[i] = F32(bytes, 0xd0 + 4 * i);
    for (size_t p = 0x180; p + 1 < bytes.size(); p += 2) {
        const char16_t c = static_cast<char16_t>(static_cast<unsigned char>(bytes[p]) | (static_cast<unsigned char>(bytes[p + 1]) << 8));
        if (c == 0) break;
        out.name.push_back(c);
    }
    return true;
}

std::string BuildInfoSm(const StarInfo& info) {
    const size_t size = kInfoSmFixedSize + 2 * info.name.size();
    std::string d(size, '\0');
    PutU32(d, 0, info.version);
    PutU32(d, 4, static_cast<uint32_t>(size));
    PutU32(d, 8, info.id);
    PutU32(d, 0x0c, info.gender);
    for (int i = 0; i < 14; ++i) PutF32(d, 0x10 + 4 * i, info.attributes[i]);
    PutStr(d, 0x48, info.head0);
    PutStr(d, 0x68, info.head1);
    PutStr(d, 0x88, info.hair);
    PutF32(d, 0xa8, info.headBlend);
    PutF32(d, 0xac, info.skinBlend);
    PutU32(d, 0xb0, info.eyeColour);
    PutF32(d, 0xb4, info.ageSlider);
    PutU32(d, 0xb8, info.hairColour);
    PutU32(d, 0xbc, info.eyebrow);
    PutU32(d, 0xc0, info.eyeMakeup);
    PutU32(d, 0xc4, info.makeupColour);
    PutU32(d, 0xc8, info.beard);
    PutU32(d, 0xcc, info.lipstick);
    for (int i = 0; i < 43; ++i) PutF32(d, 0xd0 + 4 * i, info.sliders[i]);
    for (size_t i = 0; i < info.name.size(); ++i) {
        d[0x180 + 2 * i] = static_cast<char>(info.name[i] & 0xFF);
        d[0x181 + 2 * i] = static_cast<char>(info.name[i] >> 8);
    }
    return d;
}

}  // namespace otm::character
