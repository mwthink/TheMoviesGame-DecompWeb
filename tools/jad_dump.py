#!/usr/bin/env python3
"""Dump or diff The Movies saved games (*.jad).

    python3 tools/jad_dump.py save.jad                 # header, statics, per-class object summary
    python3 tools/jad_dump.py save.jad --class CFinance   # every field of the objects of one class
    python3 tools/jad_dump.py save.jad --lists            # the 24 global object registries from [STATICS]
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

import csv, glob, os

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
    if len(args) == 1:
        p = parse(args[0])
        if "--lists" in argv:
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
