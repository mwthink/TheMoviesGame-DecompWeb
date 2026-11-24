#!/usr/bin/env python3
"""Dump or diff The Movies saved games (*.jad).

    python3 tools/jad_dump.py save.jad                 # header, statics, per-class object summary
    python3 tools/jad_dump.py save.jad --class CFinance   # every field of the objects of one class
    python3 tools/jad_dump.py save.jad --lists            # the 24 global object registries from [STATICS]
    python3 tools/jad_dump.py save.jad --map [--svg out.svg]  # placed assets (SourcePath + POSITION + MyAngle), grid analysis, ASCII plan
    python3 tools/jad_dump.py save.jad --terrain out.png [--occupancy] [--footprints DIR] [--roofs TEXDIR [--outlines] [--markers] [--no-lightmaps] [--cutaway Z]] [--rooms [--labelscale N] [--no-numbers] [--strings stringdatabase.lhts[,addon.lhts]]] [--ppu N] [--ground LANDTEXDIR [--tile UNITS]] [--crop x0,y0,x1,y1]
                                                       # ground paint + assets as a PNG (x right, y up); DIR holds ini + msh files
    python3 tools/jad_dump.py a.jad b.jad              # field-level diff (statics + objects matched by id)

Container layout (observed from saves made under Wine; not yet checked against the loader code):

    8ab37c01 04000000 0a000000 0a   file prefix
    "[HEADER]\\n"  tag(4) cash(f32) 6 x u32 (look like real-world save time: hour 23, minute, 1, 23, 11, 2026)
                  then UTF-16 strings: state label, studio-less boss name or similar
    "[STATICS]\\n" u32 count? then "#X" + tag(4) + value, one per line (global values, keyed by a 4-byte hash)
    "[OBJECTS]\\n" u32 count, then repeated
        "[OBJ]\\n" u32 total_len, u32 name_len, RTTI name (".?AVCFoo@TM@@"), u32 object id, "\\n"
        "#X" + tag(4) + value ... "\\n"  (the fields)
        "[/OBJ]\\n"

Field values are raw bytes; this tool does not know their types, so it prints hex plus a few guesses (i32/f32).
Field tags are NOT unique inside an object (e.g. a repeated tag is an array element), so the diff pairs them by
(tag, occurrence index); objects are paired by (class, ordinal) because ids are renumbered per save.
"""
import re, struct, sys
from collections import Counter, defaultdict

import csv, glob, os, zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lhts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAMES_CSV = os.path.join(ROOT, "docs", "generated", "save_field_names.csv")


def tag_hash(name):
    """Saveable_BeginVariable's name hash (FUN_009f3c40): h = h*0x17 + (c & ~0x20), 32-bit, case-folding."""
    h = 0
    for c in name.encode("latin1", "replace"):
        h = (h * 0x17 + (c & ~0x20)) & 0xFFFFFFFF
    return h


