#!/usr/bin/env python3
"""Map functions to original source files using the assert/SLVAR path strings the game embeds
(`C:\\movies\\dev\\TheMovies\\Mood.cpp`), then span each file over the address gaps (the linker keeps one
object file's functions together). Writes docs/generated/source_files.csv (per anchor) and
source_file_ranges.csv (per file: first/last anchor, count, other-file anchors inside the span)."""
import re, os, csv, collections, sys
sys.path.insert(0, os.path.dirname(__file__)); import callgraph as c
PATH = re.compile(r'"(C:\\\\movies\\\\dev\\\\[^"]+?\.(?:cpp|h|inl))"', re.I)
anch = {}
for fn in sorted(os.listdir(c.EXP)):
    if not fn.startswith('decomp_'): continue
    t = open(os.path.join(c.EXP, fn), errors='replace').read()
    ms = list(c.HDR.finditer(t))
    for i, m in enumerate(ms):
        body = t[m.end(): ms[i+1].start() if i+1 < len(ms) else len(t)]
        for p in set(PATH.findall(body)):
            anch.setdefault(m.group(2), set()).add(p.replace('\\\\', '\\'))
_, _, disp, size, _ = c.load()
out = os.path.join(c.ROOT, 'docs/generated')
with open(out + '/source_files.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['address', 'name', 'source_file'])
    for a in sorted(anch): w.writerow([a, disp.get(a, ''), ';'.join(sorted(anch[a]))])
single = sorted((a, next(iter(p))) for a, p in anch.items() if len(p) == 1)
by = collections.defaultdict(list)
for a, p in single: by[p].append(a)
rng = {p: (min(v), max(v), len(v)) for p, v in by.items()}
with open(out + '/source_file_ranges.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['source_file', 'first', 'last', 'anchors', 'foreign_anchors_inside', 'functions_in_span'])
    allf = sorted(disp)
    for p, (lo, hi, n) in sorted(rng.items(), key=lambda kv: kv[1][0]):
        foreign = sum(1 for a, q in single if lo < a < hi and q != p)
        w.writerow([p, lo, hi, n, foreign, sum(1 for a in allf if lo <= a <= hi)])
print(len(anch), 'anchor functions,', len(rng), 'files')
