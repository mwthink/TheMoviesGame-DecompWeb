#!/usr/bin/env python3
"""Read The Movies .hd head files and apply their shape morph to generic_head.msh.

    python3 tools/hd_dump.py data/game_data/people/data/heads/head_f_japanese_girl.hd

Layout, from FUN_00a18e50 (loads Data\\Heads\\<name>), FUN_00a1aad0 (builds a head: loads generic_head.msh, applies the texture and FUN_009db5f0 with zeros) and
FUN_009db5f0 (the morph itself):

    u32 4, u32 hash, u32 hash                                (the first three words; not decoded)
    0x0c   texture file name, NUL padded (head_f_japanese_girl.dds)
    0x90   u32 (the loader overwrites it with a pointer to 0x94)
    0x94   three arrays, each 996 vertices x 6 floats (x, y, z, nx, ny, nz): A = the head's base shape, B and C = deltas
           996 = 760 + 58 + 178 = the vertices of generic_head.msh in file order (checked: A lies within 2.4 cm of the generic head, 6 mm on average)

    vertex = A + p4 * B + p5 * C                             one head
    vertex = (1 - mix) * (A0 + p4 * B0 + p5 * C0) + mix * (A1 + p4 * B1 + p5 * C1)    two heads (Head[0], Head[1], HeadMix of a saved person)
    normals use the same sum and are normalised afterwards.

What p4 and p5 are: the game calls this with values from CharacterModel_SetAgeMorph (0 below 30 years, +0.025 per year up to 1.0 at 70) and
CharacterModel_SetWeightMorph (0 at 60 kg, +0.025 per kg up to 1.0 at 100 kg) but the decompiler lost which of the two is p4 and which p5:
this reads p4 = age, p5 = weight (an assumption; the deltas are small, 1 to 4 cm at most).
"""
import math
import struct
import sys

N = 996


def parse(data):
    if struct.unpack_from("<I", data, 0)[0] != 4:
        raise ValueError("not a version 4 .hd file")
    n = (len(data) - 0x94) // 72
    if n != N or len(data) != 0x94 + 72 * N:
        raise ValueError("unexpected .hd size %d" % len(data))
    f = struct.unpack_from("<%df" % (18 * N), data, 0x94)
    arrays = [[f[a * 6 * N + 6 * i:a * 6 * N + 6 * i + 6] for i in range(N)] for a in range(3)]
    return {"texture": data[0x0C:0x2C].split(b"\0")[0].decode("latin1"), "A": arrays[0], "B": arrays[1], "C": arrays[2]}


def age_weight(age_years, weight_kg):
    """CharacterModel_SetAgeMorph / SetWeightMorph: the two morph amounts for an age in years and a weight in kg."""
    a = 0.0
    if age_years >= 18.0 and age_years >= 30.0:
        a = max(0.0, min(1.0, (min(age_years, 70.0) - 30.0) * 0.025))
    w = max(0.0, min(1.0, (max(60.0, min(weight_kg, 100.0)) - 60.0) * 0.025))
    return a, w


def shape(hd, p4, p5):
    return [[hd["A"][i][k] + p4 * hd["B"][i][k] + p5 * hd["C"][i][k] for k in range(6)] for i in range(N)]


def norm(v):
    n = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) or 1.0
    return [v[0] / n, v[1] / n, v[2] / n]


def morph(hd0, p4=0.0, p5=0.0, hd1=None, mix=0.0):
    """Return 996 (x, y, z, nx, ny, nz) tuples in the vertex order of generic_head.msh."""
    s0 = shape(hd0, p4, p5)
    if hd1 is None or mix == 0.0:
        return [tuple(v[:3]) + tuple(norm(v[3:6])) for v in s0]
    s1 = shape(hd1, p4, p5)
    out = []
    for a, b in zip(s0, s1):
        p = [(1 - mix) * a[k] + mix * b[k] for k in range(3)]
        nrm = [(1 - mix) * norm(a[3:6])[k] + mix * norm(b[3:6])[k] for k in range(3)]
        out.append(tuple(p) + tuple(norm(nrm)))
    return out


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for p in sys.argv[1:]:
        h = parse(open(p, "rb").read())
        dB = max(abs(x) for v in h["B"] for x in v[:3])
        dC = max(abs(x) for v in h["C"] for x in v[:3])
        print("%s: texture %s, %d vertices, max |B| %.3f, max |C| %.3f" % (p, h["texture"], N, dB, dC))
