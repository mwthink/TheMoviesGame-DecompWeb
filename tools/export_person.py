#!/usr/bin/env python3
"""Build a character for the viewer straight from the game files: a person of a saved game, or a costume by name.

    python3 tools/export_person.py "<game>/Data/pak" --save "<save>.jad" --list
    python3 tools/export_person.py "<game>/Data/pak" --save "<save>.jad" --person 1245 [--anims walk,walk_casual] [--out viewer/data]
    python3 tools/export_person.py "<game>/Data/pak" --cos f_cheerleader_1 [--head head_f_japanese_girl.hd] [--hair hair_20s_f12.msh]

A person comes from tools/save_cast.py (head .hd, costume .cos, hair mesh). The costume file (tools/cos_dump.py) names the body mesh; the head is generic_head.msh with
the texture named inside the .hd file (its first string, at 0x0c); the hair is its own mesh. All of them share the 30-bone skeleton (docs/ANM_FORMAT.md).
Not done: the head's shape morph (the rest of the .hd), makeup, hair/skin tint, accessories (hats, glasses, rings), the costume's texture layers. The body's own
texture atlas is used as it is.

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
    if a.person is not None:
        q = next((q for q in save_cast.cast(a.save) if q["id"] == a.person), None)
        if not q or not q["cos"]:
            sys.exit("person %s not found, or the save stores no costume for them" % a.person)
        cos, head, hair, who = q["cos"], head or q["head"], hair or q["hair"], "%s %d" % (q["class"], q["id"])
    if not cos:
        sys.exit("give --person (with --save) or --cos")
    paks = Paks(a.pakdir, a.cache)
    cos = cos if cos.lower().endswith(".cos") else cos + ".cos"
    cpath = paks.find(cos)
    if not cpath:
        sys.exit("costume %s not found in the archives" % cos)
    c = cos_dump.parse(open(cpath, "rb").read())
    meshes = [paks.find(c["body"])]
    meshes.append(paks.find("generic_head.msh"))
    remap = {}
    if head:
        hp = paks.find(head)
        if hp:
            remap["head_m_white_joe.dds"] = hd_texture(hp)     # generic_head.msh names this texture; the person's .hd names the real one
        else:
            print("head file %s not found; using the default head texture" % head)
    if hair and paks.find(hair):
        meshes.append(paks.find(hair))
    if not meshes[0]:
        sys.exit("body mesh %s not found" % c["body"])
    anims = [p for p in (paks.find(n + ".anm") for n in a.anims.split(",") if n) if p]
    export_character.write_character(meshes, anims, a.out, remap, find=paks.texture, name="%s: %s (%s, %s)" % (who, cos[:-4], head or "-", hair or "-"))


if __name__ == "__main__":
    main()
