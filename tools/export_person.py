#!/usr/bin/env python3
"""Build a character for the viewer straight from the game files: a person of a saved game, or a costume by name.

    python3 tools/export_person.py "<game>/Data/pak" --save "<save>.jad" --list
    python3 tools/export_person.py "<game>/Data/pak" --save "<save>.jad" --person 1245 [--anims walk,walk_casual] [--out viewer/data]
    python3 tools/export_person.py "<game>/Data/pak" --cos f_cheerleader_1 [--head head_f_japanese_girl.hd] [--hair hair_20s_f12.msh]

A person comes from tools/save_cast.py (head .hd, costume .cos, hair mesh). The costume file (tools/cos_dump.py) names the body mesh; the head is generic_head.msh with
the texture named inside the .hd file (its first string, at 0x0c); the hair is its own mesh. All of them share the 30-bone skeleton (docs/ANM_FORMAT.md).
The head shape is the .hd morph (tools/hd_dump.py): the person's age and weight (from the save, or --age / --weight) and Head[1] + HeadMix when the save has a second head.
A person without a stored head gets the game's defaults (head_f_white_jane.hd / head_m_white_joe.hd, from the loader code).
Not done: makeup, hair/skin tint, accessories (hats, glasses, rings), the costume's texture layers. The body's own texture atlas is used as it is.

Files are found in the archives by name. Textures are searched in the directories data\\textures\\ first, then costumes, hair, makeup, people, sm, ui and the others; the
thumbs\\ directories (small UI icons with the same names) last. Files read from the paks are cached under --cache (default data/game_data/people/<dir>/<name>).
"""
import argparse
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cos_dump
import export_character
import hd_dump
import msh_dump
import pak_extract
import save_cast

TEX_ORDER = ["data\\textures\\", "data\\textures\\costumes\\", "data\\textures\\hair\\", "data\\textures\\makeup\\", "data\\textures\\people\\",
             "data\\textures\\sm\\", "data\\textures\\ui\\"]
DEFAULT_ANIMS = ["walk", "walk_casual", "walk_casual_stroll", "walk_angry", "walk_zombie", "walk_bounce_strut", "walk_action_tough"]


class Paks:
    def __init__(self, pakdir, cache):
        self.cache = cache
        self.index = {}          # lower name -> {dir: (pak, entry)}, later (newer) archives win for the same directory
        for p in pak_extract.paks(pakdir):
            for e in pak_extract.read_entries(p):
                self.index.setdefault(e[0].lower(), {})[e[5].lower()] = (p, e)

    def find(self, name, order=None):
        """Path of the cached file for `name`, extracted on first use; None if no archive has it."""
        cands = self.index.get(name.lower())
        if not cands:
            return None
        order = [d.lower() for d in (order or [])]
        pick = None
        for d in order:
            if d in cands:
                pick = d
                break
        if pick is None:
            others = sorted(cands, key=lambda d: ("thumbs" in d, d))   # icons last
            pick = others[0]
        p, e = cands[pick]
        out = os.path.join(self.cache, pick.replace("\\", os.sep), e[0])
        if not os.path.exists(out):
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(out, "wb") as f:
                f.write(pak_extract.read_file(p, e))
        return out

    def texture(self, name):
        return self.find(name, TEX_ORDER)


