#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace otm::core {

// Decompresses a zlib stream (2 byte header, deflate data; the Adler-32 trailer is not checked). The game's `zcmp` files ("zcmp" + 16 bytes +
// a zlib stream: .msh, .anm, .inf ...) use it. Returns false on malformed data.
bool ZlibInflate(const uint8_t* data, size_t size, std::vector<uint8_t>& out);

// Returns the payload of a `zcmp` file (inflated), or the bytes unchanged for a plain file. Returns false if inflating fails.
// orig: the loader in LH_LoadMeshBinary (0x009DEB10) and Anim_ReadHeader (0x00984AD0) inflates these first
bool UnpackZcmp(const std::string& bytes, std::string& out);

}  // namespace otm::core
