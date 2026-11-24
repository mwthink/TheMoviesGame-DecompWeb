#!/usr/bin/env python3
"""Contact sheet of several stars: python3 tools/render_star_sheet.py <assets dir> <out.png> <star folder>[@yaw][!expr[:intensity]] ...  (each panel is labelled in the console)"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from render_star import build, raster
from render_expression import write_png

if __name__ == "__main__":
    assets, out = sys.argv[1:3]
    specs = sys.argv[3:]
    size = 300
    cols = min(4, len(specs)); rows = (len(specs) + cols - 1) // cols
    W, H = cols * size, rows * size
    sheet = [0] * (W * H * 3)
    for k, sp in enumerate(specs):
        expr = None
        if "!" in sp:
            sp, e = sp.split("!"); expr = (int(e.split(":")[0]), float(e.split(":")[1]) if ":" in e else 1.0)
        yaw = 0.0
        if "@" in sp:
            sp, y = sp.split("@"); yaw = float(y)
        info, mesh, textures, used, years, age = build(sp, assets, expr)
        zs = [p[2] for p in mesh[0]]
        r = 0.16
        img = raster(mesh, textures, size, (-r, r, 1.545, 1.545 + 2 * r), yaw)
        ox, oy = (k % cols) * size, (k // cols) * size
        for y in range(size):
            sheet[((oy + y) * W + ox) * 3:((oy + y) * W + ox + size) * 3] = img[y * size * 3:(y + 1) * size * 3]
        print("panel", k, info["name"], "yaw", yaw, "expr", expr, "hair", info["hair_colour"], "iris", info["eye"], "age %.0f" % years, flush=True)
    write_png(out, W, H, sheet)
    print("wrote", out)
