#!/usr/bin/env python3
"""Render facial expressions on a head: generic_facialskin.msh skinned with frames of fe_<head>.anm (docs/STARMAKER.md section 8). No third-party modules.

    python3 tools/render_expression.py <dir with generic_facialskin.msh, fe_<head>.anm> <head.dds> <out.png> <frame[:intensity]> ...

Skinning: the 35 face bones are children of the body skeleton (mostly the `head` bone); their animation values are local to the parent, so the
current world matrix of a face bone is local * world(parent) with the body bones left at their bind pose, the skin matrix is inverse(bind world) *
current world, and a vertex is the weighted sum of its 4 influences. Frame 0 is rendered as the neutral face; `intensity` blends the skin
matrices' effect towards the bind pose (position = bind + intensity * (skinned - bind)).
"""
import math
import struct
import sys
import zlib

sys.path.insert(0, __import__("os").path.dirname(__file__))
import anm_dump as A
import msh_dump as M
import dds
from starmaker_sliders import mat_mul, mat_inv, xform

def write_png(path, w, h, rgb):
    raw = b"".join(b"\0" + bytes(rgb[y * w * 3:(y + 1) * w * 3]) for y in range(h))
    def ch(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + ch(b"IDAT", zlib.compress(raw, 6)) + ch(b"IEND", b""))

class Face:
    def __init__(self, d, anm):
        self.msh = M.parse(open(d + "/generic_facialskin.msh", "rb").read())
        self.bones = self.msh["bones"]
        self.anm = A.parse(open(d + "/" + anm, "rb").read())
        self.bind = [(b["rot"], list(b["pos"])) for b in self.bones]
        self.inv = [mat_inv(b) for b in self.bind]
        self.verts, self.skin, self.tris = [], [], []
        for j, p in enumerate(self.msh["nodes"][0]["prims"]):       # prim 0 = face (head texture), 1 = eyes, 2 = mouth interior (eyes.dds)
            base = len(self.verts)
            self.verts += p["verts"]
            self.skin += p["skin"]
            self.tris += [(base + a, base + b, base + c, min(j, 1)) for a, b, c in p["tris"]]
        self.first = len(self.bones) - self.anm["n_channels"]      # the animated bones are the last ones (the 35 fa_* bones)

    def matrices(self, frame):
        world = list(self.bind)
        for c in range(self.anm["n_channels"]):
            b = self.first + c
            r, t = self.anm["frames"][frame][c]
            world[b] = mat_mul((r, t), world[self.bones[b]["parent"]])     # parents come first
        return [mat_mul(self.inv[i], world[i]) for i in range(len(world))]

    def pose(self, frame, intensity=1.0):
        S = self.matrices(frame)
        out = []
        for v, (w, idx) in zip(self.verts, self.skin):
            p = list(v[:3])
            acc = [0.0, 0.0, 0.0]
            for wk, bk in zip(w, idx):
                if wk:
                    q = xform(p, S[bk])
                    acc = [acc[j] + wk * q[j] for j in range(3)]
            out.append([p[j] + intensity * (acc[j] - p[j]) for j in range(3)])
        return out