def load_names():
    """tag(hex of the 4 stored bytes) -> field name. Built once from every string literal in the decompiled
    sources (data/ExportDecompiled) and cached in docs/generated/save_field_names.csv."""
    if not os.path.exists(NAMES_CSV):
        names = set()
        for f in glob.glob(os.path.join(ROOT, "data", "ExportDecompiled", "decomp_*.c")):
            names.update(re.findall(r'"([A-Za-z_][\w\[\]\(\)&\.\* ]{1,60})"', open(f, errors="replace").read()))
        os.makedirs(os.path.dirname(NAMES_CSV), exist_ok=True)
        with open(NAMES_CSV, "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["tag_hex", "name"])
            seen = {}
            for n in sorted(names):
                seen.setdefault(struct.pack("<I", tag_hash(n)).hex(), n)
            w.writerows(sorted(seen.items()))
    with open(NAMES_CSV, newline="") as fh:
        return {r[0]: r[1] for r in list(csv.reader(fh))[1:]}


NAMES = {}

PREFIX = bytes.fromhex("8ab37c0104000000 0a0000000a".replace(" ", ""))


def split_fields(blob):
    """'#X'-prefixed, newline-terminated records -> [(tag_hex, value_bytes)]."""
    out = []
    for rec in re.split(rb"\n?#X", blob)[1:]:
        rec = rec.rstrip(b"\n")
        out.append((rec[:4].hex(), rec[4:]))
    return out


def parse(path):
    d = open(path, "rb").read()
    if not d.startswith(PREFIX):
        sys.exit(f"{path}: unexpected file prefix {d[:13].hex()}")
    h0 = d.find(b"[HEADER]\n")
    s0 = d.find(b"[STATICS]\n")
    o0 = d.find(b"[OBJECTS]\n")
    if min(h0, s0, o0) < 0:
        sys.exit(f"{path}: missing [HEADER]/[STATICS]/[OBJECTS]")
    hb = d[h0 + 9:s0]
    header = {
        "tag": hb[:4].hex(),
        "cash": struct.unpack("<f", hb[4:8])[0],
        "u32s": struct.unpack("<6I", hb[8:32]),
        "strings": [m.group().decode("utf-16le")
                    for m in re.finditer(rb"(?:[\x20-\x7e]\x00){3,}", hb)],
    }
    statics = split_fields(d[s0 + 10:o0])
    objs = []
    for m in re.finditer(rb"\[OBJ\]\n(.*?)\n\[/OBJ\]", d[o0:], re.S):
        b = m.group(1)
        _total, nl = struct.unpack("<II", b[:8])
        name = b[8:8 + nl].decode("latin1")
        name = re.sub(r"^\.\?AV", "", name).replace("@TM@@", "").replace("@", ".")
        oid = struct.unpack("<I", b[8 + nl:12 + nl])[0]
        objs.append({"class": name, "id": oid, "fields": split_fields(b[12 + nl:])})
    return {"header": header, "statics": statics, "objects": objs}


def guess(v):
    g = []
    if len(v) >= 4:
        g.append("i32=%d" % struct.unpack("<i", v[:4])[0])
        f = struct.unpack("<f", v[:4])[0]
        if f == f and 1e-3 < abs(f) < 1e9:
            g.append("f32=%g" % f)
    if len(v) >= 6 and re.fullmatch(rb"(?:[\x20-\x7e]\x00)+\x00\x00", v[4:] if len(v) > 4 else b""):
        g.append("utf16=%r" % v[4:-2].decode("utf-16le"))
    return " ".join(g)


def show_header(p):
    h = p["header"]
    print(f"cash={h['cash']:.2f}  u32s={h['u32s']}  strings={h['strings']}")


def static_lists(p):
    """The [STATICS] section ends with 'static lists': registries of every live object of some kind, written WITHOUT a
    variable tag (SLVAR_LoadOrSaveStatics -> FUN_0097dff0): u32 count, then count x (u32 object id, u32, u32). Because they
    have no tag they sit glued to the end of the last tagged static var's value. Returns [[(id, a, b), ...], ...]."""
    blob = max((v for _, v in p["statics"]), key=len)
    pos, lists = 4, []          # the first 4 bytes are that last static var's own value (a pointer id)
    while pos + 4 <= len(blob):
        c = struct.unpack_from("<I", blob, pos)[0]
        pos += 4
        if pos + 12 * c > len(blob):
            break
        lists.append([struct.unpack_from("<3I", blob, pos + 12 * i) for i in range(c)])
        pos += 12 * c
    return lists


def show_lists(p):
    cls = {o["id"]: o["class"] for o in p["objects"]}
    for i, lst in enumerate(static_lists(p)):
        if lst:
            print(f"list {i:2d}: {len(lst):4d}  {dict(Counter(cls.get(e[0], '?') for e in lst))}")


def summary(p):
    show_header(p)
    print(f"statics: {len(p['statics'])} fields; objects: {len(p['objects'])}")
    for c, n in sorted(Counter(o["class"] for o in p["objects"]).items()):
        print(f"  {n:4d}  {c}")


def dump_class(p, cls):
    for o in p["objects"]:
        if o["class"] == cls:
            print(f"{o['class']} id={o['id']}")
            for t, v in o["fields"]:
                print(f"   {NAMES.get(t, t):<26} {trunc(v):<30} {guess(v)}")


def placed_assets(p):
    """Every object with a SourcePath and a POSITION: (class, id, asset path, (x, y, z), angle)."""
    t_src, t_pos, t_ang = (struct.pack("<I", tag_hash(n)).hex() for n in ("SourcePath", "POSITION", "MyAngle"))
    out = []
    for o in p["objects"]:
        f = {}
        for t, v in o["fields"]:
            f.setdefault(t, v)
        if t_src not in f or t_pos not in f or len(f[t_pos]) < 12:
            continue
        v = f[t_src]
        n = struct.unpack_from("<I", v)[0] if len(v) >= 4 else 0
        path = v[4:4 + n].split(b"\0")[0].decode("latin1") if 0 < n <= len(v) - 4 else "?"
        ang = struct.unpack("<f", f[t_ang][:4])[0] if len(f.get(t_ang, b"")) >= 4 else 0.0
        out.append((o["class"], o["id"], path, struct.unpack("<3f", f[t_pos][:12]), ang))
    return out


def grid_report(vals, label):
    """Fraction of coordinates that land on multiples of each candidate step."""
    print(f"  {label}: " + "  ".join(
        f"step {st:g}: {sum(abs(v / st - round(v / st)) < 1e-3 for v in vals)}/{len(vals)}"
        for st in (0.25, 0.5, 1, 2, 4, 5, 10)))


def show_map(p, svg=None):
    items = placed_assets(p)
    if not items:
        print("no placed assets")
        return
    print(f"{len(items)} placed assets")
    print(f"{'class':<22}{'asset':<36}{'x':>9}{'y':>9}{'z':>7}{'angle/pi':>10}")
    for c, _i, path, (x, y, z), a in sorted(items, key=lambda r: (r[0], r[2], r[3])):
        print(f"{c:<22}{path:<36}{x:9.3f}{y:9.3f}{z:7.2f}{a / 3.14159265:10.3f}")
    print("\ngrid check (coordinates on multiples of a step):")
    for grp, rows in (("all", items), ("COrnament", [r for r in items if r[0] == "COrnament"]),
                      ("facilities", [r for r in items if r[0] != "COrnament"])):
        if rows:
            print(f" {grp} ({len(rows)})")
            grid_report([r[3][0] for r in rows], "x")
            grid_report([r[3][1] for r in rows], "y")
    ang = Counter(round(r[4] / (3.14159265 / 2), 2) for r in items)
    print("angle in quarter-turns:", dict(sorted(ang.items())))
    # ASCII plan, 2 world units per column/row, y up. Letter = first letter of the asset's file name.
    xs, ys = [r[3][0] for r in items], [r[3][1] for r in items]
    x0, y0, cell = min(xs), min(ys), 2.0
    W, H = int((max(xs) - x0) / cell) + 1, int((max(ys) - y0) / cell) + 1
    grid = [["."] * W for _ in range(H)]
    legend = {}
    for _c, _i, path, (x, y, _z), _a in items:
        ch = os.path.basename(path).replace("p_", "").replace("facility_", "")[:1].upper() or "?"
        legend.setdefault(ch, set()).add(os.path.basename(path))
        grid[int((y - y0) / cell)][int((x - x0) / cell)] = ch
    print(f"\nplan (1 char = {cell:g} units, x from {x0:g}, y from {y0:g}, y up):")
    for row in reversed(grid):
        print("  " + "".join(row))
    print("legend:", "; ".join(f"{k}={','.join(sorted(v))}" for k, v in sorted(legend.items())))
    if svg:
        sc = 10
        e = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0 - 5} {-(max(ys) + 5)} {max(xs) - x0 + 10} {max(ys) - y0 + 10}">']
        for _c, _i, path, (x, y, _z), a in items:
            fac = path.startswith("facility")
            e.append(f'<circle cx="{x:.2f}" cy="{-y:.2f}" r="{2 if fac else 0.8}" fill="{"#c33" if fac else "#393"}"><title>{path} {x:.2f},{y:.2f}</title></circle>')
            e.append(f'<line x1="{x:.2f}" y1="{-y:.2f}" x2="{x + 1.5 * __import__("math").cos(a):.2f}" y2="{-(y + 1.5 * __import__("math").sin(a)):.2f}" stroke="#000" stroke-width="0.2"/>')
        e.append("</svg>")
        open(svg, "w").write("\n".join(e))
        print("wrote", svg)


