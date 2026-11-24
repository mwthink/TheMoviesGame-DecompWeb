#!/usr/bin/env python3
"""Export a skinned character and animation clips for the three.js viewer (viewer/).

    python3 tools/pak_extract.py extract "<game>/Data/pak" data/game_data/chars cos_m_50s_1.msh cos_m_50s_1.dds 'walk*.anm'
    python3 tools/export_character.py data/game_data/chars/cos_m_50s_1.msh,data/game_data/chars/generic_head.msh data/game_data/chars/walk*.anm --out viewer/data/sample

Writes <out>/character.json (mesh, skeleton, skinning, clips) and <out>/<texture>.png, and lists the character in the index.json of <out>'s parent folder (the viewer's selector). The coordinate system is left as the game has it
(Z up); the viewer sets camera.up = +Z. Bones carry LOCAL transforms: position in the parent's frame and a quaternion. The game stores
rotations as 3x3 matrices whose ROWS are the child's axes (row-vector convention); three.js wants columns, so the matrix is transposed.
"""
import argparse
import json
import math
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anm_dump
import dds
import msh_dump


def mm(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def tr(m):
    return [list(r) for r in zip(*m)]


def vm(v, m):
    return [sum(v[k] * m[k][j] for k in range(3)) for j in range(3)]


def quat_from_rows(R):
    """Quaternion (x, y, z, w) of the column-convention rotation M = R^T."""
    m = tr(R)
    t = m[0][0] + m[1][1] + m[2][2]
    if t > 0:
        s = math.sqrt(t + 1) * 2
        q = [(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s, s / 4]
    elif m[0][0] > m[1][1] and m[0][0] > m[2][2]:
        s = math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2
        q = [s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] - m[1][2]) / s]
    elif m[1][1] > m[2][2]:
        s = math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2
        q = [(m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s, (m[0][2] - m[2][0]) / s]
    else:
        s = math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2
        q = [(m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4, (m[1][0] - m[0][1]) / s]
    return q


def write_png(path, w, h, px):
    raw = b"".join(b"\0" + b"".join(bytes(p) for p in px[y * w:(y + 1) * w]) for y in range(h))

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) +
                chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def build_parts(path, out, remap, find=None, parsed=None):
    """One part per primitive: its own vertex arrays and diffuse texture (written as PNG)."""
    m = (parsed or {}).get(path) or msh_dump.parse(open(path, "rb").read())
    parts = []
    for node in m["nodes"]:
        for pi, p in enumerate(node["prims"]):
            pos, nrm, uv, si, sw = [], [], [], [], []
            for i, v in enumerate(p["verts"]):
                pos += v[0:3]
                nrm += v[3:6]
                uv += [v[6], v[7]]
                w, bi = p["skin"][i] if p["skin"] else ((1, 0, 0, 0), (0, 0, 0, 0))
                sw += list(w)
                si += list(bi)
            idx = [i for t in p["tris"] for i in t]
            mt = m["materials"][p["material"]] if p["material"] < len(m["materials"]) else None
            ti = mt["tex"][0] if mt else 255
            tex = m["textures"][ti] if ti < len(m["textures"]) else None
            texfile = None
            if tex:
                tex = remap.get(tex, tex)
                src = find(tex) if find else os.path.join(os.path.dirname(path), tex)
                if src and os.path.exists(src):
                    w_, h_, px = dds.load(src)
                    texfile = os.path.splitext(tex)[0] + ".png"
                    write_png(os.path.join(out, texfile), w_, h_, px)
                else:
                    print("texture not found:", src)
            parts.append({"name": "%s#%d" % (os.path.basename(path), pi), "texture": texfile, "position": pos, "normal": nrm, "uv": uv,
                          "skinIndex": si, "skinWeight": sw, "index": idx})
    return m, parts


def write_character(meshes, anims, out, remap=None, find=None, name=None, parsed=None):
    """meshes: .msh paths sharing one skeleton (the first provides the bones); anims: .anm paths; find(name) -> texture path or None;
    parsed: {path: already parsed msh_dump result} for meshes that were modified (e.g. a morphed head). Writes <out>/character.json and the PNG textures."""
    os.makedirs(out, exist_ok=True)
    parts, bones = [], None
    for path in meshes:
        m, ps = build_parts(path, out, remap or {}, find, parsed)
        parts += ps
        bones = bones or m["bones"]
    if not bones:
        sys.exit("no skeleton in " + meshes[0])
    # bind pose -> local transforms
    jb = []
    for b in bones:
        R, t = b["rot"], b["pos"]
        if b["parent"] < 0:
            lr, lt = R, list(t)
        else:
            p = bones[b["parent"]]
            lr = mm(R, tr(p["rot"]))
            lt = vm([t[k] - p["pos"][k] for k in range(3)], tr(p["rot"]))
        jb.append({"name": b["name"], "parent": b["parent"], "pos": lt, "quat": quat_from_rows(lr)})
    clips = []
    for path in anims:
        try:
            an = anm_dump.parse(open(path, "rb").read())
        except Exception as e:
            print("skip", path, e)
            continue
        if an["n_channels"] != len(bones):
            print("skip", path, "channels", an["n_channels"], "!=", len(bones))
            continue
        frames = [[quat_from_rows(R) + list(t) for (R, t) in fr] for fr in an["frames"]]
        clips.append({"name": os.path.splitext(os.path.basename(path))[0], "duration": an["duration"], "frames": frames,
                      "rootMove": an["root"][9:12]})
    doc = {"name": name or os.path.basename(meshes[0]), "bones": jb, "parts": parts, "clips": clips}

    def r(o):
        return round(o, 5) if isinstance(o, float) else o
    with open(os.path.join(out, "character.json"), "w") as f:
        json.dump(doc, f, default=r, separators=(",", ":"))
    print("wrote %s: %d parts, %d verts, %d bones, %d clips" % (out, len(parts), sum(len(p["position"]) // 3 for p in parts), len(jb), len(clips)))


def register(root, cid, label, rel):
    """Add (or replace) a character in <root>/index.json, the list the viewer's selector shows: {"characters": [{"id", "name", "path"}]}."""
    path = os.path.join(root, "index.json")
    try:
        idx = json.load(open(path))
    except (OSError, ValueError):
        idx = {"characters": []}
    chars = [c for c in idx.get("characters", []) if c.get("id") != cid]
    chars.append({"id": cid, "name": label, "path": rel})
    chars.sort(key=lambda c: c["id"])
    with open(path, "w") as f:
        json.dump({"characters": chars}, f, indent=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("meshes", help="comma-separated .msh files sharing one skeleton (body, head, hair ...); the first provides the bones")
    ap.add_argument("anims", nargs="*")
    ap.add_argument("--out", default="viewer/data/sample", help="folder for this character; it is added to the index.json of its parent folder")
    ap.add_argument("--map", action="append", default=[], help="texture override NAME=OTHER (use another file for a texture a model names, e.g. a colour variant such as hair_50s_m1.dds=hair_50s_m1_bk.dds)")
    a = ap.parse_args()
    write_character(a.meshes.split(","), a.anims, a.out, dict(x.split("=", 1) for x in a.map))
    out = os.path.normpath(a.out)
    register(os.path.dirname(out) or ".", os.path.basename(out), os.path.basename(a.meshes.split(",")[0]), os.path.basename(out) + "/character.json")


if __name__ == "__main__":
    main()
