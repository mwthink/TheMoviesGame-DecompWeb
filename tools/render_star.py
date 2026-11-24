#!/usr/bin/env python3
"""Render a StarMaker star (a folder with info.sm and star.hd) with makeup, hair and iris colour, optionally with a facial expression.
Pure Python. Layout of info.sm and the mechanisms: docs/STARMAKER.md sections 6 to 9.

    python3 tools/render_star.py <star folder> <assets dir> <out.png> [--expr FRAME[:INTENSITY]] [--yaw DEGREES] [--size N]

<assets dir> holds generic_facialskin.msh, eyes.dds, the fe_<head>.anm of the star's first head, the head textures (head_*.dds), mup_*.dds, hair_*.dds and hair_*.msh
(see data/game_data/makeup and data/game_data/sm_assets; tools/pak_extract.py extracts them from the game).
"""
import math
import struct
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
import dds
import msh_dump as M
from render_expression import Face, write_png

HAIR_SUFFIX = ["", "_bd", "_bk", "_rd", "_db", "_px"]       # hair colour index 0..5 (StarMaker exe table at 0x6122a0: _bd _bk _rd _db _px after the unsuffixed base)

def read_info(path):
    b = open(path, "rb").read()
    cs = lambda o: b[o:o + 32].split(b"\0")[0].decode("latin1")
    f = lambda o: struct.unpack_from("<f", b, o)[0]
    u = lambda o: struct.unpack_from("<I", b, o)[0]
    return {"gender": u(0x0c), "attrs": struct.unpack_from("<14f", b, 0x10), "head0": cs(0x48), "head1": cs(0x68), "hair": cs(0x88),
            "head_blend": f(0xa8), "skin_blend": f(0xac), "eye": u(0xb0), "age_slider": f(0xb4), "hair_colour": u(0xb8),
            "eyebrow": u(0xbc), "eye_makeup": u(0xc0), "makeup_colour": u(0xc4), "beard": u(0xc8), "lipstick": u(0xcc),
            "name": b[0x180:].decode("utf-16le", "replace").rstrip("\0")}

def find(assets, name):
    for root, _d, files in os.walk(assets):
        if name in files:
            return os.path.join(root, name)
    return None

def load_tex(assets, name):
    p = find(assets, name)
    return dds.load(p) if p else None

def blend_layer(base, layer):           # alpha-over, both 512x512 lists of (r, g, b, a)
    out = []
    for (r, g, b, a), (lr, lg, lb, la) in zip(base, layer):
        t = la / 255.0
        out.append((int(r * (1 - t) + lr * t), int(g * (1 - t) + lg * t), int(b * (1 - t) + lb * t), a))
    return out

def aged(assets, name, age):
    """Hair and beard textures: the coloured texture with its `_gy` (grey) variant blended over it at alpha = age morph (FUN_00441970, FUN_004415a0)."""
    base = load_tex(assets, name)
    if not base or age <= 0:
        return base
    gy = load_tex(assets, name.replace(".dds", "_gy.dds"))
    if not gy or gy[0] != base[0]:
        return base
    mix = [tuple(int(a * (1 - age) + b * age) for a, b in zip(p, q)) for p, q in zip(base[2], gy[2])]
    return (base[0], base[1], mix)

