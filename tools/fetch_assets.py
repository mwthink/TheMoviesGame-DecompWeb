#!/usr/bin/env python3
"""Extract the game files a saved game needs to be rendered: the placed assets' .ini files, their .msh models, the textures those name
and the ground textures (docs/SAVE_FORMAT.md "From save names to game files").

    python3 tools/fetch_assets.py "<save>.jad" "<game>/Data/pak" [--out data/game_data/save_assets] [--textures data/game_data/textures]

Then render with: tools/jad_dump.py <save> --terrain out.png --footprints <out> --roofs <textures> --ground <out> ...
Output stays under data/ (gitignored): these are game assets.
"""
import contextlib
import io
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jad_dump
import msh_dump
import pak_extract


def extract(pakdir, out, patterns):
    patterns = sorted(set(patterns))
    if not patterns:
        return
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(io.StringIO()):
        pak_extract.main(["pak_extract", "extract", pakdir, out] + patterns)
    print(f"  {len(patterns)} pattern(s) -> {buf.getvalue().strip().splitlines()[-1]}")


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    opt = lambda n, d: argv[argv.index(n) + 1] if n in argv else d
    out, tex = opt("--out", "data/game_data/save_assets"), opt("--textures", "data/game_data/textures")
    for v in (out, tex):
        if v in args:
            args.remove(v)
    if len(args) != 2:
        sys.exit(__doc__)
    save, pakdir = args
    jad_dump.NAMES.update(jad_dump.load_names())
    p = jad_dump.parse(save)
    stems = sorted({os.path.basename(a[2]) for a in jad_dump.placed_assets(p) if a[0] != "CLot"} | {"lot"})
    print(f"{len(stems)} distinct assets in the save")
    extract(pakdir, out, [s + ".ini" for s in stems])
    meshes = set()
    missing = []
    for s in stems:
        found = False
        for f in sorted(os.listdir(out)):
            if f.startswith(s + ".ini"):
                m = re.search(r"mesh\s*=\s*(\S+)", open(os.path.join(out, f), errors="replace").read())
                if m:
                    meshes.add(m.group(1).lower())
                    found = True
                    break
        if not found:
            missing.append(s)
    print(f"{len(meshes)} meshes named by the inis; no ini or mesh line for: {', '.join(missing) or 'none'}")
    extract(pakdir, out, sorted(meshes))
    textures = set()
    for m in sorted(meshes):
        path = os.path.join(out, m)
        if os.path.exists(path):
            textures.update(t.lower() for t in msh_dump.parse(open(path, "rb").read())["textures"])
    land = landscape_names(p)
    print(f"{len(textures)} textures named by the meshes, {len(land)} ground textures")
    extract(pakdir, tex, sorted(textures))
    extract(pakdir, out, land)


def landscape_names(p):
    land = jad_dump.landscape(p)
    return [n.lower() + ".dds" for n in land[0]] if land else []


if __name__ == "__main__":
    main(sys.argv[1:])