# ---- terrain (TMLandscape) ---------------------------------------------------------------------------------------
# One opaque field, read by FUN_009e5540. Layout (after the field's own u32 byte length):
#   u32 version (2), u32 texture count (7), count x 32-byte NUL-padded names (Land_sand00 ...),
#   65793 cells x 3 bytes (= 256 x 257: index x*257 + y, the 257th column is a 0x3f edge sentinel),
#   8192-byte occupancy bitmap (bit x*256 + y of the 256x256 grid), then ~17 KB not decoded.
# Cell bytes (the loader masks them with 0x3f): three paint layers; low nibble = texture index (0xf = none),
# bits 4-5 = blend weight (value + 1) * 0.25. Grid cell = round((world + 256) / 2): 2 world units per cell.
LAND_COLORS = {"sand": (222, 200, 140), "grass": (100, 170, 70), "earth": (130, 90, 50),
               "tarma": (60, 60, 70), "sidew": (190, 190, 190)}


def landscape(p):
    """-> (texture names, cells[x][y] = (layer0, layer1, layer2) raw masked bytes, occupancy bytes) or None."""
    blobs = [v for o in p["objects"] if o["class"] == "TMLandscape" for _, v in o["fields"]]
    if not blobs or max(map(len, blobs)) < 245:
        return None
    v = max(blobs, key=len)
    ver, n = struct.unpack_from("<II", v, 4)
    names = [v[12 + 32 * i:44 + 32 * i].split(b"\0")[0].decode("latin1") for i in range(n)]
    d = v[12 + 32 * n:]
    cells = [[tuple(b & 0x3f for b in d[3 * (x * 257 + y):3 * (x * 257 + y) + 3]) for y in range(256)] for x in range(256)]
    return names, cells, d[3 * 65793:3 * 65793 + 8192]


