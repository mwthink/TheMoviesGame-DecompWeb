"""Turns the this-class log of the coverage tracer (coverage_this.csv) into class attributions.

For a __thiscall method ECX is `this` and its first dword is the object's vtable pointer, so the log says which class the method
really ran on. Needs: the log (debugger/src/hooks/CoverageTracer.cpp "this-class mode"), tools/ghidra_names.csv and
docs/generated/rtti_classes.json (tools/rtti_dump.py), optionally docs/generated/class_attribution.csv (tools/attribute_classes.py)
to cross-check the static attributions.

Each function gets the set of dynamic classes it was seen running on. The class that *declares* the method is the dynamic class
itself or one of its bases: with one observation it is the most derived class ("<= C"), with several different classes it is
their closest common base. The result is checked against the functions whose class is already known (names, RTTI), which gives the
measured reliability of the method before it is applied to the unnamed ones.

Usage: python3 tools/analyze_this_log.py <coverage_this.csv> [--out docs/generated]
Writes dynamic_class_attribution.csv / .md (gitignored: game-derived names).
"""
import argparse
import collections
import csv
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import attribute_classes as ac

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGE_BASE = 0x400000
FUN = re.compile(r'^FUN_[0-9a-f]{8}$')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('log')
    ap.add_argument('--out', default=os.path.join(REPO, 'docs', 'generated'))
    ap.add_argument('--names', default=os.path.join(REPO, 'tools', 'ghidra_names.csv'))
    ap.add_argument('--rtti', default=os.path.join(REPO, 'docs', 'generated', 'rtti_classes.json'))
    ap.add_argument('--static', default=os.path.join(REPO, 'docs', 'generated', 'class_attribution.csv'))
    a = ap.parse_args()

    names = {int(r['address'], 16): r['name'] for r in csv.DictReader(open(a.names, encoding='utf-8'))}
    rtti = json.load(open(a.rtti))['classes']
    labels = ac.Labels(names, rtti)
    known = {x: v[1] for x, v in labels.label.items()}          # functions whose class is already known
    vt_class = labels.vt2cls
    vt_offset = {}
    for c in rtti:
        for v in c['vtables']:
            vt_offset[int(v['va'], 16)] = v.get('this_offset', 0)

    seen = collections.defaultdict(collections.Counter)         # function VA -> Counter(vtable VA)
    rows = 0
    for r in csv.DictReader(open(a.log)):
        f = int(r['rva'], 16) + IMAGE_BASE
        vt = int(r['vtable_rva'], 16) + IMAGE_BASE
        rows += 1
        if vt in vt_class:
            seen[f][vt] += 1
    print('%d log lines, %d functions with a vtable that RTTI knows' % (rows, len(seen)))

    dyn = {}            # function -> sorted list of dynamic classes
    for f, c in seen.items():
        dyn[f] = sorted({vt_class[v] for v in c})

    def anc(c):
        return {c} | labels.ancestors(c)

    def declaring(classes):
        """closest common base of the classes (the class itself for a single class)"""
        if len(classes) == 1:
            return classes[0], 'most-derived'
        common = set.intersection(*[anc(c) for c in classes])
        if not common:
            return '', 'no common base'
        # the most derived of the common bases: the one that is not an ancestor of another common base
        best = [c for c in common if not any(c in labels.ancestors(o) for o in common if o != c)]
        return sorted(best)[0], 'common base of %d classes' % len(classes)

    # reliability against the already known labels
    total = exact = within = 0
    by_kind = collections.defaultdict(lambda: [0, 0, 0])
    for f, classes in dyn.items():
        if f not in known:
            continue
        label = known[f]
        decl, kind = declaring(classes)
        k = 'single class' if len(classes) == 1 else 'several classes'
        total += 1
        ok_exact = (decl == label)
        ok_within = any(label in anc(c) for c in classes) if classes else False
        exact += ok_exact
        within += ok_within
        b = by_kind[k]
        b[0] += 1
        b[1] += ok_exact
        b[2] += ok_within

    static = {}
    if os.path.exists(a.static):
        for r in csv.DictReader(open(a.static)):
            static[int(r['address'], 16)] = r

    out = []
    agree = {'A': [0, 0], 'B': [0, 0]}
    for f in sorted(dyn):
        classes = dyn[f]
        decl, kind = declaring(classes)
        n = names.get(f, '')
        s = static.get(f)
        st = ''
        if s and s['tier'] in ('A', 'B'):
            st = s['tier']
            agree[st][0] += 1
            agree[st][1] += (s['class'] == decl or s['class'] in classes or any(s['class'] in anc(c) for c in classes))
        out.append((f, n, '|'.join(classes), decl, kind, known.get(f, ''), s['tier'] if s else '', s['class'] if s else ''))

    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, 'dynamic_class_attribution.csv'), 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        w.writerow(['address', 'name', 'dynamic_classes', 'declaring_class', 'how', 'known_class', 'static_tier', 'static_class'])
        for r in out:
            w.writerow(['%08X' % r[0]] + list(r[1:]))

    fun = [r for r in out if FUN.match(r[1])]
    new = [r for r in fun if not r[5] and r[6] not in ('A', 'B')]
    with open(os.path.join(a.out, 'dynamic_class_attribution.md'), 'w', encoding='utf-8') as fh:
        fh.write('# Dynamic class attribution (this-class log)\n\nGenerated by tools/analyze_this_log.py from %s\n\n' % os.path.basename(a.log))
        fh.write('Functions with an observed `this` vtable: %d (unnamed FUN_*: %d)\n\n' % (len(out), len(fun)))
        fh.write('## Reliability against functions whose class was already known\n\n')
        fh.write('| observations | functions | declaring class equals the known class | known class is the dynamic class or one of its bases |\n|---|---|---|---|\n')
        for k, (n_, e, w_) in sorted(by_kind.items()):
            fh.write('| %s | %d | %d (%.0f%%) | %d (%.0f%%) |\n' % (k, n_, e, 100.0 * e / max(n_, 1), w_, 100.0 * w_ / max(n_, 1)))
        fh.write('| all | %d | %d (%.0f%%) | %d (%.0f%%) |\n\n' % (total, exact, 100.0 * exact / max(total, 1), within, 100.0 * within / max(total, 1)))
        fh.write('## Cross-check of the static attributions (tools/attribute_classes.py)\n\n')
        for t in ('A', 'B'):
            fh.write('- tier %s: %d functions seen at run time, %d consistent with the dynamic class or a base (%.0f%%)\n' % (
                t, agree[t][0], agree[t][1], 100.0 * agree[t][1] / max(agree[t][0], 1)))
        fh.write('\n## Gain\n\nUnnamed FUN_* functions with a dynamic class and no known class and no static tier A/B: %d\n' % len(new))
    print('reliability: %d known functions seen; declaring class equals known class for %d (%.0f%%); known class is the dynamic class or a base for %d (%.0f%%)' % (
        total, exact, 100.0 * exact / max(total, 1), within, 100.0 * within / max(total, 1)))
    for k, (n_, e, w_) in sorted(by_kind.items()):
        print('  %-16s %5d functions  exact %.0f%%  within-hierarchy %.0f%%' % (k, n_, 100.0 * e / max(n_, 1), 100.0 * w_ / max(n_, 1)))
    for t in ('A', 'B'):
        print('static tier %s: %d seen, %.0f%% consistent' % (t, agree[t][0], 100.0 * agree[t][1] / max(agree[t][0], 1)))
    print('unnamed functions with a dynamic class: %d; of which new (no known class, no static tier A/B): %d' % (len(fun), len(new)))


if __name__ == '__main__':
    sys.exit(main())