def render(face, pos, tex, size, box):
    img = [30] * (size * size * 3)
    zb = [-1e9] * (size * size)
    (x0, x1, z0, z1) = box
    sc = size / max(x1 - x0, z1 - z0)
    def proj(p):                # look at the face from the front (+x): image right = -y, up = +z
        return ((-p[1] - x0) * sc, size - (p[2] - z0) * sc)
    light = (0.4, 0.2, 0.9)
    for a, b, c, texi in face.tris:
        tw, th, px = tex[texi]
        P = [pos[i] for i in (a, b, c)]
        S = [proj(p) for p in P]
        minx, maxx = int(max(0, min(s[0] for s in S))), int(min(size - 1, max(s[0] for s in S)))
        miny, maxy = int(max(0, min(s[1] for s in S))), int(min(size - 1, max(s[1] for s in S)))
        den = (S[1][1] - S[2][1]) * (S[0][0] - S[2][0]) + (S[2][0] - S[1][0]) * (S[0][1] - S[2][1])
        if abs(den) < 1e-9:
            continue
        # face normal for shading (front facing only: x component of the geometric normal)
        e1 = [P[1][j] - P[0][j] for j in range(3)]; e2 = [P[2][j] - P[0][j] for j in range(3)]
        n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
        ln = math.sqrt(sum(x * x for x in n)) or 1
        n = [x / ln for x in n]
        V = [face.verts[i] for i in (a, b, c)]
        for y in range(miny, maxy + 1):
            for x in range(minx, maxx + 1):
                l0 = ((S[1][1] - S[2][1]) * (x + 0.5 - S[2][0]) + (S[2][0] - S[1][0]) * (y + 0.5 - S[2][1])) / den
                l1 = ((S[2][1] - S[0][1]) * (x + 0.5 - S[2][0]) + (S[0][0] - S[2][0]) * (y + 0.5 - S[2][1])) / den
                l2 = 1 - l0 - l1
                if l0 < 0 or l1 < 0 or l2 < 0:
                    continue
                zx = l0 * P[0][0] + l1 * P[1][0] + l2 * P[2][0]
                if zx <= zb[y * size + x]:
                    continue
                zb[y * size + x] = zx
                u = l0 * V[0][6] + l1 * V[1][6] + l2 * V[2][6]
                v = l0 * V[0][7] + l1 * V[1][7] + l2 * V[2][7]
                tx, ty = (int(min(max(u, 0.0), 1.0) * (tw - 1)), int(min(max(v, 0.0), 1.0) * (th - 1))) if texi == 1 else (int(u % 1.0 * (tw - 1)), int(v % 1.0 * (th - 1)))
                r, g, bl, _ = px[ty * tw + tx]
                nm = [l0 * V[0][3 + j] + l1 * V[1][3 + j] + l2 * V[2][3 + j] for j in range(3)]
                ln = math.sqrt(sum(q * q for q in nm)) or 1
                sh = 0.35 + 0.65 * max(0.0, sum(nm[j] / ln * light[j] for j in range(3)) / 1.0)
                o = (y * size + x) * 3
                img[o], img[o + 1], img[o + 2] = min(255, int(r * sh)), min(255, int(g * sh)), min(255, int(bl * sh))
    return img

if __name__ == "__main__":
    if len(sys.argv) < 5:
        sys.exit(__doc__)
    d, tex_path, out = sys.argv[1:4]
    head = tex_path.split("head_")[-1].split(".")[0]
    face = Face(d, "fe_" + head + ".anm")
    tex = [dds.load(tex_path), dds.load(d + "/eyes.dds")]
    specs = [(int(a.split(":")[0]), float(a.split(":")[1]) if ":" in a else 1.0) for a in sys.argv[4:]]
    size = 360
    base = face.pose(0, 0.0)
    xs = [p[1] for p in base]; zs = [p[2] for p in base]
    box = (-max(xs) - 0.01, -min(xs) + 0.01, min(zs) - 0.02, max(zs) + 0.02)
    cols = min(4, len(specs)); rows = (len(specs) + cols - 1) // cols
    W, H = cols * size, rows * size
    sheet = [0] * (W * H * 3)
    for k, (fr, it) in enumerate(specs):
        img = render(face, face.pose(fr, it), tex, size, box)
        ox, oy = (k % cols) * size, (k // cols) * size
        for y in range(size):
            s = (y * size) * 3
            dst = ((oy + y) * W + ox) * 3
            sheet[dst:dst + size * 3] = img[s:s + size * 3]
        print("panel", k, "frame", fr, "intensity", it)
    write_png(out, W, H, sheet)
    print("wrote", out, W, "x", H)
