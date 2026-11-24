#!/usr/bin/env python3
"""Static call graph over data/ExportDecompiled (direct calls only; virtual calls are invisible).

  callgraph.py <name|addr> [--down N] [--up N]   tree of callees / callers around a function
  callgraph.py --build                           just (re)build the cache
Names come from tools/ghidra_names.csv, so unnamed functions print as FUN_xxxxxxxx.
"""
import re, sys, os, csv, pickle, argparse
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXP = os.path.join(ROOT, 'data/ExportDecompiled')
CACHE = os.path.join(ROOT, 'docs/generated/callgraph.pkl')
HDR = re.compile(r'^//// FUNCTION (\S+) @ ([0-9a-f]{8}) ////$', re.M)
CALL = re.compile(r'\b([A-Za-z_][A-Za-z0-9_$]*)\s*\(')
KW = {'if','while','for','switch','return','sizeof','do','else'}

def build():
    names = {}
    with open(os.path.join(ROOT, 'tools/ghidra_names.csv')) as f:
        for r in csv.reader(f):
            if r and r[0] != 'address': names[r[0].lower()] = r[1]
    with open(os.path.join(ROOT, 'renames.csv'), newline='') as f:   # newer than the Ghidra dump
        for r in csv.DictReader(f): names[r['address'].lower()] = r['new_name']
    funcs = {}
    for fn in sorted(os.listdir(EXP)):
        if not fn.startswith('decomp_'): continue
        t = open(os.path.join(EXP, fn), errors='replace').read()
        ms = list(HDR.finditer(t))
        for i, m in enumerate(ms):
            end = ms[i+1].start() if i+1 < len(ms) else len(t)
            funcs[m.group(2)] = (m.group(1), t[m.end():end])
    byname = {}
    for a, (n, _) in funcs.items():
        byname[n] = a; byname[names.get(a, n)] = a
        byname['FUN_' + a] = a
    down, up, size = {}, {}, {}
    for a, (n, body) in funcs.items():
        size[a] = body.count('\n')
        cs = set()
        for c in CALL.findall(body):
            if c in KW: continue
            t = byname.get(c)
            if t is None:
                m = re.fullmatch(r'(?:FUN|thunk_FUN)_([0-9a-f]{8})', c)
                t = m.group(1) if m else None
            if t and t != a: cs.add(t)
        down[a] = cs
        for t in cs: up.setdefault(t, set()).add(a)
    disp = {a: names.get(a, n) for a, (n, _) in funcs.items()}
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    pickle.dump((down, up, disp, size, byname), open(CACHE, 'wb'))

def load():
    if not os.path.exists(CACHE): build()
    return pickle.load(open(CACHE, 'rb'))

def resolve(x, byname):
    if x in byname: return byname[x]
    x = x.lower().removeprefix('0x')
    if re.fullmatch(r'[0-9a-f]{8}', x): return x
    return byname.get(x) or byname.get(x.replace('fun_', 'FUN_'))

def tree(g, disp, a, depth, seen, ind=0, out=print):
    for c in sorted(g.get(a, ())):
        mark = '' if not disp[c].startswith('FUN_') else '  ?'
        out('  ' * ind + f'{c} {disp[c]}{mark}')
        if depth > 1 and c not in seen:
            seen.add(c); tree(g, disp, c, depth-1, seen, ind+1, out)

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('fn', nargs='?')
    ap.add_argument('--down', type=int, default=1); ap.add_argument('--up', type=int, default=0)
    ap.add_argument('--build', action='store_true'); a = ap.parse_args()
    if a.build: build(); sys.exit()
    down, up, disp, size, byname = load()
    t = resolve(a.fn, byname)
    if not t or t not in disp: sys.exit('unknown function')
    print(f'{t} {disp[t]} ({size[t]} lines)')
    if a.down: print('-- calls:'); tree(down, disp, t, a.down, {t})
    if a.up: print('-- called from:'); tree(up, disp, t, a.up, {t})
