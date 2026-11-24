"""Attributes unclassified functions to classes, with a measured precision for every attribution.

Why: most of the 30,000 unnamed functions have no class, which blocks grouping them into modules and recovering class layouts.
Evidence (strongest first):
  name      the function's name already says the class (CStar_AddMovieRating) or its vtable (Ctor_vt00d9e214_...)
  vtable    the function is a virtual slot of a class (RTTI, docs/generated/rtti_classes.json), or an RTTI constructor candidate
  vtstore   the machine code stores a class's vtable pointer into `this` (constructors and destructors; 97% right)
  adjacency the nearest labelled functions before and after in the address space belong to one class (the linker lays out
            one source file's functions together)
  thiscall  the function is only called with ECX = the caller's `this`, by a method of one class
  callers   all direct callers are methods of one class
These are combined per function and looked up in a calibration table: a random 40% of the labelled functions are hidden three
times, attributed from the rest, and the share that comes out right is counted per combination of evidence. So every proposed
class carries the precision measured for that combination (a lower bound for the real run, which has all labels available).
Two criteria are counted: exactly the right class, and the right class *or its base / derived class* (a derived class's methods
usually sit in the same source file as its base). A function whose exact precision is too low but whose family precision is high
gets tier FA / FB: use it to group functions into modules, not to name the class.

Needs: tools/ghidra_names.csv, docs/generated/rtti_classes.json (tools/rtti_dump.py), and `objdump` (macOS: Xcode command line
tools; it disassembles the PE) plus the game's MoviesSE.exe for the machine-code evidence. Without them only the name/RTTI/adjacency
evidence is used.

Usage: python3 tools/attribute_classes.py --exe "<game>/MoviesSE.exe" [--out docs/generated] [--no-eval]
Writes (all gitignored, they hold game-derived names): class_attribution.csv, class_attribution.md,
       class_attribution_names.csv (address,name for the most reliable attributions of unnamed functions; apply with the
       Ghidra script ghidra/ApplyNames).
"""
import argparse
import bisect
import collections
import csv
import json
import math
import os
import random
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FUN = re.compile(r'^FUN_[0-9a-f]{8}$')
NONCLASS = {'Ctor', 'Dtor', 'SetVtable', 'ScalarDeletingDtor', 'thunk', 'GetField', 'Wrap', 'Catch'}
LIB_BAND = (0x00BB0000, 0x00CA0000)   # statically linked library code (CRT, STL, zlib, PK audio/disk): see library_map.csv


def short_class(rtti_name):
    if rtti_name.startswith('?$'):
        return rtti_name.split('@')[0].lstrip('?$')
    return re.sub(r'<.*', '', rtti_name).split('::')[-1]


# ----------------------------------------------------------------------------------------------------------- labels
class Labels:
    def __init__(self, names, rtti):
        self.vt2cls = {}
        self.exact_size = {}
        self.kind = {}       # class label -> 'game' | 'template' | 'library' (std, boost, Perforce: not game classes)
        self.bases = collections.defaultdict(set)
        self._anc = {}
        slot = collections.defaultdict(set)
        ctor = collections.defaultdict(set)
        for c in rtti:
            sc = short_class(c['name'])
            ns = c['name'].split('::')[0] if '::' in c['name'] else ''
            kind = 'template' if c['name'].startswith('?$') else 'library' if ns in ('std', 'boost', 'Perforce', 'LHA') else 'game'
            if self.kind.get(sc) != 'template':      # a label shared with a template instantiation (CP, RP, InList...) is not a class
                self.kind[sc] = kind
            for b in c.get('bases', []):
                bs = short_class(b[0])
                if bs != sc:
                    self.bases[sc].add(bs)
            for v in c['vtables']:
                self.vt2cls[int(v['va'], 16)] = sc
                if v.get('size'):
                    self.exact_size[sc] = max(self.exact_size.get(sc, 0), v['size'])
                for s in v['slots']:
                    slot[int(s['va'], 16)].add(sc)
                for x in v.get('ctors', []):
                    m = re.search(r'([0-9a-fA-F]{8})$', x)
                    if m:
                        ctor[int(m.group(1), 16)].add(sc)
        self.label = {}     # address -> (source, class)
        for a, n in names.items():
            c = self.from_name(n)
            if c:
                self.label[a] = ('name', c)
        for a, cs in slot.items():
            if a not in self.label and len(cs) == 1:
                self.label[a] = ('vtable', next(iter(cs)))
        for a, cs in ctor.items():
            if a not in self.label and len(cs) == 1:
                self.label[a] = ('ctor', next(iter(cs)))

    def ancestors(self, c):
        if c not in self._anc:
            seen, todo = set(), [c]
            while todo:
                x = todo.pop()
                for b in self.bases.get(x, ()):
                    if b not in seen:
                        seen.add(b)
                        todo.append(b)
            self._anc[c] = seen
        return self._anc[c]

    def related(self, a, b):
        """the same class, or one is an ancestor of the other (a derived class and its base live in the same source file)"""
        return a == b or b in self.ancestors(a) or a in self.ancestors(b)

    def is_game_class(self, label):
        return self.kind.get(label, 'game') == 'game'

    def from_name(self, n):
        if FUN.match(n):
            return None
        m = re.match(r'^(Ctor|SetVtable)_(?:vt)?([0-9a-f]{8})_', n)
        if m:
            return self.vt2cls.get(int(m.group(2), 16))
        m = re.match(r'^([A-Za-z0-9]+)_', n)
        if m and m.group(1) not in NONCLASS:
            return m.group(1)
        return None