def hd_texture(path):
    d = open(path, "rb").read()
    return d[0x0C:0x2C].split(b"\0")[0].decode("latin1")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pakdir")
    ap.add_argument("--save")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--person", type=int)
    ap.add_argument("--cos")
    ap.add_argument("--head")
    ap.add_argument("--hair")
    ap.add_argument("--age", type=float, help="age in years for the head morph (default: from the save, else 25)")
    ap.add_argument("--weight", type=float, help="weight in kg for the head morph (default: from the save, else 70)")
    ap.add_argument("--no-morph", action="store_true", help="use generic_head.msh unchanged")
    ap.add_argument("--anims", default=",".join(DEFAULT_ANIMS))
    ap.add_argument("--out", default="viewer/data")
    ap.add_argument("--cache", default="data/game_data/people")
    a = ap.parse_args()
    if a.list:
        for q in save_cast.cast(a.save):
            if q["cos"]:
                print("%5d %-9s head %-28s cos %-24s hair %s" % (q["id"], q["class"], q["head"], q["cos"], q["hair"]))
        return
    cos, head, hair, who = a.cos, a.head, a.hair, a.cos
    head2, mix, age, weight = None, 0.0, a.age, a.weight
    if a.person is not None:
        q = next((q for q in save_cast.cast(a.save) if q["id"] == a.person), None)
        if not q or not q["cos"]:
            sys.exit("person %s not found, or the save stores no costume for them" % a.person)
        cos, head, hair, who = q["cos"], head or q["head"], hair or q["hair"], "%s %d" % (q["class"], q["id"])
        head2, mix = q["head2"], q["headMix"] or 0.0
        age = age if age is not None else q["age"]
        weight = weight if weight is not None else q["weight"]
    if not cos:
        sys.exit("give --person (with --save) or --cos")
    paks = Paks(a.pakdir, a.cache)
    cos = cos if cos.lower().endswith(".cos") else cos + ".cos"
    cpath = paks.find(cos)
    if not cpath:
        sys.exit("costume %s not found in the archives" % cos)
    c = cos_dump.parse(open(cpath, "rb").read())
    meshes = [paks.find(c["body"])]
    gh = paks.find("generic_head.msh")
    meshes.append(gh)
    remap, parsed = {}, {}
    if not head:
        head = "head_f_white_jane.hd" if cos.lower().startswith("f_") else "head_m_white_joe.hd"
    hp = paks.find(head)
    hd0 = hd1 = None
    if hp:
        hd0 = hd_dump.parse(open(hp, "rb").read())
        remap["head_m_white_joe.dds"] = hd0["texture"]     # generic_head.msh names this texture; the person's .hd names the real one
        if head2 and paks.find(head2):
            hd1 = hd_dump.parse(open(paks.find(head2), "rb").read())
    else:
        print("head file %s not found; using the generic head" % head)
    if hd0 and not a.no_morph:
        p4, p5 = hd_dump.age_weight(age if age is not None else 25.0, weight if weight is not None else 70.0)
        shape = hd_dump.morph(hd0, p4, p5, hd1, mix)
        m = msh_dump.parse(open(gh, "rb").read())
        i = 0
        for node in m["nodes"]:
            for prim in node["prims"]:
                for j, v in enumerate(prim["verts"]):
                    prim["verts"][j] = tuple(shape[i]) + tuple(v[6:])
                    i += 1
        if i != hd_dump.N:
            sys.exit("generic_head.msh has %d vertices, the .hd morph %d" % (i, hd_dump.N))
        # The 58-vertex eyeball primitive is not morphed by the .hd (its A array equals the generic head) but the face and the eyelid/mouth primitive around it move
        # by up to 5 mm, which buries the 2-3 mm proud eyeballs behind the lids (seen as dark eyes). How the game avoids that was not found in the code read; here the
        # morph of a vertex of those two primitives fades to nothing within 6 mm of an eyeball vertex and is complete from 2.6 cm. A deviation from the file data.
        prims = [pr for node in m["nodes"] for pr in node["prims"]]
        if len(prims) == 3 and len(prims[1]["verts"]) == 58:
            eyes = prims[1]["verts"]
            orig = [pr["verts"] for pr in msh_dump.parse(open(gh, "rb").read())["nodes"][0]["prims"]]
            for pi in (0, 2):
                for j, v in enumerate(prims[pi]["verts"]):
                    o = orig[pi][j]
                    d = min(((o[0] - e[0]) ** 2 + (o[1] - e[1]) ** 2 + (o[2] - e[2]) ** 2) ** 0.5 for e in eyes)
                    t = max(0.0, min(1.0, (d - 0.006) / 0.020))
                    w = t * t * (3 - 2 * t)
                    prims[pi]["verts"][j] = tuple(o[c] + w * (v[c] - o[c]) for c in range(3)) + tuple(v[3:])
        parsed[gh] = m
        print("head morph: %s age %.1f -> %.2f, weight %.1f kg -> %.2f%s" % (head, age if age is not None else 25.0, p4, weight if weight is not None else 70.0, p5,
                                                                         (", mixed %.2f with %s" % (mix, head2)) if hd1 else ""))
    if hair and paks.find(hair):
        meshes.append(paks.find(hair))
    if not meshes[0]:
        sys.exit("body mesh %s not found" % c["body"])
    anims = [p for p in (paks.find(n + ".anm") for n in a.anims.split(",") if n) if p]
    export_character.write_character(meshes, anims, a.out, remap, find=paks.texture, parsed=parsed, name="%s: %s (%s, %s)" % (who, cos[:-4], head or "-", hair or "-"))


if __name__ == "__main__":
    main()