def face_texture(assets, info, age=0.0):
    t0 = load_tex(assets, info["tex0"])
    w, h, px = t0
    if info["tex1"]:
        t1 = load_tex(assets, info["tex1"])
        if t1 and t1[0] == w:
            s = info["skin_blend"]
            px = [tuple(int(a * (1 - s) + b * s) for a, b in zip(p, q)) for p, q in zip(px, t1[2])]
    layers = []
    suffix = HAIR_SUFFIX[info["hair_colour"]] if info["hair_colour"] < len(HAIR_SUFFIX) else ""
    male = info["gender"] == 1
    def vfile(prefix, idx, suf=""):
        return "%s%02d%s.dds" % (prefix, idx - 1, suf) if idx >= 1 else None
    # Layer slots are drawn in category order (FUN_004415a0 / FUN_0046dfd0): 0+1 eyes (shape x colour pair, drawn at slot 1 and only when slot 0 has a
    # shape), 2 lips, 3 beard (hair colour suffix, `_gy` overlay by age), 4 tattoo, 5/6 eyebrows (male/female), 7 nails (skipped), 8 mask.
    if info["eye_makeup"] >= 1 and info["makeup_colour"] >= 1:
        layers.append(("eyes", vfile("mup_eyes_v", info["eye_makeup"]), vfile("mup_eyes_v", info["makeup_colour"])))
    layers.append(vfile("mup_lips_v", info["lipstick"]))
    layers.append(vfile("mup_beard_v", info["beard"], suffix))
    layers.append(vfile("mup_meyebrow_v" if male else "mup_feyebrow_v", info["eyebrow"]))
    if info["hair"].lower().endswith(".msh"):
        stem = info["hair"][:-4]
        m = M.parse(open(find(assets, info["hair"]), "rb").read()) if find(assets, info["hair"]) else None
        if m and not any(nd["prims"] for nd in m["nodes"]):          # no geometry: the hairstyle is a texture layer on the face
            layers.append(stem + suffix + ".dds")
    used = []
    for name in layers:
        if isinstance(name, tuple):             # eye makeup: the shape file's alpha, tinted with the colour file's average colour (the exact two-texture blend `FUN_004473c0` was not read)
            _k, shape, colour = name
            st, ct = load_tex(assets, shape), load_tex(assets, colour)
            if st and ct and st[0] == w:
                tot = sum(p[3] for p in ct[2]) or 1
                tint = [sum(p[j] * p[3] for p in ct[2]) // tot for j in range(3)]
                px = blend_layer(px, [(tint[0], tint[1], tint[2], p[3]) for p in st[2]]); used.append("eyes %s tinted by %s" % (shape, colour))
            continue
        if name:
            lt = aged(assets, name, age) if (name.startswith("mup_beard") or name.startswith("hair_")) else load_tex(assets, name)
            if lt and lt[0] == w:
                px = blend_layer(px, lt[2]); used.append(name)
            else:
                used.append(name + " (missing)")
    return (w, h, px), used

def raster(mesh, textures, size, box, yaw, bg=(30, 30, 30)):
    pos, nrm, uv, tris = mesh
    th = math.radians(yaw)
    cx, cy = math.cos(th), math.sin(th)
    right = (math.sin(th), -math.cos(th))               # image right on the ground plane; yaw 0 looks at the face from +x
    (x0, x1, z0, z1) = box
    sc = size / max(x1 - x0, z1 - z0)
    def proj(p):
        return ((p[0] * right[0] + p[1] * right[1] - x0) * sc, size - (p[2] - z0) * sc), p[0] * cx + p[1] * cy
    img = [bg[i % 3] for i in range(size * size * 3)]
    zb = [-1e9] * (size * size)
    light = (0.4 * cx - 0.2 * 0 + 0.0, 0.4 * cy, 0.9)
    for a, b, c, texi in tris:
        tw, tht, px = textures[texi]
        pr = [proj(pos[i]) for i in (a, b, c)]
        S = [q[0] for q in pr]; D = [q[1] for q in pr]
        if texi == 1 and a >= 818 and min(pos[a][2], pos[b][2], pos[c][2]) > 1.70:       # eyelid interior (uses the black part of the atlas): behind the eyeball
            D = [d - 0.012 for d in D]
        minx, maxx = int(max(0, min(s[0] for s in S))), int(min(size - 1, max(s[0] for s in S)))
        miny, maxy = int(max(0, min(s[1] for s in S))), int(min(size - 1, max(s[1] for s in S)))
        den = (S[1][1] - S[2][1]) * (S[0][0] - S[2][0]) + (S[2][0] - S[1][0]) * (S[0][1] - S[2][1])
        if abs(den) < 1e-9:
            continue
        for y in range(miny, maxy + 1):
            for x in range(minx, maxx + 1):
                l0 = ((S[1][1] - S[2][1]) * (x + 0.5 - S[2][0]) + (S[2][0] - S[1][0]) * (y + 0.5 - S[2][1])) / den
                l1 = ((S[2][1] - S[0][1]) * (x + 0.5 - S[2][0]) + (S[0][0] - S[2][0]) * (y + 0.5 - S[2][1])) / den
                l2 = 1 - l0 - l1
                if l0 < 0 or l1 < 0 or l2 < 0:
                    continue
                d = l0 * D[0] + l1 * D[1] + l2 * D[2]
                if d <= zb[y * size + x]:
                    continue
                u = l0 * uv[a][0] + l1 * uv[b][0] + l2 * uv[c][0]
                v = l0 * uv[a][1] + l1 * uv[b][1] + l2 * uv[c][1]
                uu, vv = (min(max(u, 0.0), 1.0), min(max(v, 0.0), 1.0)) if texi == 1 else (u % 1.0, v % 1.0)       # eyes/mouth atlas: clamp (some UVs are -0.002)
                r, g, bl, al = px[int(vv * (tht - 1)) * tw + int(uu * (tw - 1))]
                if texi == 2 and al < 128:                   # hair: alpha test
                    continue
                zb[y * size + x] = d
                nm = [l0 * nrm[a][j] + l1 * nrm[b][j] + l2 * nrm[c][j] for j in range(3)]
                ln = math.sqrt(sum(q * q for q in nm)) or 1
                sh = 0.62 + 0.55 * max(0.0, sum(nm[j] / ln * light[j] for j in range(3)))
                o = (y * size + x) * 3
                img[o], img[o + 1], img[o + 2] = min(255, int(r * sh)), min(255, int(g * sh)), min(255, int(bl * sh))
    return img

def build(star, assets, expr=None):
    info = read_info(star + "/info.sm")
    hd = open(star + "/star.hd", "rb").read()
    cs = lambda o: hd[o:o + 32].split(b"\0")[0].decode("latin1")
    info["tex0"], info["tex1"] = cs(0x0c), (cs(0x2c) if info["head1"] else "")      # the head textures are named in star.hd's header (the texture of head_m_white_hero2.hd is head_m_white_hero.dds)
    f = struct.unpack_from("<%df" % (996 * 6 * 3), hd, 0x94)
    A = [f[i * 6:i * 6 + 6] for i in range(996)]
    C = [f[5976 * 2 + i * 6:5976 * 2 + i * 6 + 6] for i in range(996)]
    years = info["age_slider"] * 47 + 18
    age = max(0.0, min(1.0, (years - 30) * 0.025))
    face = Face(assets, "fe_" + info["head0"][5:].replace(".hd", ".anm"))
    pos = [[A[i][j] + age * C[i][j] for j in range(3)] for i in range(996)]
    nrm = [[A[i][3 + j] + age * C[i][3 + j] for j in range(3)] for i in range(996)]
    if expr:
        S = face.matrices(expr[0])
        for k, (v, (w, idx)) in enumerate(zip(pos, face.skin)):
            acc = [0.0, 0.0, 0.0]
            from starmaker_sliders import xform
            for wk, bk in zip(w, idx):
                if wk:
                    q = xform(v, S[bk]); acc = [acc[j] + wk * q[j] for j in range(3)]
            pos[k] = [v[j] + expr[1] * (acc[j] - v[j]) for j in range(3)]
    uv = [list(v[6:8]) for v in face.verts]
    tris = list(face.tris)
    eye_cell = info["eye"] % 8
    for i in range(996):                                 # eye primitive = vertices 760..817 (second primitive): move to the chosen iris cell of the atlas
        if 760 <= i < 818:
            uv[i] = [uv[i][0] + (eye_cell % 4) * 0.25, uv[i][1] + (eye_cell // 4) * 0.25]
    head_tex, used = face_texture(assets, info, age)
    eyes_tex = load_tex(assets, "eyes.dds")
    textures = [head_tex, eyes_tex, None]
    # hair mesh (skinned to the body skeleton; the body is at its bind pose so the vertices are used as stored)
    hp = find(assets, info["hair"]) if info["hair"].lower().endswith(".msh") else None
    if hp:
        hm = M.parse(open(hp, "rb").read())
        for nd in hm["nodes"]:
            for p in nd["prims"]:
                base = len(pos)
                for v in p["verts"]:
                    pos.append(list(v[:3])); nrm.append(list(v[3:6])); uv.append(list(v[6:8]))
                tris += [(base + a, base + b, base + c, 2) for a, b, c in p["tris"]]
                if hm["textures"]:
                    suffix = HAIR_SUFFIX[info["hair_colour"]] if info["hair_colour"] < len(HAIR_SUFFIX) else ""
                    ht = aged(assets, hm["textures"][0].replace(".dds", suffix + ".dds"), age)
                    textures[2] = ht or textures[2]
                    used.append(hm["textures"][0].replace(".dds", suffix + ".dds"))
    return info, (pos, nrm, uv, tris), textures, used, years, age

if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    star, assets, out = sys.argv[1:4]
    expr, yaw, size = None, 0.0, 420
    a = sys.argv[4:]
    while a:
        k = a.pop(0)
        if k == "--expr":
            s = a.pop(0); expr = (int(s.split(":")[0]), float(s.split(":")[1]) if ":" in s else 1.0)
        elif k == "--yaw":
            yaw = float(a.pop(0))
        elif k == "--size":
            size = int(a.pop(0))
    info, mesh, textures, used, years, age = build(star, assets, expr)
    print(info["name"], "age %.0f (morph %.3f)" % (years, age), "iris", info["eye"], "hair colour", info["hair_colour"], "layers", used)
    zs = [p[2] for p in mesh[0]]; ys = [p[1] for p in mesh[0]]; xs = [p[0] for p in mesh[0]]
    r = max(max(ys) - min(ys), max(xs) - min(xs)) / 2 + 0.03
    box = (-r, r, min(zs) - 0.02, max(zs) + 0.02) if yaw == 0 else (-r, r, min(zs) - 0.02, max(zs) + 0.02)
    img = raster(mesh, textures, size, box, yaw)
    write_png(out, size, size, img)
    print("wrote", out)
