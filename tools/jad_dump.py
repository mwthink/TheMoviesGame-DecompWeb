#!/usr/bin/env python3
"""Dump or diff The Movies saved games (*.jad).

    python3 tools/jad_dump.py save.jad                 # header, statics, per-class object summary
    python3 tools/jad_dump.py save.jad --class CFinance   # every field of the objects of one class
    python3 tools/jad_dump.py save.jad --lists            # the 24 global object registries from [STATICS]
    python3 tools/jad_dump.py save.jad --map [--svg out.svg]  # placed assets (SourcePath + POSITION + MyAngle), grid analysis, ASCII plan
    python3 tools/jad_dump.py save.jad --terrain out.png [--occupancy]  # ground paint + placed assets as a PNG (x right, y up)
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


def show_terrain(p, path, occupancy=False, scale=4):
    land = landscape(p)
    if not land:
        sys.exit("no TMLandscape data in this save")
    names, cells, occ = land
    print("textures:", ", ".join(f"{i}={n}" for i, n in enumerate(names)))
    def color(name):
        k = name.lower().replace("land_", "")
        return next((c for key, c in LAND_COLORS.items() if k.startswith(key[:5])), (255, 0, 255))
    palette = [color(n) for n in names]
    W = 256 * scale
    px = bytearray(W * W * 3)
    for gx in range(256):
        for gy in range(256):
            col = (255, 0, 255)
            for lay in cells[gx][gy]:        # layer 0 is the base; layers 1 and 2 paint over it
                if lay & 15 < len(palette):
                    col = palette[lay & 15]
            i = gx * 256 + gy
            if occupancy and occ[i >> 3] >> (i & 7) & 1:
                col = tuple(int(c * 0.4 + t * 0.6) for c, t in zip(col, (230, 40, 40)))
            for dy in range(scale):
                row = ((255 - gy) * scale + dy) * W + gx * scale
                px[row * 3:(row + scale) * 3] = bytes(col) * scale
    items = [a for a in placed_assets(p) if a[0] != "CLot"]
    for _c, _i, apath, (x, y, _z), _a in items:
        fac = apath.startswith("facility")
        r, col = (6, (220, 30, 30)) if fac else (3, (30, 30, 200))
        cx, cy = int((x + 256) / 2 * scale), int(W - (y + 256) / 2 * scale)
        for yy in range(max(0, cy - r), min(W, cy + r + 1)):
            for xx in range(max(0, cx - r), min(W, cx + r + 1)):
                px[(yy * W + xx) * 3:(yy * W + xx) * 3 + 3] = bytes(col)
    write_png(path, W, W, px)
    print(f"wrote {path} ({W}x{W}; {len(items)} assets; {sum(bin(b).count('1') for b in occ)} occupied cells)")


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
    if len(args) == 1:
        p = parse(args[0])
        if png:
            show_terrain(p, png, "--occupancy" in argv)
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
