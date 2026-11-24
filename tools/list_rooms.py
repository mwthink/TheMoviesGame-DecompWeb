#!/usr/bin/env python3
"""List every room the game can have: the named floor polygons (`room_*` parts) of every facility, trailer and set model in the game archives, with the
text the game draws on each (from the string database) and the scene script name where known.

    python3 tools/list_rooms.py "<game>/Data/pak" ["<game>/Data/text/EN-UK/stringdatabase.lhts,<addon.lhts>"] > rooms.md

Where the rooms come from (docs/SAVE_FORMAT.md, docs/MSH_FORMAT.md): the room list is not in the executable. It is data: the placed asset's .ini names a mesh and
that mesh's named parts are its rooms (`LH_LoadMeshBinary`, room table at mesh + 0x70, 0x90 bytes each: 32-byte name + polygon). The class that runs a room (CHireRoom,
CFireRoom ...) is chosen from the part name when the facility is created; the save then stores one TMRoom-family object per part, matched by name.
Reads the archives directly; nothing is written to disk except what you redirect.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lhts
import msh_dump
import pak_extract


def main(argv):
    if not argv:
        sys.exit(__doc__)
    strings = lhts.load(*argv[1].split(",")) if len(argv) > 1 else None
    files = {}                       # lower-case name -> list of (pak, entry), newest archive last
    for path in pak_extract.paks(argv[0]):
        for e in pak_extract.read_entries(path):
            n = e[0].lower()
            if n.endswith((".ini", ".msh")) and (n.startswith(("facility_", "trailer_", "set_", "fac_", "lot")) or n.endswith(".msh")):
                files.setdefault(n, []).append((path, e))
    rows = {}
    for name, entries in sorted(files.items()):
        if not name.endswith(".ini") or not name.startswith(("facility_", "trailer_", "set_")):
            continue
        meshes = set()
        for path, e in entries:
            m = re.search(r"mesh\s*=\s*(\S+)", pak_extract.read_file(path, e).decode("latin1"))
            if m:
                meshes.add(m.group(1).lower())
        for mesh in sorted(meshes):
            if mesh not in files:
                continue
            path, e = files[mesh][-1]
            try:
                parts = msh_dump.parse(pak_extract.read_file(path, e), geometry=False)["parts"]
            except Exception as ex:
                print(f"<!-- {mesh}: {ex} -->")
                continue
            rows[(name[:-4], mesh)] = [n for n, _c in parts]
    print("| asset (.ini) | mesh | room part | text drawn on the floor |\n|---|---|---|---|")
    total = 0
    for (ini, mesh), parts in sorted(rows.items()):
        for part in parts:
            text = " / ".join(lhts.room_lines(strings, part)) if strings is not None else ""
            print(f"| {ini} | {mesh} | `{part}` | {text} |")
            total += 1
    print(f"\n{len(rows)} assets with rooms, {total} room parts")


if __name__ == "__main__":
    main(sys.argv[1:])
