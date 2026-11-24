#!/usr/bin/env python3
"""List the people of a saved game with what is needed to draw them: head, costume (.cos), hair, makeup.

    python3 tools/save_cast.py "<save>.jad"                 # one line per CStar / CWannabe
    python3 tools/save_cast.py "<save>.jad" --json out.json

From a CStar / CWannabe: `Head[0]` (a .hd file name, e.g. head_f_japanese_girl.hd; `Head[1]` + `HeadMix` blend a second head), `PCurrentCostume` and `PNormalCostume`
(object ids of CCostume objects), `name` (UTF-16 string, when present). A CCostume object has no tagged variables: its body is a raw blob that holds the costume name
(`f_cheerleader_1`), its .cos file (`f_cheerleader_1.cos`, see tools/cos_dump.py), makeup textures (`mup_eyes_v00.dds`, `mup_feyebrow_v00.dds`) and the hair mesh
(`hair_20s_f12.msh`) as length-prefixed or NUL-padded strings. The blob is read here by finding those strings, not by a decoded layout.
"""
import json
import os
import re
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jad_dump


def pstr(v):
    """A u32 length + ASCII string, or None."""
    if len(v) >= 4:
        n = struct.unpack_from("<I", v, 0)[0]
        if 0 < n < 128 and len(v) >= 4 + n and all(32 <= c < 127 for c in v[4:4 + n]):
            return v[4:4 + n].decode("latin1")
    return None


def utf16(v):
    if len(v) >= 4:
        n = struct.unpack_from("<I", v, 0)[0]
        if 0 < n < 128 and len(v) >= 4 + 2 * n:
            try:
                return v[4:4 + 2 * n].decode("utf-16le").rstrip("\0")
            except UnicodeDecodeError:
                pass
    return None


def raw_objects(path):
    """Yield (class, id, body bytes) for every object, the body being everything after the id (tagged fields or a blob)."""
    d = open(path, "rb").read()
    o0 = d.find(b"[OBJECTS]\n")
    for m in re.finditer(rb"\[OBJ\]\n(.*?)\n\[/OBJ\]", d[o0:], re.S):
        b = m.group(1)
        _total, nl = struct.unpack("<II", b[:8])
        cls = re.sub(r"^\.\?AV", "", b[8:8 + nl].decode("latin1")).replace("@TM@@", "").replace("@", ".")
        yield cls, struct.unpack("<I", b[8 + nl:12 + nl])[0], b[12 + nl:]


def costume_blob(body):
    strs = [s.decode("latin1") for s in re.findall(rb"[\x20-\x7e]{4,}", body)]
    out = {"strings": strs, "name": strs[0] if strs else None}
    for s in strs:
        low = s.lower()
        if low.endswith(".cos"):
            out["cos"] = s
        elif low.endswith(".msh") and "hair" in low:
            out["hair"] = s
        elif low.endswith(".msh"):
            out.setdefault("meshes", []).append(s)
        elif low.endswith(".dds"):
            out.setdefault("textures", []).append(s)
    return out


def cast(path):
    names = jad_dump.load_names()
    p = jad_dump.parse(path)
    costumes = {cid: costume_blob(body) for cls, cid, body in raw_objects(path) if cls == "CCostume"}
    people = []
    for o in p["objects"]:
        if o["class"] not in ("CStar", "CWannabe"):
            continue
        f = {}
        for t, v in o["fields"]:
            f.setdefault(names.get(t, t), v)

        def ref(k):
            return struct.unpack_from("<I", f[k], 0)[0] if k in f and len(f[k]) >= 4 else 0
        cur = costumes.get(ref("PCurrentCostume"), {})
        people.append({"class": o["class"], "id": o["id"], "name": utf16(f["name"]) if "name" in f else None,
                       "head": pstr(f["Head[0]"]) if "Head[0]" in f else None, "head2": pstr(f["Head[1]"]) if "Head[1]" in f else None,
                       "headMix": struct.unpack_from("<f", f["HeadMix"], 0)[0] if "HeadMix" in f and len(f["HeadMix"]) >= 4 else None,
                       "costumeId": ref("PCurrentCostume"), "costume": cur.get("name"), "cos": cur.get("cos"), "hair": cur.get("hair"),
                       "makeup": [t for t in cur.get("textures", []) if t.lower().startswith("mup_")]})
    return people


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    people = cast(sys.argv[1])
    if "--json" in sys.argv:
        json.dump(people, open(sys.argv[sys.argv.index("--json") + 1], "w"), indent=1)
    for q in people:
        print("%-8s %5d %-22s head %-28s cos %-26s hair %-20s %s" % (q["class"], q["id"], q["name"] or "-", q["head"], q["cos"], q["hair"], ",".join(q["makeup"])))
    print(len(people), "people,", sum(1 for q in people if q["cos"]), "with a costume .cos,", sum(1 for q in people if q["head"]), "with a head")
