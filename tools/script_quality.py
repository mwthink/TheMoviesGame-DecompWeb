#!/usr/bin/env python3
"""Recompute a project's script quality from a saved game with the formula traced from MoviesSE.exe (Script_RecomputeQuality, 004c3ae0), no tuning.

    python3 tools/script_quality.py save.jad "<game>/Data/pak" [--project ID] [--cache DIR]

Inputs: the save (shots, cast roles), `scriptquality.ini` weights (data/game_data/scriptquality.ini), each shot's scene ini
(`[level] quality`, `runtime`) and each shot's set ini (`quality`), extracted from the pak archives into --cache
(default data/game_data/scenes, gitignored). See docs/SCRIPTS.md "Script quality".
"""
import configparser, glob, os, struct, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pak_extract, script_dump as sd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def clamp(x):
    return max(0.0, min(1.0, x))


def read_ini(path):
    cp = configparser.RawConfigParser(strict=False)
    cp.optionxform = str
    txt = open(path, errors="replace").read()
    # the game's inis use tab-indented "[a/b]" sections and "key = value" lines; flatten what we need
    sec, out = "", {}
    for line in txt.splitlines():
        s = line.strip()
        if s.startswith("["):
            sec = s.strip("[]")
        elif "=" in s:
            k, v = [x.strip() for x in s.split("=", 1)]
            out.setdefault(sec, {}).setdefault(k, v)
    return out


def fetch(pakdir, cache, names):
    os.makedirs(cache, exist_ok=True)
    need = [n for n in names if not os.path.exists(os.path.join(cache, n))]
    if need:
        import contextlib, io
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            pak_extract.main(["pak_extract", "extract", pakdir, cache] + need)


def compute(s, proj, pakdir, cache):
    W = read_ini(os.path.join(ROOT, "data", "game_data", "scriptquality.ini"))
    q, c = W["quality"], W["criteria"]
    f = lambda k: float(q[k])
    d = s.d(proj)
    shots = [s.by_id[i] for i in sd.refs(d["c9727001"])]
    scenes = [sd.pstr(s.d(o)["e1f958a0"]).split("/")[-1] + ".ini" for o in shots]
    sets = [sd.pstr(s.d(o)["27b75b2d"]) + ".ini" for o in shots]
    fetch(pakdir, cache, sorted(set(scenes + sets)))
    sc = [read_ini(os.path.join(cache, n)) for n in scenes]
    st = [read_ini(os.path.join(cache, n)) for n in sets]
    cast = s.by_id[sd.u32(d["PCast"])]
    roles = [s.d(s.by_id[sd.u32(r)]) for r in s.all(cast, "6bf1cbd8")]
    rtype = [sd.u32(r["51dd01e0"]) for r in roles]  # 0 nonlead, 1..3 lead types
    n = len(shots)
    terms = []

    def add(name, value, weight, detail=""):
        terms.append((name, value, weight, clamp(clamp(value) * weight), detail))

    runtime = [float(x[""]["runtime"]) for x in sc]
    add("length", sum(r * 0.1 for r in runtime) / f("max_length"), f("max_length_weight"), f"sum(runtime*0.1)={sum(r*0.1 for r in runtime):.1f} / max_length")
    req = max([sum(1 for k, v in x.items() if k.startswith("role/role") and v.get("required") == "1") for x in sc] + [0])
    req = max(req, len(roles))
    add("required roles", req / f("min_required_roles"), f("min_required_roles_weight"), f"{req} roles")
    changes = sum(1 for a, b in zip(sets, sets[1:]) if a != b)
    add("set changes", changes / f("max_set_changes"), f("max_set_changes_weight"), f"{changes}")
    add("costume changes", 0.0, f("max_costume_changes_weight"), "NOT computed: assumed 0 (needs the CCostume comparison, FUN_005b77a0)")
    add("extras", 0.0, f("max_extras_weight"), "weight 0 in the ini")
    seen, tot = [], 0.0
    for x, nm in zip(sc, scenes):
        qv = float(x["level"]["quality"])
        tot += qv * (f("scene_repeat_factor") ** seen.count(nm))
        seen.append(nm)
    add("scene quality", tot / n, f("scene_quality_weight"), f"avg of per-scene quality with repeat factor, {tot:.3f}/{n}")
    sq = sum(float(next(v["quality"] for k, v in x.items() if "quality" in v)) for x in st) / n
    add("set quality", sq, f("set_quality_weight"), f"avg set quality {sq:.3f}")
    add("num scenes", n / f("num_scenes"), f("num_scenes_weight"), f"{n} shots")
    leads = sum(1 for t in rtype if t in (1, 2, 3))
    add("lead roles", leads / f("max_lead_roles"), f("max_lead_roles_weight"), f"{leads} (role types {rtype})")
    non = sum(1 for t in rtype if t == 0)
    add("nonlead roles", non / f("max_nonlead_roles"), f("max_nonlead_roles_weight"), f"{non}")
    total = 0.0
    for t in terms:
        total = clamp(total + t[3])
    if n == 1:
        total = clamp(total * f("one_shot_factor"))
    if n == 2:
        total = clamp(total * f("two_shot_factor"))
    if n == 0:
        total = 0.0
    return terms, total


def main(argv):
    if len(argv) < 2:
        sys.exit(__doc__)
    s = sd.Save(argv[0])
    pakdir = argv[1]
    only = int(argv[argv.index("--project") + 1]) if "--project" in argv else None
    cache = argv[argv.index("--cache") + 1] if "--cache" in argv else os.path.join(ROOT, "data", "game_data", "scenes")
    for proj in s.of("CProject"):
        if only is not None and proj["id"] != only:
            continue
        d = s.d(proj)
        sc = s.d(s.by_id[sd.u32(d["a34de9e2"])])
        terms, total = compute(s, proj, pakdir, cache)
        print(f"CProject {proj['id']} {sd.wstr(d['Title'])!r}")
        for name, v, w, contrib, detail in terms:
            print(f"  {name:16s} raw {v:7.4f} x weight {w:4.2f} = {contrib:.6f}   {detail}")
        print(f"  computed {total:.6f}   saved CScript Quality {sd.f32(sc['Quality']):.6f}   saved 4b51dbd5 {sd.f32(sc['4b51dbd5']):.6f}")


if __name__ == "__main__":
    main(sys.argv[1:])