def write_png(path, w, h, rgb):
    raw = b"".join(b"\0" + bytes(rgb[y * w * 3:(y + 1) * w * 3]) for y in range(h))
    def chunk(t, data):
        return struct.pack(">I", len(data)) + t + data + struct.pack(">I", zlib.crc32(t + data) & 0xffffffff)
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                           + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def load_footprints(d, items):
    """{SourcePath: parsed mesh} for assets whose `<stem>.ini*` (mesh = X.msh) and X.msh are in directory d (see docs/MSH_FORMAT.md)."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import msh_dump
    out = {}
    for path in {i[2] for i in items}:
        stem = os.path.basename(path)
        mesh = next((m.group(1) for f in sorted(glob.glob(os.path.join(d, stem + ".ini*")))
                     for m in [re.search(r"mesh\s*=\s*(\S+)", open(f, errors="replace").read())] if m), None)
        if mesh and os.path.exists(os.path.join(d, mesh)):
            out[path] = msh_dump.parse(open(os.path.join(d, mesh), "rb").read())
        else:
            print(f"  no mesh for {path} (looked for {stem}.ini* + its mesh in {d})")
    return out


def render_roofs(px, W, H, k, x0, y1, items, meshes, texdir, lightmaps=True, cutaway=None):
    """Top-down textured view of the placed models: every triangle of every mesh (rotated by MyAngle, moved to POSITION) is rasterized with a
    z-buffer, so the highest surface wins (roofs, tree canopies). Texture = the material's diffuse texture (tex index 0) decoded from texdir;
    alpha < 0.5 is skipped; reflection/environment/sky materials are skipped. With cutaway=Z, triangles whose vertices are all above Z are dropped, which removes roofs and upper walls and shows the interiors. With lightmaps (the material's texture slot 2, on the second UV set) the colour is diffuse x lightmap x 2."""
    import math
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import dds
    cache = {}

    def tex(name):
        if name not in cache:
            f = os.path.join(texdir, name.lower())
            cache[name] = dds.load(f) if os.path.exists(f) else None
        return cache[name]
    zbuf = [-1e9] * (W * H)
    skip = ("refl", "envmap", "gen_", "lm_")
    for _c, _i, apath, (x, y, _z), ang in items:
        m = meshes.get(apath)
        if not m:
            continue
        ca, sa = math.cos(ang), math.sin(ang)
        for node in m["nodes"]:
            for pr in node["prims"]:
                mat = m["materials"][pr["material"]] if pr["material"] < len(m["materials"]) else None
                ti = mat["tex"][0] if mat else 255
                name = m["textures"][ti] if ti < len(m["textures"]) else None
                t = tex(name) if name and not name.lower().startswith(skip) else None
                if not t:
                    continue
                tw, th, tpx = t
                lm = None
                li = mat["tex"][2] if mat else 255
                if lightmaps and li < len(m["textures"]) and m["textures"][li].lower().startswith("lm_") and pr["verts"] and len(pr["verts"][0]) > 8:
                    lm = tex(m["textures"][li])
                pv = [((x + v[0] * ca - v[1] * sa - x0) * k, (y1 - (y + v[0] * sa + v[1] * ca)) * k, v[2], v[6], v[7]) + tuple(v[8:10]) for v in pr["verts"]]
                for i0, i1, i2 in pr["tris"]:
                    a, b, c = pv[i0], pv[i1], pv[i2]
                    if cutaway is not None and min(a[2], b[2], c[2]) > cutaway:
                        continue
                    den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
                    if abs(den) < 1e-9:
                        continue
                    for yy in range(max(0, int(min(a[1], b[1], c[1]))), min(H - 1, int(max(a[1], b[1], c[1]))) + 1):
                        for xx in range(max(0, int(min(a[0], b[0], c[0]))), min(W - 1, int(max(a[0], b[0], c[0]))) + 1):
                            u = ((b[1] - c[1]) * (xx + .5 - c[0]) + (c[0] - b[0]) * (yy + .5 - c[1])) / den
                            v = ((c[1] - a[1]) * (xx + .5 - c[0]) + (a[0] - c[0]) * (yy + .5 - c[1])) / den
                            if u < 0 or v < 0 or u + v > 1:
                                continue
                            w_ = 1 - u - v
                            z = u * a[2] + v * b[2] + w_ * c[2]
                            if z <= zbuf[yy * W + xx]:
                                continue
                            tu = u * a[3] + v * b[3] + w_ * c[3]
                            tv = u * a[4] + v * b[4] + w_ * c[4]
                            r, g, bl, al = tpx[(int(tv * th) % th) * tw + int(tu * tw) % tw]
                            if al < 128:
                                continue
                            if lm:
                                lu = u * a[5] + v * b[5] + w_ * c[5]
                                lv = u * a[6] + v * b[6] + w_ * c[6]
                                lr, lg, lb, _la = lm[2][(int(lv * lm[1]) % lm[1]) * lm[0] + int(lu * lm[0]) % lm[0]]
                                r, g, bl = min(255, r * lr // 127), min(255, g * lg // 127), min(255, bl * lb // 127)
                            zbuf[yy * W + xx] = z
                            o = (yy * W + xx) * 3
                            px[o:o + 3] = bytes((r, g, bl))


DIGITS = {"0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111", "4": "101101111001001",
          "5": "111100111001111", "6": "111100111101111", "7": "111001001010010", "8": "111101111101111", "9": "111101111001111"}
ROOM_COLOURS = [(230, 25, 75), (60, 180, 75), (255, 225, 25), (0, 130, 200), (245, 130, 48), (145, 30, 180), (70, 240, 240),
                (240, 50, 230), (210, 245, 60), (250, 190, 212), (0, 128, 128), (170, 110, 40)]


FONT = {}
for _ch, _rows in {
    "A": "01110 10001 10001 11111 10001 10001 10001", "B": "11110 10001 10001 11110 10001 10001 11110",
    "C": "01110 10001 10000 10000 10000 10001 01110", "D": "11110 10001 10001 10001 10001 10001 11110",
    "E": "11111 10000 10000 11110 10000 10000 11111", "F": "11111 10000 10000 11110 10000 10000 10000",
    "G": "01110 10001 10000 10111 10001 10001 01111", "H": "10001 10001 10001 11111 10001 10001 10001",
    "I": "01110 00100 00100 00100 00100 00100 01110", "J": "00111 00010 00010 00010 00010 10010 01100",
    "K": "10001 10010 10100 11000 10100 10010 10001", "L": "10000 10000 10000 10000 10000 10000 11111",
    "M": "10001 11011 10101 10101 10001 10001 10001", "N": "10001 11001 10101 10011 10001 10001 10001",
    "O": "01110 10001 10001 10001 10001 10001 01110", "P": "11110 10001 10001 11110 10000 10000 10000",
    "Q": "01110 10001 10001 10001 10101 10010 01101", "R": "11110 10001 10001 11110 10100 10010 10001",
    "S": "01111 10000 10000 01110 00001 00001 11110", "T": "11111 00100 00100 00100 00100 00100 00100",
    "U": "10001 10001 10001 10001 10001 10001 01110", "V": "10001 10001 10001 10001 10001 01010 00100",
    "W": "10001 10001 10001 10101 10101 11011 10001", "X": "10001 10001 01010 00100 01010 10001 10001",
    "Y": "10001 10001 01010 00100 00100 00100 00100", "Z": "11111 00001 00010 00100 01000 10000 11111",
    "0": "01110 10001 10011 10101 11001 10001 01110", "1": "00100 01100 00100 00100 00100 00100 01110",
    "2": "01110 10001 00001 00010 00100 01000 11111", "3": "11110 00001 00001 01110 00001 00001 11110",
    "4": "00010 00110 01010 10010 11111 00010 00010", "5": "11111 10000 11110 00001 00001 10001 01110",
    "6": "00110 01000 10000 11110 10001 10001 01110", "7": "11111 00001 00010 00100 01000 01000 01000",
    "8": "01110 10001 10001 01110 10001 10001 01110", "9": "01110 10001 10001 01111 00001 00010 01100",
    "-": "00000 00000 00000 11111 00000 00000 00000", ".": "00000 00000 00000 00000 00000 01100 01100",
    ":": "00000 01100 01100 00000 01100 01100 00000", "(": "00010 00100 01000 01000 01000 00100 00010",
    ")": "01000 00100 00010 00010 00010 00100 01000", " ": "00000 00000 00000 00000 00000 00000 00000",
}.items():
    FONT[_ch] = _rows.split()


def draw_text(put, cx, cy, lines, scale):
    """Centered lines of text in a 5x7 bitmap font (A-Z, 0-9, - . : ( )), white with a black outline; (cx, cy) = centre of the block."""
    h = len(lines) * 8 * scale
    for li, line in enumerate(lines):
        w = len(line) * 6 * scale
        x0, y0 = int(cx - w / 2), int(cy - h / 2 + li * 8 * scale)
        for pass_, col in ((0, (0, 0, 0)), (1, (255, 255, 255))):
            for ci, ch in enumerate(line.upper()):
                for gy, row in enumerate(FONT.get(ch, FONT[" "])):
                    for gx, bit in enumerate(row):
                        if bit != "1":
                            continue
                        for dy in range(scale):
                            for dx in range(scale):
                                px_, py_ = x0 + (ci * 6 + gx) * scale + dx, y0 + gy * scale + dy
                                if pass_ == 0:
                                    for ox in (-1, 0, 1):
                                        for oy in (-1, 0, 1):
                                            put(px_ + ox, py_ + oy, col)
                                else:
                                    put(px_, py_, col)


def wrap_label(text, max_chars):
    words, lines, cur = text.split(), [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > max_chars:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    return lines + ([cur] if cur else [])


def room_objects(p):
    """{parent asset object id: [room dict]} from every object with a RoomName (TMRoom and its subclasses: CHireRoom, CFireRoom, CScriptRoom ...).
    RoomName is the mesh part name (`room_ss_actors`), PParentAsset the placed facility/set's object id (all 104 rooms of the Quick Start save resolve), MyIndex an order
    that is NOT the mesh part order, BIsEnabled 0 for hallways/windows/the whole-floor `room_` part, TheActivity the AI scene script run there. ObjectsIn was empty everywhere."""
    t = {n: struct.pack("<I", tag_hash(n)).hex() for n in ("RoomName", "PParentAsset", "MyIndex", "BIsEnabled", "HardObjectLimit", "TheActivity")}

    def string(v):
        return v[4:4 + struct.unpack_from("<I", v)[0]].split(b"\0")[0].decode("latin1") if len(v) > 4 else ""
    out = defaultdict(list)
    for o in p["objects"]:
        f = {}
        for tag, v in o["fields"]:
            f.setdefault(tag, v)
        if t["RoomName"] in f and t["PParentAsset"] in f:
            out[struct.unpack_from("<I", f[t["PParentAsset"]])[0]].append({
                "cls": o["class"], "id": o["id"], "name": string(f[t["RoomName"]]), "index": struct.unpack_from("<I", f[t["MyIndex"]])[0],
                "enabled": bool(f[t["BIsEnabled"]][0]) if t["BIsEnabled"] in f else None,
                "limit": struct.unpack_from("<I", f[t["HardObjectLimit"]])[0] if t["HardObjectLimit"] in f else 0,
                "activity": string(f[t["TheActivity"]]) if t["TheActivity"] in f else ""})
    return out


def match_rooms(rooms, parts):
    """[(room dict or None, part index)] for a mesh's parts: by name; if exactly one room and one part are left over (a set's generic `room_set`), pair them."""
    names = {r["name"]: r for r in rooms}
    pairs = [(names.get(n), i) for i, (n, _c) in enumerate(parts)]
    left_rooms = [r for r in rooms if r["name"] not in {n for n, _c in parts}]
    left_parts = [i for i, (r, _i) in enumerate(pairs) if r is None]
    if len(left_rooms) == 1 and len(left_parts) == 1:
        pairs[left_parts[0]] = (left_rooms[0], left_parts[0])
    return pairs


# What the game prints on the floor of these rooms (seen in game, stage school with the star-maker room in the middle); other rooms: not checked yet.
ROOM_LABELS = {"room_ss_extras": "Create Extra", "room_ss_actors": "Create Actor", "room_ss_directors": "Create Director",
               "room_ss_fire": "Reject", "room_ss_starmaker": "(striped star-maker pad)"}


def draw_rooms(put, tri, line, to_px, items, meshes, k, room_data=None, label_scale=1, numbers=True, strings=None):
    """Fill each named room floor polygon (mesh parts called room_*) in its own colour at the asset's placement and label it with a number; the unnamed
    `room_` part (the whole walkable floor) is skipped. Prints a legend: number = room name per mesh."""
    import math
    seen = set()
    for _c, _i, apath, (x, y, _z), ang in items:
        m = meshes.get(apath)
        if not m or not m["parts"]:
            continue
        ca, sa = math.cos(ang), math.sin(ang)
        place = lambda v: to_px(x + v[0] * ca - v[1] * sa, y + v[0] * sa + v[1] * ca)
        legend = []
        pairs = match_rooms((room_data or {}).get(_i, []), m["parts"])
        for n, (name, ch) in enumerate(m["parts"]):
            pts = [place(v) for v in ch["verts"]]
            room = pairs[n][0]
            if name == "room_":      # the whole walkable floor, already a union of the rooms: not drawn
                continue
            col = (150, 150, 150) if room and room["enabled"] is False else ROOM_COLOURS[len(legend) % len(ROOM_COLOURS)]
            legend.append((name, room))
            for t in ch["tris"]:
                tri(pts[t[0]], pts[t[1]], pts[t[2]], col, 0.55)
            if pts:
                cx = sum(q[0] for q in pts) / len(pts)
                cy = sum(q[1] for q in pts) / len(pts)
                width = max(q[0] for q in pts) - min(q[0] for q in pts)
                if strings is not None:       # the game's own floor text (tools/lhts.py); rooms without a key (halls, windows) show their part name
                    blocks = lhts.room_lines(strings, name) or ["(" + name[5:].replace("_", " ") + ")"]
                else:
                    label = ROOM_LABELS.get(name) or (name[5:] if name.startswith("room_") else name)
                    blocks = [label.replace("(", "").replace(")", "").replace("_", " ")]
                if numbers:
                    blocks = [f"{len(legend)} {blocks[0]}"] + blocks[1:]
                lines = [ln for b_ in blocks for ln in wrap_label(b_, max(4, int(width / (6 * label_scale))))]
                draw_text(put, cx, cy, lines, label_scale)
        if apath not in seen:
            seen.add(apath)
            print(f"  rooms in {apath}:")
            for i, (n, r) in enumerate(legend):
                info = f"{r['cls']}, {'enabled' if r['enabled'] else 'disabled'}" + (f", limit {r['limit']}" if r["limit"] else "") + (f", runs {r['activity']}" if r["activity"] else "") if r else "no room object"
                text = " / ".join(lhts.room_lines(strings, n)) if strings is not None else ""
                print(f"    {i + 1} = {n}" + (f'  "{text}"' if text else "") + (f' ("{ROOM_LABELS[n]}" seen in game)' if n in ROOM_LABELS else "") + f"  [{info}]")


def show_terrain(p, path, occupancy=False, footprints=None, crop=None, ppu=None, roofs=None, outlines=True, markers=True, ground=None, tile=12.0, lightmaps=True, cutaway=None, rooms=False, label_scale=1, numbers=True, strings=None):
    """Top-down PNG: ground paint (cell g = round((world + 256) / 2), centred on even world coordinates), optionally the occupancy bits,
    the placed assets (red = facility, blue = ornament) and, with a directory of ini + msh files, each asset's mesh polygons rotated by
    MyAngle and moved to POSITION: b15_02 footprint = orange fill, b16_01 = yellow outline, facility room floors = cyan outline."""
    land = landscape(p)
    if not land:
        sys.exit("no TMLandscape data in this save")
    names, cells, occ = land
    print("textures:", ", ".join(f"{i}={n}" for i, n in enumerate(names)))

    def color(name):
        k = name.lower().replace("land_", "")
        return next((c for key, c in LAND_COLORS.items() if k.startswith(key[:5])), (255, 0, 255))
    palette = [color(n) for n in names]
    import math
    x0, y0, x1, y1 = crop or (-256, -256, 256, 256)
    k = ppu or (2 if crop is None else max(2, min(16, int(1000 / max(x1 - x0, y1 - y0)))))
    W, H = int((x1 - x0) * k), int((y1 - y0) * k)
    px = bytearray(W * H * 3)

    def put(x, y, col, a=1.0):
        if 0 <= x < W and 0 <= y < H:
            o = (y * W + x) * 3
            px[o:o + 3] = bytes(int(px[o + j] * (1 - a) + col[j] * a) for j in range(3))
    gtex = {}
    if ground:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import dds
        for i, n in enumerate(names):
            f = os.path.join(ground, n.lower() + ".dds")
            if os.path.exists(f):
                gtex[i] = dds.load(f)

    def vertex_colour(gx, gy, samples):
        """Composite one terrain vertex: layer 0 opaque, layers 1/2 painted over with alpha (bits 4-5 + 1) * 0.25."""
        if not (0 <= gx < 256 and 0 <= gy < 256):
            return (255, 0, 255)
        col = None
        for n, lay in enumerate(cells[gx][gy]):
            t = lay & 15
            if t not in samples:
                continue
            c, a = samples[t], ((lay >> 4 & 3) + 1) * 0.25 if n else 1.0
            col = c if col is None else tuple(col[j] * (1 - a) + c[j] * a for j in range(3))
        return col or (255, 0, 255)
    for yy in range(H):
        wy = y1 - (yy + 0.5) / k
        gy = round((wy + 256) / 2)
        for xx in range(W):
            if gtex:
                wx = x0 + (xx + 0.5) / k
                fx, fy = (wx + 256) / 2, (wy + 256) / 2
                ix, iy = math.floor(fx), math.floor(fy)
                tx, ty = fx - ix, fy - iy
                samples = {}
                for i, (tw, th, tpx) in gtex.items():
                    samples[i] = tpx[(int(wy / tile * th) % th) * tw + int(wx / tile * tw) % tw][:3]
                c00, c10 = vertex_colour(ix, iy, samples), vertex_colour(ix + 1, iy, samples)
                c01, c11 = vertex_colour(ix, iy + 1, samples), vertex_colour(ix + 1, iy + 1, samples)
                col = tuple(int((c00[j] * (1 - tx) + c10[j] * tx) * (1 - ty) + (c01[j] * (1 - tx) + c11[j] * tx) * ty) for j in range(3))
                gx = round(fx)
                if occupancy and 0 <= gx < 256 and 0 <= gy < 256 and occ[(gx * 256 + gy) >> 3] >> ((gx * 256 + gy) & 7) & 1:
                    col = tuple(int(c * 0.4 + t * 0.6) for c, t in zip(col, (230, 40, 40)))
                o = (yy * W + xx) * 3
                px[o:o + 3] = bytes(col)
                continue
            gx = round((x0 + (xx + 0.5) / k + 256) / 2)
            col = (255, 0, 255)
            if 0 <= gx < 256 and 0 <= gy < 256:
                for lay in cells[gx][gy]:        # layer 0 is the base; layers 1 and 2 paint over it
                    if lay & 15 < len(palette):
                        col = palette[lay & 15]
                i = gx * 256 + gy
                if occupancy and occ[i >> 3] >> (i & 7) & 1:
                    col = tuple(int(c * 0.4 + t * 0.6) for c, t in zip(col, (230, 40, 40)))
            o = (yy * W + xx) * 3
            px[o:o + 3] = bytes(col)
    items = [a for a in placed_assets(p) if a[0] != "CLot"]
    meshes = load_footprints(footprints, items) if footprints else {}

    def to_px(wx, wy):
        return (wx - x0) * k, (y1 - wy) * k

    def line(a, b, col):
        n = int(max(abs(b[0] - a[0]), abs(b[1] - a[1]))) + 1
        for t in range(n + 1):
            put(int(a[0] + (b[0] - a[0]) * t / n), int(a[1] + (b[1] - a[1]) * t / n), col)

    def tri(a, b, c, col, alpha):
        lo_x, hi_x = int(min(a[0], b[0], c[0])), int(max(a[0], b[0], c[0]))
        lo_y, hi_y = int(min(a[1], b[1], c[1])), int(max(a[1], b[1], c[1]))
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-9:
            return
        for yy in range(lo_y, hi_y + 1):
            for xx in range(lo_x, hi_x + 1):
                u = ((b[1] - c[1]) * (xx + .5 - c[0]) + (c[0] - b[0]) * (yy + .5 - c[1])) / den
                v = ((c[1] - a[1]) * (xx + .5 - c[0]) + (a[0] - c[0]) * (yy + .5 - c[1])) / den
                if u >= 0 and v >= 0 and u + v <= 1:
                    put(xx, yy, col, alpha)
    import math
    if roofs and meshes:
        render_roofs(px, W, H, k, x0, y1, items, meshes, roofs, lightmaps, cutaway)
    if rooms:
        draw_rooms(put, tri, line, to_px, items, meshes, k, room_objects(p), label_scale, numbers, strings)
    for _c, _i, apath, (x, y, _z), ang in items:
        m = meshes.get(apath)
        if m and outlines:
            ca, sa = math.cos(ang), math.sin(ang)
            place = lambda v: to_px(x + v[0] * ca - v[1] * sa, y + v[0] * sa + v[1] * ca)
            for name, col, fill in (("b16_01", (255, 230, 0), False), ("b15_02", (255, 140, 0), True)):
                ch = m["chunks"].get(name)
                if not ch:
                    continue
                pts = [place(v) for v in ch["verts"]]
                for t in ch["tris"]:
                    if fill:
                        tri(pts[t[0]], pts[t[1]], pts[t[2]], col, 0.55)
                    else:
                        for e in ((0, 1), (1, 2), (2, 0)):
                            line(pts[t[e[0]]], pts[t[e[1]]], col)
            for _n, ch in m["parts"]:
                pts = [place(v) for v in ch["verts"]]
                for t in ch["tris"]:
                    for e in ((0, 1), (1, 2), (2, 0)):
                        line(pts[t[e[0]]], pts[t[e[1]]], (0, 220, 220))
    for _c, _i, apath, (x, y, _z), _a in (items if markers else []):
        fac = apath.startswith("facility")
        r, col = (max(2, k), (220, 30, 30)) if fac else (max(1, k // 2), (30, 30, 200))
        cx, cy = to_px(x, y)
        for yy in range(int(cy) - r, int(cy) + r + 1):
            for xx in range(int(cx) - r, int(cx) + r + 1):
                put(xx, yy, col)
    # world grid ticks every 10 units along the borders for orientation
    for wx in range(int(x0 // 10 * 10), int(x1) + 1, 10):
        for t in range(6):
            put(int((wx - x0) * k), t, (0, 0, 0))
    for wy in range(int(y0 // 10 * 10), int(y1) + 1, 10):
        for t in range(6):
            put(t, int((y1 - wy) * k), (0, 0, 0))
    write_png(path, W, H, px)
    print(f"wrote {path} ({W}x{H}, {k} px per world unit; {len(items)} assets, {len(meshes)} meshes drawn)")


def keyed(fields):
    seen = defaultdict(int)
    out = {}
    for t, v in fields:
        out[(t, seen[t])] = v
        seen[t] += 1
    return out


def trunc(v, n=24):
    return v.hex() if len(v) <= n else v[:n].hex() + f"...(+{len(v) - n}B)"


def diff_fields(label, fa, fb):
    ka, kb = keyed(fa), keyed(fb)
    for k in sorted(set(ka) | set(kb)):
        va, vb = ka.get(k), kb.get(k)
        if va != vb:
            ta = "-" if va is None else f"{trunc(va)} ({guess(va)})"
            tb = "-" if vb is None else f"{trunc(vb)} ({guess(vb)})"
            print(f"  {label} {NAMES.get(k[0], k[0])}[{k[1]}]: {ta}  ->  {tb}")


def diff(a, b):
    print("header A:", end=" "); show_header(a)
    print("header B:", end=" "); show_header(b)
    print("== statics")
    diff_fields("static", a["statics"], b["statics"])
    # Object ids are renumbered per save (they shift when objects are added), so pair by (class, nth of that class).
    def index(p):
        n, out = Counter(), {}
        for o in p["objects"]:
            out[(o["class"], n[o["class"]])] = o
            n[o["class"]] += 1
        return out
    ia, ib = index(a), index(b)
    print("== class count changes (A -> B):")
    ca, cb = Counter(k[0] for k in ia), Counter(k[0] for k in ib)
    for c in sorted(set(ca) | set(cb)):
        if ca[c] != cb[c]:
            print(f"  {c}: {ca[c]} -> {cb[c]}")
    print("== changed objects (paired by class + ordinal; ids differ between saves)")
    for k in sorted(ia.keys() & ib.keys()):
        if ia[k]["fields"] != ib[k]["fields"]:
            print(f"{k[0]}#{k[1]} (id {ia[k]['id']} -> {ib[k]['id']})")
            diff_fields("", ia[k]["fields"], ib[k]["fields"])


def main(argv):
    NAMES.update(load_names())
    args = [a for a in argv if not a.startswith("--")]
    cls = argv[argv.index("--class") + 1] if "--class" in argv else None
    if cls:
        args.remove(cls)
    svg = argv[argv.index("--svg") + 1] if "--svg" in argv else None
    if svg:
        args.remove(svg)
    png = argv[argv.index("--terrain") + 1] if "--terrain" in argv else None
    if png:
        args.remove(png)
    fp = argv[argv.index("--footprints") + 1] if "--footprints" in argv else None
    if fp:
        args.remove(fp)
    crop = argv[argv.index("--crop") + 1] if "--crop" in argv else None
    if crop:
        args.remove(crop)
    roofs = argv[argv.index("--roofs") + 1] if "--roofs" in argv else None
    if roofs:
        args.remove(roofs)
    ground = argv[argv.index("--ground") + 1] if "--ground" in argv else None
    if ground:
        args.remove(ground)
    cut = argv[argv.index("--cutaway") + 1] if "--cutaway" in argv else None
    if cut:
        args.remove(cut)
    strfile = argv[argv.index("--strings") + 1] if "--strings" in argv else None
    if strfile:
        args.remove(strfile)
    lscale = argv[argv.index("--labelscale") + 1] if "--labelscale" in argv else None
    if lscale:
        args.remove(lscale)
    ppu_arg = argv[argv.index("--ppu") + 1] if "--ppu" in argv else None
    if ppu_arg:
        args.remove(ppu_arg)
    tile = argv[argv.index("--tile") + 1] if "--tile" in argv else "12"
    if "--tile" in argv:
        args.remove(tile)
    if len(args) == 1:
        p = parse(args[0])
        if png:
            show_terrain(p, png, "--occupancy" in argv, fp, tuple(float(v) for v in crop.split(",")) if crop else None,
                         roofs=roofs, outlines=not roofs or "--outlines" in argv, markers=not roofs or "--markers" in argv,
                         ground=ground, tile=float(tile), lightmaps="--no-lightmaps" not in argv,
                         cutaway=float(cut) if cut else None, rooms="--rooms" in argv, ppu=int(ppu_arg) if ppu_arg else None,
                         label_scale=int(lscale) if lscale else 1, numbers="--no-numbers" not in argv,
                         strings=lhts.load(*strfile.split(",")) if strfile else None)
        elif "--map" in argv:
            show_map(p, svg)
        elif "--lists" in argv:
            show_lists(p)
        else:
            dump_class(p, cls) if cls else summary(p)
    elif len(args) == 2:
        diff(parse(args[0]), parse(args[1]))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except BrokenPipeError:
        pass
