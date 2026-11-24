#!/usr/bin/env python3
"""Read The Movies .msh models: texture names, materials, extra polygon chunks and named parts (with bounding boxes).

    python3 tools/pak_extract.py extract "<game>/Data/pak" data/game_data/meshes "fac_gatehouse.msh" "p_hedge.msh"
    python3 tools/msh_dump.py data/game_data/meshes/*.msh

Layout, from LH_LoadMeshBinary (009deb10); the parts listed here were checked against real files (docs/MSH_FORMAT.md):

    [optional "zcmp" + 16 bytes + zlib stream]              the loader inflates these first
    header 0x24 bytes: u32 version (10), u32 n_textures, u32 n_materials, u32 n_submeshes, 8 flag bytes (0x10..0x17), then up
           to three optional u32 chosen by control byte 0x16 (bit 1 -> 0x18, bit 6 -> next, bit 7 -> next = n_named_parts)
    n_textures x 32-byte NUL-padded names (.dds)
    n_materials x 0x14 bytes (0x18 when byte 0xe & 4): u8 tex0, tex1, tex2, tex3 ..., flags, u32 colour at 0x10
    "aux polygon chunks", each present when its flag bit is set, in this order:
        byte 0x13 != 0, byte 0x16 & 0x10, byte 0x16 & 8, byte 0x15 & 4, byte 0x16 & 4, byte 0x15 & 2, byte 0x16 & 1
        chunk = u16 n_verts, u16 ?, u16 n_tris, u16 ?, n_verts x 3 f32, n_tris x 3 u16, padded to 4 bytes
    n_named_parts x (32-byte name + aux polygon chunk)       ("room_*", "window*", ...)
    nodes, then (flag byte 0) a skeleton, (flag byte 1 or byte 7 & 1) one 32-byte name per node, (flag byte 2 = count) the tag points, 0x50 bytes each
"""
import struct
import sys
import os
import zlib

CHUNK_SLOTS = [("flag13", 0x13, 0xFF), ("b16_10", 0x16, 0x10), ("b16_08", 0x16, 0x08), ("b15_04", 0x15, 0x04),
               ("b16_04", 0x16, 0x04), ("b15_02", 0x15, 0x02), ("b16_01", 0x16, 0x01)]


def inflate(data):
    if data[:4] == b"zcmp":
        return zlib.decompress(data[20:])
    return data


def cstr(b):
    return b.split(b"\0")[0].decode("latin1")


def chunk(d, pos):
    nv, _a, nt, _b = struct.unpack_from("<4H", d, pos)
    pos += 8
    verts = [struct.unpack_from("<3f", d, pos + 12 * i) for i in range(nv)]
    pos += 12 * nv
    tris = [struct.unpack_from("<3H", d, pos + 6 * i) for i in range(nt)]
    pos += 6 * nt
    return {"verts": verts, "tris": tris}, (pos + 3) & ~3


def bbox(verts):
    if not verts:
        return None
    return tuple((min(v[k] for v in verts), max(v[k] for v in verts)) for k in range(3))


def align4(p):
    return (p + 3) & ~3


def read_node(d, pos):
    """One submesh node: 0x34 bytes (u8 n_prims, 3 more bytes with bit 0x10 of byte 3 = 4 extra bytes follow, 12 f32 = 3x3 matrix + translation),
    then n_prims primitives (docs/MSH_FORMAT.md)."""
    nprim = d[pos]
    has_extra = d[pos + 3] & 0x10
    m = struct.unpack_from("<12f", d, pos + 4)
    pos += 0x38 if has_extra else 0x34
    prims = []
    for _ in range(nprim):
        mat = d[pos] & 0xFF
        ntri, nvert = struct.unpack_from("<2I", d, pos + 4)
        f0, f1, f2, f3 = d[pos + 12:pos + 16]
        pos += 16
        if f0 & 0x10:
            pos += 12
        qb = None
        if f0 & 0x20:
            qb = struct.unpack_from("<14f", d, pos)
            pos += 56
        extra = 0
        if f0 & 0x40:
            extra = struct.unpack_from("<I", d, pos)[0]
            pos += 4
        tris = [struct.unpack_from("<3H", d, pos + 6 * i) for i in range(ntri)]
        pos = align4(pos + 6 * ntri)
        verts = []
        if f0 & 0x20:           # compact: 8 x u16 per vertex, dequantized with the bounds block
            for i in range(nvert):
                u = struct.unpack_from("<8H", d, pos + 16 * i)
                t = [v / 65535.0 for v in u]
                verts.append((qb[0] + t[0] * (qb[3] - qb[0]), qb[1] + t[1] * (qb[4] - qb[1]), qb[2] + t[2] * (qb[5] - qb[2]),
                              2 * t[3] - 1, 2 * t[4] - 1, 2 * t[5] - 1,
                              qb[6] + t[6] * (qb[8] - qb[6]), qb[7] + t[7] * (qb[9] - qb[7])))
            pos += 16 * nvert
            if f1 & 1:          # second UV set (the lightmap's): 2 x u16 per vertex, bounds = block floats 10..13 (u min, v min, u max, v max)
                for i in range(nvert):
                    a, b = struct.unpack_from("<2H", d, pos + 4 * i)
                    verts[i] = verts[i] + (qb[10] + a / 65535.0 * (qb[12] - qb[10]), qb[11] + b / 65535.0 * (qb[13] - qb[11]))
                pos += 4 * nvert
        else:                   # direct: 8 x f32 per vertex (position, normal, uv)
            for i in range(nvert):
                verts.append(struct.unpack_from("<8f", d, pos + 32 * i))
            pos += 32 * nvert
            if f1 & 1:
                for i in range(nvert):
                    verts[i] = verts[i] + struct.unpack_from("<2f", d, pos + 8 * i)
                pos += 8 * nvert
        pos = align4(pos)
        skin = None
        if f0 & 1:              # skinning: 4 f32 weights + 4 bone indices (u8) per vertex (bones of the skeleton block, see parse_skeleton)
            skin = [(struct.unpack_from("<4f", d, pos + 20 * i), tuple(d[pos + 20 * i + 16:pos + 20 * i + 20])) for i in range(nvert)]
            pos += 20 * nvert
        pos += 8 * extra
        prims.append({"material": mat, "verts": verts, "tris": tris, "flags": (f0, f1, f2, f3), "skin": skin})
    return {"matrix": m, "prims": prims}, pos


