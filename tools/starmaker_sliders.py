#!/usr/bin/env python3
"""Reproduce the StarMaker advanced face sliders (docs/STARMAKER.md section 7) from the game's own data and check them against a saved star.hd.

    python3 tools/starmaker_sliders.py <sm_assets dir with mannequin_sm.anm, sm_generic.msh> <starmaker.ini> <Baseline star.hd> <test star.hd> <info.sm of the test>

Model: the head (sm_generic.msh, 996 vertices, 108 face bones) is skinned with 4 weights per vertex to the pose of mannequin_sm.anm at frame
(a + 1.99 * value), a = the first number of the slider's starmaker.ini line (NOT 1 + 3 * index: the ini has gaps), for each slider in starmaker.ini order, applied one after another; frame 0 is the base pose.
"""
import math
import struct
import sys

sys.path.insert(0, __import__("os").path.dirname(__file__))
import anm_dump as A
import msh_dump as M

def mat_mul(a, b):              # 4x3 row-vector matrices: (rows r0,r1,r2, t); returns a*b (apply a first, then b)
    ra, ta = a
    rb, tb = b
    r = [[sum(ra[i][k] * rb[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
    t = [sum(ta[k] * rb[k][j] for k in range(3)) + tb[j] for j in range(3)]
    return (r, t)

def mat_inv(m):                 # inverse of a rigid (rotation + translation) row-vector matrix
    r, t = m
    rt = [[r[j][i] for j in range(3)] for i in range(3)]
    return (rt, [-sum(t[k] * rt[k][j] for k in range(3)) for j in range(3)])

def xform(p, m):
    r, t = m
    return [sum(p[k] * r[k][j] for k in range(3)) + t[j] for j in range(3)]

class Rig:
    def __init__(self, d):
        self.anm = A.parse(open(d + "/mannequin_sm.anm", "rb").read())
        self.msh = M.parse(open(d + "/sm_generic.msh", "rb").read())
        self.bones = self.msh["bones"]
        self.parents = self.anm["parents"]
        self.bind = [(b["rot"], list(b["pos"])) for b in self.bones]
        self.inv_bind = [mat_inv(b) for b in self.bind]
        self.verts, self.skin = [], []
        for p in self.msh["nodes"][0]["prims"]:
            self.verts += [v[:3] for v in p["verts"]]
            self.skin += p["skin"]

    def local(self, frame):     # linear interpolation of (rotation, translation) between two integer frames
        f0 = int(math.floor(frame)); f1 = min(f0 + 1, self.anm["n_frames"] - 1); u = frame - f0
        out = []
        for c in range(self.anm["n_channels"]):
            (r0, t0), (r1, t1) = self.anm["frames"][f0][c], self.anm["frames"][f1][c]
            out.append(([[r0[i][j] * (1 - u) + r1[i][j] * u for j in range(3)] for i in range(3)], [t0[k] * (1 - u) + t1[k] * u for k in range(3)]))
        return out

    def skin_matrices(self, frame):
        loc = self.local(frame)
        world = [None] * len(loc)
        for i in range(len(loc)):
            p = self.parents[i]
            world[i] = loc[i] if p < 0 else mat_mul(loc[i], world[p])      # parents come before their children
        return [mat_mul(self.inv_bind[i], world[i]) for i in range(len(loc))]

    def apply(self, positions, frame):
        S = self.skin_matrices(frame)
        out = []
        for p, (w, idx) in zip(positions, self.skin):
            acc = [0.0, 0.0, 0.0]
            for wk, bk in zip(w, idx):
                if wk:
                    q = xform(p, S[bk])
                    acc = [acc[j] + wk * q[j] for j in range(3)]
            out.append(acc)
        return out

def read_ini(path):
    import re
    out = []
    for line in open(path, encoding="latin1").read().splitlines():
        f = re.findall(r"\[([^\]]*)\]", line)
        if len(f) >= 4:
            out.append((f[0], f[1], int(f[2]), int(f[3])))
    return out

def read_hd_a(path):
    b = open(path, "rb").read()
    f = struct.unpack_from("<%df" % (996 * 6), b, 0x94)
    return [f[i * 6:i * 6 + 3] for i in range(996)]

if __name__ == "__main__":
    if len(sys.argv) < 6:
        sys.exit(__doc__)
    rig = Rig(sys.argv[1])
    ini = read_ini(sys.argv[2])
    base, test = read_hd_a(sys.argv[3]), read_hd_a(sys.argv[4])
    info = open(sys.argv[5], "rb").read()
    sl = struct.unpack_from("<43f", info, 0xd0)
    pos = [list(v) for v in base]
    for i, v in enumerate(sl):
        if abs(v - 0.5) > 1e-6:
            a = ini[i][2]
            neutral = rig.apply(pos, a + 0.995)
            moved = rig.apply(pos, a + 1.99 * v)
            pos = [[p[j] + moved[k][j] - neutral[k][j] for j in range(3)] for k, p in enumerate(pos)]
            print("slider", i, ini[i][1], "value", round(v, 3), "frames", a + 0.995, "->", round(a + 1.99 * v, 3))
    obs = [[test[i][j] - base[i][j] for j in range(3)] for i in range(996)]
    pred = [[pos[i][j] - base[i][j] for j in range(3)] for i in range(996)]
    n = lambda v: math.sqrt(sum(x * x for x in v))
    num = sum(sum(a * b for a, b in zip(o, p)) for o, p in zip(obs, pred))
    den = sum(n(p) ** 2 for p in pred)
    scale = num / den if den else 0
    err = [n([a - b for a, b in zip(o, p)]) for o, p in zip(obs, pred)]
    print("observed: moved vertices %d, max %.5f, sum |d| %.4f" % (sum(1 for o in obs if n(o) > 1e-5), max(n(o) for o in obs), sum(n(o) for o in obs)))
    print("predicted: moved vertices %d, max %.5f, sum |d| %.4f" % (sum(1 for p in pred if n(p) > 1e-5), max(n(p) for p in pred), sum(n(p) for p in pred)))
    print("best scale pred->obs %.3f; rms error %.5f (rms observed %.5f); max error %.5f" % (scale, math.sqrt(sum(e * e for e in err) / 996), math.sqrt(sum(n(o) ** 2 for o in obs) / 996), max(err)))
