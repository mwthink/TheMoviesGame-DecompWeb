#include "game/character/MshFile.hpp"

#include <cstdint>
#include <cstring>

#include "core/Inflate.hpp"

namespace otm::character {
namespace {

uint16_t U16(const std::string& d, size_t p) { uint16_t v; std::memcpy(&v, d.data() + p, 2); return v; }
uint32_t U32(const std::string& d, size_t p) { uint32_t v; std::memcpy(&v, d.data() + p, 4); return v; }
int32_t I32(const std::string& d, size_t p) { int32_t v; std::memcpy(&v, d.data() + p, 4); return v; }
float F32(const std::string& d, size_t p) { float v; std::memcpy(&v, d.data() + p, 4); return v; }
size_t Align4(size_t p) { return (p + 3) & ~static_cast<size_t>(3); }

std::string CStr(const std::string& d, size_t p, size_t n) {
    std::string s = d.substr(p, n);
    const size_t z = s.find('\0');
    return z == std::string::npos ? s : s.substr(0, z);
}

// An aux polygon chunk (collision / footprint shapes): skipped, only its size matters.
bool SkipChunk(const std::string& d, size_t& pos) {
    if (pos + 8 > d.size()) return false;
    const uint16_t nv = U16(d, pos), nt = U16(d, pos + 4);
    pos += 8 + 12u * nv + 6u * nt;
    pos = Align4(pos);
    return pos <= d.size();
}

bool ReadNode(const std::string& d, size_t& pos, MshFile& out) {
    if (pos + 0x34 > d.size()) return false;
    const int nprim = static_cast<uint8_t>(d[pos]);
    const bool hasExtra = (static_cast<uint8_t>(d[pos + 3]) & 0x10) != 0;
    pos += hasExtra ? 0x38 : 0x34;
    for (int p = 0; p < nprim; ++p) {
        if (pos + 16 > d.size()) return false;
        MshPrimitive prim;
        prim.material = static_cast<uint8_t>(d[pos]);
        const uint32_t ntri = U32(d, pos + 4), nvert = U32(d, pos + 8);
        const uint8_t f0 = static_cast<uint8_t>(d[pos + 12]), f1 = static_cast<uint8_t>(d[pos + 13]);
        pos += 16;
        if (f0 & 0x10) pos += 12;
        float qb[14] = {};
        if (f0 & 0x20) {
            if (pos + 56 > d.size()) return false;
            for (int i = 0; i < 14; ++i) qb[i] = F32(d, pos + 4 * i);
            pos += 56;
        }
        uint32_t extra = 0;
        if (f0 & 0x40) {
            extra = U32(d, pos);
            pos += 4;
        }
        if (pos + 6u * ntri > d.size()) return false;
        for (uint32_t i = 0; i < ntri; ++i)
            prim.triangles.push_back({U16(d, pos + 6 * i), U16(d, pos + 6 * i + 2), U16(d, pos + 6 * i + 4)});
        pos = Align4(pos + 6u * ntri);
        prim.vertices.resize(nvert);
        if (f0 & 0x20) {            // compact: 8 x u16 per vertex, dequantised with the bounds block
            if (pos + 16u * nvert > d.size()) return false;
            for (uint32_t i = 0; i < nvert; ++i) {
                double t[8];
                for (int k = 0; k < 8; ++k) t[k] = U16(d, pos + 16 * i + 2 * k) / 65535.0;
                MshVertex& v = prim.vertices[i];
                for (int k = 0; k < 3; ++k) {
                    v.pos[k] = static_cast<float>(qb[k] + t[k] * (qb[3 + k] - qb[k]));
                    v.normal[k] = static_cast<float>(2 * t[3 + k] - 1);
                }
                v.uv[0] = static_cast<float>(qb[6] + t[6] * (qb[8] - qb[6]));
                v.uv[1] = static_cast<float>(qb[7] + t[7] * (qb[9] - qb[7]));
            }
            pos += 16u * nvert;
            if (f1 & 1) pos += 4u * nvert;          // second UV set (lightmap)
        } else {                    // direct: 8 x f32 per vertex
            if (pos + 32u * nvert > d.size()) return false;
            for (uint32_t i = 0; i < nvert; ++i) {
                MshVertex& v = prim.vertices[i];
                for (int k = 0; k < 3; ++k) { v.pos[k] = F32(d, pos + 32 * i + 4 * k); v.normal[k] = F32(d, pos + 32 * i + 12 + 4 * k); }
                v.uv[0] = F32(d, pos + 32 * i + 24);
                v.uv[1] = F32(d, pos + 32 * i + 28);
            }
            pos += 32u * nvert;
            if (f1 & 1) pos += 8u * nvert;
        }
        pos = Align4(pos);
        if (f0 & 1) {               // skin: 4 f32 weights + 4 u8 bone indices per vertex
            if (pos + 20u * nvert > d.size()) return false;
            prim.skin.resize(nvert);
            for (uint32_t i = 0; i < nvert; ++i) {
                for (int k = 0; k < 4; ++k) prim.skin[i].weight[k] = F32(d, pos + 20 * i + 4 * k);
                for (int k = 0; k < 4; ++k) prim.skin[i].bone[k] = static_cast<unsigned char>(d[pos + 20 * i + 16 + k]);
            }
            pos += 20u * nvert;
        }
        pos += 8u * extra;
        if (pos > d.size()) return false;
        out.primitives.push_back(std::move(prim));
    }
    return true;
}

// Skeleton block after the nodes: u32 ?, u32 n_bones, then n_bones x 84 bytes: 32-byte name, i32 parent, 12 f32 (three axis rows + translation).
void ReadSkeleton(const std::string& d, size_t pos, MshFile& out) {
    if (pos + 8 > d.size()) return;
    const uint32_t n = U32(d, pos + 4);
    if (n == 0 || n >= 512 || pos + 8 + 84u * n > d.size()) return;
    for (uint32_t i = 0; i < n; ++i) {
        const size_t o = pos + 8 + 84u * i;
        MshBone b;
        b.name = CStr(d, o, 32);
        b.parent = I32(d, o + 32);
        for (int r = 0; r < 3; ++r)
            for (int c = 0; c < 3; ++c) b.bindWorld.r[r][c] = F32(d, o + 36 + 4 * (3 * r + c));
        for (int c = 0; c < 3; ++c) b.bindWorld.t[c] = F32(d, o + 36 + 4 * (9 + c));
        out.bones.push_back(std::move(b));
    }
}

}  // namespace

bool MshFile::Parse(const std::string& fileBytes, MshFile& out, std::string* err) {
    auto fail = [&](const char* why) { if (err) *err = why; return false; };
    std::string d;
    if (!core::UnpackZcmp(fileBytes, d)) return fail("zcmp inflate failed");
    if (d.size() < 0x24) return fail("file too short");
    out = MshFile();
    const uint32_t version = U32(d, 0), ntex = U32(d, 4), nmat = U32(d, 8), nsub = U32(d, 12);
    if (version != 10) return fail("unsupported mesh version");
    const uint8_t* flags = reinterpret_cast<const uint8_t*>(d.data()) + 0x10;
    const uint8_t ctrl = flags[6];
    size_t pos = 0x18;
    uint32_t opt[3] = {0, 0, 0};
    const int bits[3] = {2, 0x40, 0x80};
    for (int i = 0; i < 3; ++i)
        if (ctrl & bits[i]) { opt[i] = U32(d, pos); pos += 4; }
    const uint32_t nNamed = opt[2];
    for (uint32_t i = 0; i < ntex; ++i) out.textures.push_back(CStr(d, pos + 32 * i, 32));
    pos += 32u * ntex;
    for (uint32_t i = 0; i < nmat; ++i) pos += (static_cast<uint8_t>(d[pos + 0xE]) & 4) ? 0x18 : 0x14;
    // aux polygon chunks, each present when its flag bit is set (the order of LH_LoadMeshBinary)
    struct Slot { int byteIndex; uint8_t mask; };
    static const Slot slots[] = {{3, 0xFF}, {6, 0x10}, {6, 0x08}, {5, 0x04}, {6, 0x04}, {5, 0x02}, {6, 0x01}};
    for (const Slot& s : slots)
        if (flags[s.byteIndex] & s.mask)
            if (!SkipChunk(d, pos)) return fail("bad polygon chunk");
    for (uint32_t i = 0; i < nNamed; ++i) {
        pos += 32;
        if (!SkipChunk(d, pos)) return fail("bad named part");
    }
    for (uint32_t i = 0; i < nsub; ++i)
        if (!ReadNode(d, pos, out)) return fail("bad render node");
    ReadSkeleton(d, pos, out);
    return true;
}

}  // namespace otm::character
