"""The functions the game runs every game month: everything first-called after the F8 (re-arm) marker of a coverage run.

After F8 every function is armed again, so the phase that starts at F8_REARM lists the complete set used during that stretch, and
the following month phases add what only some months use. Joins the set with names, the static class attribution
(tools/attribute_classes.py) and the dynamic one (tools/analyze_this_log.py).

Usage: python3 tools/steady_state.py <coverage_log.csv> [--out docs/generated]
Writes steady_state.csv (address, name, phase, class, source) and prints the numbers.
"""
import argparse
import collections
import csv
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('log')
    ap.add_argument('--out', default=os.path.join(REPO, 'docs', 'generated'))
    a = ap.parse_args()
    marks, rows = [], []
    for line in open(a.log, encoding='utf-8'):
        if line.startswith('#MARK'):
            p = line.strip().split(',')
            marks.append((int(p[3]), p[4]))
        elif not line.startswith('seq'):
            p = line.strip().split(',')
            rows.append((int(p[3]), int(p[4], 16) + 0x400000))
    rearm = [ph for ph, label in marks if label == 'F8_REARM']
    if not rearm:
        sys.exit('no F8_REARM marker in the log')
    start = rearm[-1]
    names = {int(r['address'], 16): r['name'] for r in csv.DictReader(open(os.path.join(REPO, 'tools', 'ghidra_names.csv'), encoding='utf-8'))}
    cls = {}
    for fn, key in (('class_attribution.csv', 'class'), ('dynamic_class_attribution.csv', 'declaring_class')):
        path = os.path.join(a.out, fn)
        if os.path.exists(path):
            for r in csv.DictReader(open(path)):
                if r.get(key) and (key == 'declaring_class' or r['tier'] in ('known', 'A', 'B', 'FA')):
                    cls.setdefault(int(r['address'], 16), (r[key], fn.split('_')[0]))
    steady = [(ph, va) for ph, va in rows if ph >= start]
    per = collections.Counter(ph for ph, _ in steady)
    print('F8 at phase %d; functions first-called afterwards: %d' % (start, len(steady)))
    print('per phase:', ', '.join('%d:%d' % (p, per[p]) for p in sorted(per)))
    named = sum(1 for _, va in steady if not names.get(va, 'FUN_').startswith('FUN_'))
    withcls = sum(1 for _, va in steady if va in cls)
    print('already named: %d; with a class (static or dynamic): %d' % (named, withcls))
    c = collections.Counter(cls[va][0] for _, va in steady if va in cls)
    print('top classes:', c.most_common(15))
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, 'steady_state.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['address', 'name', 'phase', 'class', 'class_source'])
        for ph, va in steady:
            w.writerow(['%08X' % va, names.get(va, ''), ph] + list(cls.get(va, ('', ''))))


if __name__ == '__main__':
    main()
