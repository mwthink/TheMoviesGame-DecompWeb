// A small deflate decoder after the structure of zlib's "puff": stored, fixed-Huffman and dynamic-Huffman blocks.
#include "core/Inflate.hpp"

#include <cstring>

namespace otm::core {
namespace {

constexpr int kMaxBits = 15;

struct Huffman {
    uint16_t count[kMaxBits + 1] = {};
    uint16_t symbol[288] = {};
};

struct State {
    const uint8_t* in;
    size_t size;
    size_t pos = 0;
    uint32_t bitBuf = 0;
    int bitCnt = 0;
    std::vector<uint8_t>* out;
    bool error = false;

    int Bits(int need) {
        uint32_t val = bitBuf;
        while (bitCnt < need) {
            if (pos >= size) { error = true; return 0; }
            val |= static_cast<uint32_t>(in[pos++]) << bitCnt;
            bitCnt += 8;
        }
        bitBuf = val >> need;
        bitCnt -= need;
        return static_cast<int>(val & ((1u << need) - 1));
    }
};

int Decode(State& s, const Huffman& h) {
    int code = 0, first = 0, index = 0;
    for (int len = 1; len <= kMaxBits; ++len) {
        code |= s.Bits(1);
        if (s.error) return -1;
        const int count = h.count[len];
        if (code - count < first) return h.symbol[index + (code - first)];
        index += count;
        first += count;
        first <<= 1;
        code <<= 1;
    }
    return -1;
}

bool Construct(Huffman& h, const uint16_t* length, int n) {
    std::memset(h.count, 0, sizeof(h.count));
    for (int i = 0; i < n; ++i) ++h.count[length[i]];
    if (h.count[0] == n) return true;
    int left = 1;
    for (int len = 1; len <= kMaxBits; ++len) {
        left <<= 1;
        left -= h.count[len];
        if (left < 0) return false;
    }
    uint16_t offs[kMaxBits + 1];
    offs[1] = 0;
    for (int len = 1; len < kMaxBits; ++len) offs[len + 1] = static_cast<uint16_t>(offs[len] + h.count[len]);
    for (int i = 0; i < n; ++i)
        if (length[i] != 0) h.symbol[offs[length[i]]++] = static_cast<uint16_t>(i);
    return true;
}

bool Codes(State& s, const Huffman& lencode, const Huffman& distcode) {
    static const uint16_t lens[29] = {3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258};
    static const uint16_t lext[29] = {0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0};
    static const uint16_t dists[30] = {1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577};
    static const uint16_t dext[30] = {0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13};
    for (;;) {
        int symbol = Decode(s, lencode);
        if (symbol < 0) return false;
        if (symbol < 256) {
            s.out->push_back(static_cast<uint8_t>(symbol));
        } else if (symbol == 256) {
            return true;
        } else {
            symbol -= 257;
            if (symbol >= 29) return false;
            const int len = lens[symbol] + s.Bits(lext[symbol]);
            const int ds = Decode(s, distcode);
            if (ds < 0 || ds >= 30) return false;
            const size_t dist = dists[ds] + static_cast<size_t>(s.Bits(dext[ds]));
            if (s.error || dist > s.out->size()) return false;
            for (int i = 0; i < len; ++i) s.out->push_back((*s.out)[s.out->size() - dist]);
        }
        if (s.error) return false;
    }
}

bool Stored(State& s) {
    s.bitBuf = 0;
    s.bitCnt = 0;
    if (s.pos + 4 > s.size) return false;
    const unsigned len = s.in[s.pos] | (s.in[s.pos + 1] << 8);
    const unsigned nlen = s.in[s.pos + 2] | (s.in[s.pos + 3] << 8);
    s.pos += 4;
    if (len != (~nlen & 0xFFFF) || s.pos + len > s.size) return false;
    s.out->insert(s.out->end(), s.in + s.pos, s.in + s.pos + len);
    s.pos += len;
    return true;
}

bool Fixed(State& s) {
    static Huffman lencode, distcode;
    static bool built = false;
    if (!built) {
        uint16_t lengths[288];
        int i = 0;
        for (; i < 144; ++i) lengths[i] = 8;
        for (; i < 256; ++i) lengths[i] = 9;
        for (; i < 280; ++i) lengths[i] = 7;
        for (; i < 288; ++i) lengths[i] = 8;
        Construct(lencode, lengths, 288);
        for (i = 0; i < 30; ++i) lengths[i] = 5;
        Construct(distcode, lengths, 30);
        built = true;
    }
    return Codes(s, lencode, distcode);
}

bool Dynamic(State& s) {
    static const uint8_t order[19] = {16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15};
    const int nlen = s.Bits(5) + 257, ndist = s.Bits(5) + 1, ncode = s.Bits(4) + 4;
    if (s.error || nlen > 286 || ndist > 30) return false;
    uint16_t lengths[320] = {};
    for (int i = 0; i < ncode; ++i) lengths[order[i]] = static_cast<uint16_t>(s.Bits(3));
    Huffman lencode, distcode;
    if (!Construct(lencode, lengths, 19)) return false;
    int index = 0;
    uint16_t tmp[320] = {};
    while (index < nlen + ndist) {
        int symbol = Decode(s, lencode);
        if (symbol < 0) return false;
        if (symbol < 16) {
            tmp[index++] = static_cast<uint16_t>(symbol);
        } else {
            int len = 0, rep;
            if (symbol == 16) {
                if (index == 0) return false;
                len = tmp[index - 1];
                rep = 3 + s.Bits(2);
            } else if (symbol == 17) {
                rep = 3 + s.Bits(3);
            } else {
                rep = 11 + s.Bits(7);
            }
            if (index + rep > nlen + ndist) return false;
            while (rep--) tmp[index++] = static_cast<uint16_t>(len);
        }
        if (s.error) return false;
    }
    if (tmp[256] == 0) return false;
    Huffman lc, dc;
    Construct(lc, tmp, nlen);
    Construct(dc, tmp + nlen, ndist);
    return Codes(s, lc, dc);
}

}  // namespace

bool ZlibInflate(const uint8_t* data, size_t size, std::vector<uint8_t>& out) {
    out.clear();
    if (size < 2 || (data[0] & 0x0F) != 8) return false;
    State s{data + 2, size - 2, 0, 0, 0, &out};
    int last;
    do {
        last = s.Bits(1);
        const int type = s.Bits(2);
        if (s.error) return false;
        bool ok;
        if (type == 0) ok = Stored(s);
        else if (type == 1) ok = Fixed(s);
        else if (type == 2) ok = Dynamic(s);
        else return false;
        if (!ok) return false;
    } while (!last);
    return true;
}

bool UnpackZcmp(const std::string& bytes, std::string& out) {
    if (bytes.size() >= 20 && bytes.compare(0, 4, "zcmp") == 0) {
        std::vector<uint8_t> v;
        if (!ZlibInflate(reinterpret_cast<const uint8_t*>(bytes.data()) + 20, bytes.size() - 20, v)) return false;
        out.assign(v.begin(), v.end());
        return true;
    }
    out = bytes;
    return true;
}

}  // namespace otm::core
