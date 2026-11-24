#!/usr/bin/env python3
"""Read The Movies .anm animations (version 12), from Anim_ReadHeader / Anim_ReadSetHeader / Anim_ReadTrackSet / Anim_ReadChannel
(0x984ad0, 0x984b40, 0x9859c0, 0xa4e030) and Anim_ExpandChannel / Anim_BuildTranslationTable / Matrix_FromPackedPoseSample.

    python3 tools/anm_dump.py data/game_data/chars/walk.anm

    [optional "zcmp" + 16 bytes + zlib stream]
    file header 0x3c bytes (version >= 12): u32 version, u8 b4, u8 b5, u16 n, 12 x f32 (3x3 matrix + translation: the total root movement of the clip),
                u8, u8, u16
    set header 0x1c bytes: u32 n_frames, u16 n_channels, u8, u8 flags, f32 x4, [f32 only if flags & 2], so 0x1c, else 0x18
    f32 translation scale (only if flags & 1, else 10.0)
    n_channels bytes: parent bone index of each channel (0xff = root), then padded to 4
    n_channels channels, each:
        u8 flags (bit 0: the translation is constant), 3 more bytes
        3 RLE arrays (rotation x, y, z, euler angles), padded to 4
        3 RLE arrays (translation x, y, z) or, if flags & 1, 3 f32 constants; padded to 4
    RLE array: u16 mask M, then u16 words until n_frames values are produced. A word w with (w & M) == 0 is one literal value; a word with
        the M bit set is a run: count = (((w - M) >> 1) & 0xffff & (~(M-1) >> 1) & 0xffff) | ((M-1) & w), value = the next u16.
    Values are u16: rotation angle = ((v - 0.5) / 32768 - 1) * pi (radians), translation = (v / 32767 - 1) * scale.
    Euler to matrix (FUN_009ab3f0), rows are the axes: [cy*cz, cy*sz, -sy], [sx*sy*cz - cx*sz, cx*cz + sx*sy*sz, sx*cy], [sx*sz + sy*cx*cz, sy*cx*sz - sx*cz, cx*cy]
    with angles (x, y, z) = the three rotation arrays.
"""
import math
import struct
import sys
import zlib


def inflate(data):
    if data[:4] == b"zcmp":
        return zlib.decompress(data[20:])
    return data


def align4(p):
    return (p + 3) & ~3


def read_rle(d, pos, n):
    """Return (values, new pos) for one RLE array of n values."""
    mask = struct.unpack_from("<H", d, pos)[0]
    pos += 2
    out = []
    while len(out) < n:
        w = struct.unpack_from("<H", d, pos)[0]
        if w & mask == 0:
            out.append(w)
            pos += 2
        else:
            a = ((w - mask) >> 1) & 0xFFFF
            b = (~(mask - 1) >> 1) & 0xFFFF
            count = (a & b) | ((mask - 1) & w)
            out.extend([struct.unpack_from("<H", d, pos + 2)[0]] * count)
            pos += 4
    if len(out) != n:
        raise ValueError("RLE overran: %d values for %d frames at 0x%x" % (len(out), n, pos))
    return out, pos


def euler_matrix(ax, ay, az):
    cx, sx, cy, sy, cz, sz = math.cos(ax), math.sin(ax), math.cos(ay), math.sin(ay), math.cos(az), math.sin(az)
    return [[cy * cz, cy * sz, -sy],
            [sx * sy * cz - cx * sz, cx * cz + sx * sy * sz, sx * cy],
            [sx * sz + sy * cx * cz, sy * cx * sz - sx * cz, cx * cy]]


def parse(data):
    d = inflate(data)
    version = struct.unpack_from("<I", d, 0)[0]
    if version < 12:
        raise ValueError("unsupported .anm version %d" % version)
    root = struct.unpack_from("<12f", d, 8)
    pos = 0x3C
    nframes, nchan = struct.unpack_from("<IH", d, pos)
    setflags = d[pos + 7]
    f = struct.unpack_from("<4f", d, pos + 8)
    pos += 0x1C if setflags & 2 else 0x18
    scale = 10.0
    if setflags & 1:
        scale = struct.unpack_from("<f", d, pos)[0]
        pos += 4
    nframes &= 0x7FFF
    parents = [(-1 if b == 0xFF else b) for b in d[pos:pos + nchan]]
    pos = align4(pos + nchan)
    chans = []
    for _ in range(nchan):
        flags = d[pos]
        pos += 4
        rot = []
        for _k in range(3):
            v, pos = read_rle(d, pos, nframes)
            rot.append(v)
        pos = align4(pos)
        if flags & 1:
            consts = struct.unpack_from("<3f", d, pos)
            pos += 12
            # Anim_BuildTranslationTable: round(((1 / scale) * c + 1) * 32767)
            tr = [[int(round(((1.0 / scale) * c + 1.0) * 32767.0))] * nframes for c in consts]
        else:
            tr = []
            for _k in range(3):
                v, pos = read_rle(d, pos, nframes)
                tr.append(v)
            pos = align4(pos)
        chans.append({"flags": flags, "rot": rot, "tr": tr})
    frames = []     # frames[t][channel] = (3x3 rows, (tx, ty, tz))
    for t in range(nframes):
        row = []
        for c in chans:
            ang = [((c["rot"][k][t] - 0.5) / 32768.0 - 1.0) * math.pi for k in range(3)]
            tr = tuple((c["tr"][k][t] / 32767.0 - 1.0) * scale for k in range(3))
            row.append((euler_matrix(*ang), tr))
        frames.append(row)
    return {"version": version, "n_frames": nframes, "n_channels": nchan, "parents": parents, "scale": scale, "duration": f[0],
            "root": root, "frames": frames, "end": pos, "size": len(d)}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for p in sys.argv[1:]:
        a = parse(open(p, "rb").read())
        print("%s: v%d %d frames, %d channels, scale %.4f, set float0 %.4f, read to %d of %d bytes" %
              (p, a["version"], a["n_frames"], a["n_channels"], a["scale"], a["duration"], a["end"], a["size"]))
        print("  root movement:", [round(x, 3) for x in a["root"][9:]])