# ------------------------------------------------------------------------------------------ machine-code evidence
MEM = re.compile(r'^(-?0x[0-9a-f]+|-?\d+)?\((%\w+)(?:,[^)]*)?\)$')
INS = re.compile(r'^\s*([0-9a-f]+):\s+(\w+)\s*(.*)$')


def split_ops(s):
    out, depth, cur = [], 0, ''
    for ch in s:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == ',' and depth == 0:
            out.append(cur.strip())
            cur = ''
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def op_class(mn):
    for k in ('movzbl', 'movzwl', 'movsbl', 'movswl', 'movzx', 'movsx'):
        if mn.startswith(k):
            return 'movx'
    if mn.startswith('lea'):
        return 'lea'
    if mn.startswith('mov'):
        return 'mov'
    for k in ('add', 'sub', 'xor', 'and', 'or', 'imul', 'shl', 'shr', 'sar', 'sbb', 'adc', 'neg', 'not', 'inc', 'dec', 'xchg', 'cmov'):
        if mn.startswith(k):
            return k
    return 'set' if mn.startswith('set') else mn


def analyse_code(exe, objdump, func_addrs):
    """Per function: is it a __thiscall method, which direct callees get ECX = this, the vtables it stores into this,
    the offsets it touches on this, and its direct callees. Linear scan over the instructions (branches are ignored)."""
    info = {}
    proc = subprocess.Popen([objdump, '-d', '--no-show-raw-insn', exe], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    cur_addr, st, fi = None, None, 0
    for line in proc.stdout:
        m = INS.match(line)
        if not m:
            continue
        a = int(m.group(1), 16)
        if a < func_addrs[0]:
            continue
        while fi + 1 < len(func_addrs) and func_addrs[fi + 1] <= a:
            fi += 1
        fa = func_addrs[fi]
        if fa != cur_addr:
            if cur_addr is not None:
                info[cur_addr] = st
            cur_addr = fa
            st = {'thiscall': False, 'this_calls': [], 'calls': [], 'offs': set(), 'vt': [], 'ecx': 'entry', 'al': {'ecx'}}
        mn = m.group(2)
        ops = split_ops(m.group(3).split('#')[0].strip())
        al, c = st['al'], op_class(mn)
        if st['ecx'] == 'entry':           # does the function read ECX before overwriting it?
            if mn.startswith('push') and ops == ['%ecx']:
                pass                        # `push ecx` only reserves stack space
            elif mn.startswith('call'):
                st['ecx'] = 'clobbered'
                al.discard('ecx')
            elif any('%ecx' in o for o in ops):
                dst = ops[-1]
                reads = any('%ecx' in o for o in ops[:-1]) or ('(' in dst and '%ecx' in dst)
                if len(ops) >= 2 and dst == '%ecx' and c in ('mov', 'lea', 'movx') and not reads:
                    st['ecx'] = 'clobbered'
                    al.discard('ecx')
                elif len(ops) >= 2 and dst == '%ecx' and c == 'xor' and ops[0] == '%ecx':
                    st['ecx'] = 'clobbered'
                    al.discard('ecx')
                else:
                    st['ecx'] = 'this'
                    st['thiscall'] = True
        if mn.startswith('call') or mn.startswith('jmp'):
            mt = re.match(r'^(0x[0-9a-f]+)', ops[0]) if ops else None
            if mt and mn.startswith('call'):
                t = int(mt.group(1), 16)
                st['calls'].append(t)
                if 'ecx' in al and st['ecx'] == 'this':
                    st['this_calls'].append(t)
            if mn.startswith('call'):
                for r in ('eax', 'ecx', 'edx'):
                    al.discard(r)
            continue
        for o in ops:
            mm = MEM.match(o)
            if mm and mm.group(2)[1:] in al and st['ecx'] == 'this':
                g = mm.group(1)
                off = int(g, 16) if g and 'x' in g else (int(g) if g else 0)
                if off >= 0:
                    st['offs'].add(off)
        if c == 'mov' and len(ops) == 2 and ops[0].startswith('$0x') and st['ecx'] == 'this':
            mm = MEM.match(ops[1])
            if mm and mm.group(2)[1:] in al and (not mm.group(1) or int(mm.group(1), 16) == 0):
                st['vt'].append(int(ops[0][1:], 16))
        if len(ops) == 2 and ops[1].startswith('%'):
            dst = ops[1][1:]
            if c == 'mov' and ops[0].startswith('%') and ops[0][1:] in al:
                al.add(dst)
            elif c in ('mov', 'lea', 'movx', 'add', 'sub', 'xor', 'and', 'or', 'imul', 'shl', 'shr', 'sar', 'sbb', 'adc', 'xchg', 'cmov', 'set'):
                al.discard(dst)
        elif len(ops) == 1 and ops[0].startswith('%') and (c in ('neg', 'not', 'inc', 'dec') or mn.startswith('pop')):
            al.discard(ops[0][1:])
    if cur_addr is not None:
        info[cur_addr] = st
    proc.wait()
    for v in info.values():
        v.pop('al', None)
        v.pop('ecx', None)
    return info


# ------------------------------------------------------------------------------------------------- attribution
class Attributor:
    def __init__(self, names, labels, code):
        self.names = names
        self.labels = labels
        self.code = code or {}
        self.seq = sorted(a for a, n in names.items() if not n.startswith('Catch@'))
        self.pos = {a: i for i, a in enumerate(self.seq)}
        self.dcallers = collections.defaultdict(set)
        self.tcallers = collections.defaultdict(set)
        for a, v in self.code.items():
            for t in set(v['calls']):
                if t != a:
                    self.dcallers[t].add(a)
            for t in set(v['this_calls']):
                if t != a:
                    self.tcallers[t].add(a)

    def vtstore_labels(self):
        out = {}
        for a, v in self.code.items():
            cl = [self.labels.vt2cls[x] for x in v['vt'] if x in self.labels.vt2cls]
            if cl and len(set(cl)) == 1:
                out[a] = cl[0]
        return out

    def features(self, T, L):
        """Best candidate class for T from the anchor labels L, with the discretised evidence that supports it."""
        i = self.pos[T]
        seq = self.seq
        pc = pn = None
        dp = dn = 0
        for j in range(i - 1, max(i - 61, -1), -1):
            if seq[j] in L:
                pc, dp = L[seq[j]], i - j
                break
        for j in range(i + 1, min(i + 61, len(seq))):
            if seq[j] in L:
                pn, dn = L[seq[j]], j - i
                break
        tcs, dcs = self.tcallers.get(T, ()), self.dcallers.get(T, ())
        tc = collections.Counter(L[c] for c in tcs if c in L)
        dc = collections.Counter(L[c] for c in dcs if c in L)
        score = collections.Counter()
        if pc and pn and pc == pn:
            score[pc] += 3
        else:
            if pc:
                score[pc] += 1.0 / (1 + dp * 0.3)
            if pn:
                score[pn] += 1.0 / (1 + dn * 0.3)
        for k, n in tc.items():
            score[k] += 2.0 * n / max(len(tcs), 1)
        for k, n in dc.items():
            score[k] += 1.0 * n / max(len(dcs), 1)
        code = self.code.get(T)
        maxoff = max(code['offs']) if code and code['offs'] else -1
        for k in list(score):   # a method cannot touch a field beyond the class size (when the size is known exactly)
            if k in self.labels.exact_size and maxoff >= self.labels.exact_size[k]:
                del score[k]
        if not score:
            return None
        c = score.most_common(1)[0][0]
        if pc == c and pn == c:
            span = dp + dn - 1
            adj = 'both<=2' if span <= 2 else 'both<=5' if span <= 5 else 'both+'
        elif (pc == c and dp == 1) or (pn == c and dn == 1):
            adj = 'one-adjacent'
        elif pc == c or pn == c:
            adj = 'one-near'
        else:
            adj = 'no'

        def state(cnt):
            tot = sum(cnt.values())
            if not tot:
                return 'none'
            if cnt.get(c, 0) == tot:
                return 'all1' if tot == 1 else 'all2+'
            if cnt.get(c, 0) > tot / 2:
                return 'maj'
            return 'minor' if cnt.get(c, 0) else 'other'
        key = (adj, state(tc), state(dc), 'thiscall' if code and code['thiscall'] else 'static')
        return c, key


def calibrate(att, anchors, seeds=(7, 8, 9), hide=0.4):
    """key -> (exactly right, right or related, n) when a random share of the labelled functions is hidden and recovered."""
    table = collections.defaultdict(lambda: [0, 0, 0])
    labelled = [a for a in anchors if a in att.pos]
    for seed in seeds:
        rnd = random.Random(seed)
        hidden = set(rnd.sample(labelled, int(len(labelled) * hide)))
        visible = {a: c for a, c in anchors.items() if a not in hidden}
        for T in hidden:
            r = att.features(T, visible)
            if r:
                t = table[r[1]]
                t[2] += 1
                t[0] += (r[0] == anchors[T])
                t[1] += att.labels.related(r[0], anchors[T])
    return {k: tuple(v) for k, v in table.items()}


def tier_of(precision, n):
    if n < 20:
        return None
    return 'A' if precision >= 0.85 else 'B' if precision >= 0.70 else None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--exe', help="the game's MoviesSE.exe (for the machine-code evidence)")
    ap.add_argument('--objdump', default='objdump')
    ap.add_argument('--out', default=os.path.join(REPO, 'docs', 'generated'))
    ap.add_argument('--names', default=os.path.join(REPO, 'tools', 'ghidra_names.csv'))
    ap.add_argument('--rtti', default=os.path.join(REPO, 'docs', 'generated', 'rtti_classes.json'))
    a = ap.parse_args()

    names = {int(r['address'], 16): r['name'] for r in csv.DictReader(open(a.names, encoding='utf-8'))}
    rtti = json.load(open(a.rtti))['classes']
    labels = Labels(names, rtti)

    code = None
    if a.exe and os.path.exists(a.exe):
        print('disassembling %s ...' % a.exe, flush=True)
        try:
            code = analyse_code(a.exe, a.objdump, sorted(names))
        except OSError as e:
            print('objdump failed (%s): continuing without machine-code evidence' % e)
    else:
        print('no --exe: continuing without machine-code evidence (adjacency only)')

    att = Attributor(names, labels, code)
    anchors = {x: v[1] for x, v in labels.label.items()}
    vts = att.vtstore_labels()
    for x, c in vts.items():
        anchors.setdefault(x, c)
    src = {x: v[0] for x, v in labels.label.items()}
    for x in vts:
        src.setdefault(x, 'vtstore')

    # thunks follow their target
    thunk_of = {}
    for x, n in names.items():
        m = re.match(r'^thunk_FUN_([0-9a-f]{8})$', n)
        if m:
            thunk_of[x] = int(m.group(1), 16)

    print('calibrating (hiding 40%% of %d labelled functions, 3 seeds) ...' % len(anchors), flush=True)
    table = calibrate(att, anchors)

    targets = [x for x in att.seq if x not in anchors and x not in thunk_of]
    result = {}     # address -> (class, tier, source, precision, evidence)
    current = dict(anchors)
    for rnd in (1, 2):
        new = {}
        for T in targets:
            if T in result:
                continue
            r = att.features(T, current)
            if not r:
                continue
            c, key = r
            cn = table.get(key)
            if not cn:
                continue
            prec = cn[0] / cn[2]
            fam = cn[1] / cn[2]
            tier = tier_of(prec, cn[2])
            ftier = tier_of(fam, cn[2])
            if rnd == 2:                                  # built on earlier attributions: one tier down
                tier = 'B' if tier == 'A' else None
                ftier = 'B' if ftier == 'A' else None
            if not (tier or ftier):
                continue
            if not labels.is_game_class(c):
                tier, ftier = 'lib', None                  # template wrappers and library classes are not proposed as game classes
            new[T] = (c, tier or 'F' + ftier, 'adjacency+callers' if rnd == 1 else 'propagated', prec, fam, ' '.join(key))
        result.update(new)
        for T, v in new.items():
            if v[1] == 'A':
                current[T] = v[0]
    for T, tgt in thunk_of.items():
        c = anchors.get(tgt) or (result[tgt][0] if tgt in result and result[tgt][1] == 'A' else None)
        if c:
            result[T] = (c, 'A', 'thunk', 1.0, 1.0, 'thunk of %08x' % tgt)

    os.makedirs(a.out, exist_ok=True)
    rows = []
    for x in att.seq:
        n = names[x]
        if x in anchors:
            rows.append((x, n, anchors[x], 'known', src[x], 1.0, 1.0, ''))
        elif x in result:
            c, tier, s, p, fam, ev = result[x]
            rows.append((x, n, c, tier, s, p, fam, ev))
        else:
            rows.append((x, n, '', 'none', '', 0.0, 0.0, ''))
    # Statically linked Perforce P4API client (tools/p4api_map.py): third-party code, not a game class. Adjacency put some of it under
    # `zlib` (its bundled zlib 1.0.4 sits between its objects), so set it aside here; names already known are left alone.
    p4 = os.path.join(REPO, 'p4api_map.csv')
    if os.path.exists(p4):
        p4rows = {int(r['addr'], 16): r['sub'] for r in csv.DictReader(open(p4, encoding='utf-8'))}
        rows = [(x, n, 'P4API', 'lib', 'p4api_map', 0.0, 0.0, '') if x in p4rows and p4rows[x] != 'zlib-1.0.4' and t != 'known'
                else (x, n, c, t, s, p, fam, ev) for x, n, c, t, s, p, fam, ev in rows]
    with open(os.path.join(a.out, 'class_attribution.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['address', 'name', 'class', 'tier', 'source', 'est_precision_exact', 'est_precision_family', 'evidence'])
        for x, n, c, t, s, p, fam, ev in rows:
            w.writerow(['%08X' % x, n, c, t, s, '%.2f' % p if p else '', '%.2f' % fam if fam else '', ev])
    with open(os.path.join(a.out, 'class_attribution_names.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['address', 'name'])
        for x, n, c, t, s, p, fam, ev in rows:
            if FUN.match(n) and t == 'A' and re.match(r'^[A-Za-z0-9]+$', c):
                w.writerow(['%08X' % x, '%s_sub_%08x' % (c, x)])

    fun = [r for r in rows if FUN.match(r[1])]
    game = lambda x: x < LIB_BAND[0]
    cnt = collections.Counter()
    for x, n, c, t, s, p, fam, ev in fun:
        cnt[(t, 'game' if game(x) else 'library band/other')] += 1
    with open(os.path.join(a.out, 'class_attribution.md'), 'w', encoding='utf-8') as f:
        f.write('# Class attribution\n\nGenerated by tools/attribute_classes.py\n\n')
        f.write('Functions named FUN_*: %d. Machine-code evidence: %s.\n\n' % (len(fun), 'yes' if code else 'no'))
        f.write('| result | game code | library band / other |\n|---|---|---|\n')
        for t, label in (('known', 'class known from the name or RTTI'), ('A', 'attributed, tier A (measured precision >= 85%)'),
                         ('B', 'attributed, tier B (70-85%)'),
                         ('FA', 'family only, tier A (the class or a base/derived class of it, >= 85%)'),
                         ('FB', 'family only, tier B (70-85%)'), ('lib', 'looks like template/library code (not attributed to a game class)'),
                         ('none', 'no reliable evidence')):
            f.write('| %s | %d | %d |\n' % (label, cnt[(t, 'game')], cnt[(t, 'library band/other')]))
        f.write('\n## Calibration (hidden-label test)\n\nPrecision of each combination of evidence when 40% of the labelled functions are hidden:\n\n')
        f.write('| adjacency | thiscall callers | direct callers | kind | n | exact | exact or related | tier (exact / family) |\n|---|---|---|---|---|---|---|---|\n')
        for key, (c, fm, n) in sorted(table.items(), key=lambda kv: -kv[1][2]):
            if n >= 20:
                f.write('| %s | %s | %s | %s | %d | %.2f | %.2f | %s / %s |\n' % (key + (n, c / n, fm / n, tier_of(c / n, n) or '-', tier_of(fm / n, n) or '-')))
        per = collections.Counter(c for x, n, c, t, s, p, fam, ev in fun if t in ('A', 'B'))
        f.write('\n## Classes that gained the most functions\n\n')
        for c, k in per.most_common(40):
            f.write('- %s: %d\n' % (c, k))
    print('FUN_* functions: %d' % len(fun))
    for t in ('known', 'A', 'B', 'FA', 'FB', 'lib', 'none'):
        print('  %-6s game code %6d   library band/other %6d' % (t, cnt[(t, 'game')], cnt[(t, 'library band/other')]))
    print('wrote %s' % os.path.join(a.out, 'class_attribution.md'))


if __name__ == '__main__':
    sys.exit(main())