def parse(data, geometry=True):
    d = inflate(data)
    ver, ntex, nmat, nsub = struct.unpack_from("<4I", d, 0)
    if ver != 10:
        raise ValueError(f"unsupported mesh version {ver}")
    flags = d[0x10:0x18]
    ctrl = flags[6]
    pos = 0x18
    opt = []
    for bit in (2, 0x40, 0x80):
        if ctrl & bit:
            opt.append(struct.unpack_from("<I", d, pos)[0])
            pos += 4
        else:
            opt.append(0)
    n_named = opt[2]
    textures = [cstr(d[pos + 32 * i:pos + 32 * i + 32]) for i in range(ntex)]
    pos += 32 * ntex
    mats = []
    for _ in range(nmat):
        m = d[pos:pos + 0x18]
        mats.append({"tex": list(m[0:4]), "flags": m[4:16].hex(), "colour": struct.unpack_from("<I", m, 0x10)[0]})
        pos += 0x18 if m[0xE] & 4 else 0x14
    chunks = {}
    for name, off, mask in CHUNK_SLOTS:
        if flags[off - 0x10] & mask:
            chunks[name], pos = chunk(d, pos)
    parts = []
    for _ in range(n_named):
        name = cstr(d[pos:pos + 32])
        pos += 32
        c, pos = chunk(d, pos)
        parts.append((name, c))
    nodes = []
    try:
        for _ in range(nsub if geometry else 0):
            node, pos = read_node(d, pos)
            nodes.append(node)
    except Exception as e:      # geometry is best effort; the header data above is still valid
        nodes.append({"error": f"{type(e).__name__}: {e} at 0x{pos:x}", "prims": []})
    bones = []
    try:
        bones = parse_skeleton(d, pos)
    except Exception:
        pass
    tags, node_names = [], []
    try:                                  # after the skeleton: per-node names, then the named tag points
        if geometry and not any("error" in n for n in nodes):
            if flags[0]:
                pos += 8 + struct.unpack_from("<I", d, pos + 4)[0] * 84
            if flags[1] or flags[7] & 1:  # one 32-byte name per node
                node_names = [cstr(d[pos + 32 * i:pos + 32 * i + 32]) for i in range(nsub)]
                pos += 32 * nsub
            for _ in range(flags[2]):     # tag points: 32-byte name + 12 f32 (3x3 matrix, translation) = 0x50 bytes
                f = struct.unpack_from("<12f", d, pos + 32)
                tags.append({"name": cstr(d[pos:pos + 32]), "matrix": f[:9], "pos": f[9:12]})
                pos += 0x50
    except Exception as e:
        tags.append({"error": f"{type(e).__name__}: {e} at 0x{pos:x}"})
    return {"version": ver, "n_submeshes": nsub, "flags": flags.hex(), "textures": textures, "materials": mats,
            "chunks": chunks, "parts": parts, "nodes": nodes, "size": len(d), "rest": pos, "bones": bones,
            "tags": tags, "node_names": node_names}


def parse_skeleton(d, pos):
    """Skeleton block after the nodes: u32 ?, u32 n_bones, then n_bones x 84 bytes = 32-byte name, i32 parent (-1 root), 12 f32 =
    the bone's WORLD bind pose: 3 rows (the bone's x, y, z axes in model space, row-vector convention) + translation.
    Verified on cos_m_50s_1.msh: 30 bones, parents equal the parent table of walk.anm, the anim's local offsets equal world(child) - world(parent)."""
    n = struct.unpack_from("<I", d, pos + 4)[0]
    if not 0 < n < 512 or pos + 8 + 84 * n > len(d):
        return []
    out = []
    for i in range(n):
        o = pos + 8 + 84 * i
        f = struct.unpack_from("<12f", d, o + 36)
        out.append({"name": cstr(d[o:o + 32]), "parent": struct.unpack_from("<i", d, o + 32)[0],
                    "rot": [f[0:3], f[3:6], f[6:9]], "pos": f[9:12]})
    return out


def fmt_box(b):
    return "none" if b is None else " ".join(f"{lo:.2f}..{hi:.2f}" for lo, hi in b)


def show(name, m):
    print(f"{name}: v{m['version']} {m['size']} bytes, {m['n_submeshes']} submesh(es), flags {m['flags']}")
    print("  textures:", ", ".join(m["textures"]) or "-")
    for i, x in enumerate(m["materials"]):
        print(f"  material {i}: texture idx {x['tex']} colour {x['colour']:08x}")
    for k, c in m["chunks"].items():
        print(f"  chunk {k}: {len(c['verts'])} verts, {len(c['tris'])} tris, box x/y/z {fmt_box(bbox(c['verts']))}")
    for n, c in m["parts"]:
        print(f"  part {n!r}: {len(c['verts'])} verts, box x/y/z {fmt_box(bbox(c['verts']))}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for p in sys.argv[1:]:
        try:
            show(os.path.basename(p), parse(open(p, "rb").read()))
        except Exception as e:  # keep going over a batch
            print(f"{os.path.basename(p)}: {e}")
