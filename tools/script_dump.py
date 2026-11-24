#!/usr/bin/env python3
"""Decode the scripts (CProject -> CScript -> shots/parts/roles/writers) in a saved game.

    python3 tools/script_dump.py save.jad              # every project that has a script
    python3 tools/script_dump.py save.jad --project 1580   # one CProject by object id

See docs/SCRIPTS.md for what each object and field means (and which readings are unverified).
References between objects are lists of 12-byte entries: u32 object id, then two u32 type words
(for example `3aba0e00 b24175aa` for CPart); the list is `u32 count` + entries.
"""
import os, struct, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jad_dump as j


def u32(v):
    return struct.unpack("<I", v[:4])[0]


def f32(v):
    return struct.unpack("<f", v[:4])[0]


def pstr(v):
    """u32 byte-length + latin1 bytes (SourceName, SCENE, BackdropName ...)."""
    return v[4:4 + u32(v)].decode("latin1")


def wstr(v):
    """u32 byte-length (incl. the NUL) + UTF-16LE (Title, name)."""
    return v[4:4 + u32(v)].decode("utf-16le").rstrip("\0")


def refs(v):
    return [u32(v[4 + 12 * i:]) for i in range(u32(v))]


class Save:
    def __init__(self, path):
        self.p = j.parse(path)
        self.names = j.load_names()
        self.by_id = {o["id"]: o for o in self.p["objects"]}

    def d(self, o):
        """Field dict by name (first occurrence) for the fields whose name is known, else by tag hex."""
        out = {}
        for k, v in o["fields"]:
            out.setdefault(self.names.get(k, k), v)
        return out

    def all(self, k, name):
        return [v for t, v in k["fields"] if self.names.get(t, t) == name]

    def of(self, cls):
        return [o for o in self.p["objects"] if o["class"] == cls]


def show_project(s, proj):
    d = s.d(proj)
    print(f"CProject {proj['id']}  {wstr(d['Title'])!r}  genre {pstr(d['bc27c427'])}  "
          f"director={u32(d['PDirector'])}  PMovie={u32(d['PMovie'])}  StarRating={f32(d['StarRating']):.3f}")
    sc = s.by_id[u32(d["a34de9e2"])]  # the project's CScript
    sd = s.d(sc)
    print(f"  CScript {sc['id']}  source {pstr(sd['SourceName'])}  genre {pstr(sd['PGenre'])}  "
          f"Quality {f32(sd['Quality']):.4f}  second score {f32(sd['4b51dbd5']):.4f}")
    shot_ids = refs(sd["c9727001"])
    part_ids = refs(sd["e85c6201"])
    print(f"  script templates: {len(shot_ids)} ShotDesc, {len(part_ids)} PartDesc (script part ids "
          f"{[u32(s.d(s.by_id[i])['K6']) for i in part_ids]})")
    for i in shot_ids:
        o = s.by_id[i]
        x = s.d(o)
        sl = ", ".join(f"{v[4:4 + u32(v)].decode()}={f32(v[4 + u32(v):]):.2f}" for v in s.all(o, "9e4c3838"))
        pids = [u32(v) for v in s.all(o, "a85aeec9")]
        print(f"    ShotDesc {i}: scene {pstr(x['SCENE'])}, set {pstr(x['967d0e21'])}, {pstr(x['BACKDROP'])}, "
              f"{u32(x['e85c6201'])} part slots, script part ids {pids}; sliders {sl or '-'}")
    print("  roles (CCast of the project):")
    cast = s.by_id[u32(d["PCast"])]
    for r in s.all(cast, "6bf1cbd8"):
        ro = s.by_id[u32(r)]
        rd = s.d(ro)
        print(f"    CRole {ro['id']}: {wstr(rd['name'])!r}  actor={u32(rd['PActor'])}  "
              f"costume={u32(rd['PCostume'])}  ScriptPartID={struct.unpack('<i', rd['ScriptPartID'][:4])[0]}")
    for i in refs(d["c9727001"]):  # CShot list
        o = s.by_id[i]
        x = s.d(o)
        sl = ", ".join(f"{v[4:4 + u32(v)].decode()}={f32(v[4 + u32(v):]):.2f}" for v in s.all(o, "9e4c3838"))
        props = [pstr(v) for v in s.all(o, "d95111f1")]
        print(f"  CShot {i}: {pstr(x['e1f958a0'])}  set {pstr(x['27b75b2d'])}  length {f32(x['8131eec2']):.2f}s  "
              f"violence {f32(x['violence']):.2f} realism {f32(x['realism']):.2f}  filmed={u32(x['a9a63308']) != 0}")
        print(f"      sliders {sl or '-'}; props {props or '-'}")
        for pr in refs(s.all(o, "e85c6201")[0]):
            px = s.d(s.by_id[pr])
            print(f"      CPart {pr}: slot {u32(px['Index'])} required={px['Required'][0]} role={u32(px['PRole'])} "
                  f"costume={u32(px['PCostume'])} recommended={pstr(px['RecommendedCos'])}")
    writers = [o for o in s.of("CStaff") if "PCurrentScript" in s.d(o) and u32(s.d(o)["PCurrentScript"]) == proj["id"]]
    for o in writers:
        x = s.d(o)
        print(f"  writer CStaff {o['id']}: {wstr(x['name'])!r} in room {pstr(x['InRoomName'])} of building {u32(x['PInBuilding'])}")
    for o in s.p["objects"]:
        x = s.d(o)
        if "PProject" in x and u32(x["PProject"]) == proj["id"] and o["class"] not in ("CShot", "CScript"):
            print(f"  linked {o['class']} {o['id']}")


def main(argv):
    if not argv:
        sys.exit(__doc__)
    s = Save(argv[0])
    only = int(argv[argv.index("--project") + 1]) if "--project" in argv else None
    for proj in s.of("CProject"):
        if only is None or proj["id"] == only:
            show_project(s, proj)
            print()


if __name__ == "__main__":
    main(sys.argv[1:])
