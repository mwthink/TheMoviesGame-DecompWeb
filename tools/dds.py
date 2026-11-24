"""Tiny DDS reader for The Movies textures: DXT1 / DXT3 / DXT5 (top mip only) -> (w, h, [(r, g, b, a), ...] row-major)."""
import struct


def _rgb565(v):
    return ((v >> 11 & 31) * 255 // 31, (v >> 5 & 63) * 255 // 63, (v & 31) * 255 // 31)


def _colour_block(d, o, dxt1):
    c0, c1, bits = struct.unpack_from("<HHI", d, o)
    a, b = _rgb565(c0), _rgb565(c1)
    if c0 > c1 or not dxt1:
        pal = [a + (255,), b + (255,), tuple((2 * x + y) // 3 for x, y in zip(a, b)) + (255,),
               tuple((x + 2 * y) // 3 for x, y in zip(a, b)) + (255,)]
    else:
        pal = [a + (255,), b + (255,), tuple((x + y) // 2 for x, y in zip(a, b)) + (255,), (0, 0, 0, 0)]
    return [pal[bits >> (2 * i) & 3] for i in range(16)]


def load(path):
    d = open(path, "rb").read()
    h, w = struct.unpack_from("<II", d, 12)
    fourcc = d[84:88]
    px = [None] * (w * h)
    o = 128
    for by in range(max(1, h // 4)):
        for bx in range(max(1, w // 4)):
            if fourcc == b"DXT1":
                block = _colour_block(d, o, True)
                o += 8
            elif fourcc == b"DXT3":
                alpha = struct.unpack_from("<Q", d, o)[0]
                block = [c[:3] + ((alpha >> (4 * i) & 15) * 17,) for i, c in enumerate(_colour_block(d, o + 8, False))]
                o += 16
            elif fourcc == b"DXT5":
                a0, a1 = d[o], d[o + 1]
                idx = int.from_bytes(d[o + 2:o + 8], "little")
                tab = [a0, a1] + ([(( 6 - i) * a0 + (i + 1) * a1) // 7 for i in range(6)] if a0 > a1
                                  else [((4 - i) * a0 + (i + 1) * a1) // 5 for i in range(4)] + [0, 255])
                block = [c[:3] + (tab[idx >> (3 * i) & 7],) for i, c in enumerate(_colour_block(d, o + 8, False))]
                o += 16
            else:
                raise ValueError(f"{path}: unsupported DDS format {fourcc!r}")
            for i in range(16):
                x, y = bx * 4 + i % 4, by * 4 + i // 4
                if x < w and y < h:
                    px[y * w + x] = block[i]
    return w, h, px
