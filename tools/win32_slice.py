"""Builds gen/win32_compat.h: the slice of the Win32/CRT headers that the generated sources use, in a form a 64-bit
Mach-O (arm64 macOS) compile accepts.

There is no windows.h on macOS, and MinGW's headers cannot be used as they are with an arm64-apple-macos target:
Windows is LLP64 (`long` is 32 bits, so DWORD, LONG, ULONG are 32 bits) while macOS is LP64. So this script
  1. preprocesses ghidra_shim.h with clang --target=i686-w64-mingw32 (so every size is the 32-bit Windows one),
  2. splits the result into top-level declarations and indexes the names each one declares,
  3. keeps the declarations reachable from the identifiers the sources use, skipping names the macOS libc headers
     already declare (size_t, FILE, va_list, ...),
  4. rewrites `long` to `int` (`long long` is left alone) and keeps #pragma pack state,
and writes the result. Function bodies (static inline helpers) are dropped; the prototypes are kept.

Usage: python win32_slice.py [--gen DIR]
"""
import argparse
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import toolchain

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN = re.compile(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|[A-Za-z_]\w*|\d[\w.]*|\.\.\.|->|<<=|>>=|[{}()\[\];,*=]|\S')
IDENT = re.compile(r'[A-Za-z_]\w*')
ATTR = ('__attribute__', '__declspec', '__asm', '__asm__')
KEYWORDS = set('''typedef struct union enum const volatile unsigned signed int char short long float double void extern static inline
__inline __inline__ register restrict __restrict __restrict__ _Bool _Complex __int64 __int32 __int16 __int8 sizeof'''.split())


def preprocess(target, shim_dir, source):
    """Preprocessed text of `source` (a string) with the given clang base command."""
    return subprocess.run(target + ['-E', '-x', 'c', '-w', '-I', shim_dir, '-'], input=source, capture_output=True, text=True).stdout


def strip_attrs(toks):
    """Drop __attribute__((...)) / __declspec(...) groups."""
    out, i = [], 0
    while i < len(toks):
        if toks[i] in ATTR and i + 1 < len(toks) and toks[i + 1] == '(':
            depth = 0
            i += 1
            while i < len(toks):
                depth += toks[i] == '('
                depth -= toks[i] == ')'
                i += 1
                if depth == 0:
                    break
            continue
        out.append(toks[i])
        i += 1
    return out


def split_decls(text):
    """Yield (tokens, pack) for every top-level declaration; pack is the #pragma pack value in force (None = default)."""
    pack, stack = None, []
    cur, depth, braces = [], 0, 0
    last_close_paren_body = False
    decls = []
    for line in text.split('\n'):
        s = line.strip()
        if s.startswith('#'):
            m = re.match(r'#\s*pragma\s+pack\s*\(\s*(.*?)\s*\)', s)
            if m:
                args = [a.strip() for a in m.group(1).split(',') if a.strip()]
                def val(a):
                    return int(a) if a.isdigit() else 8
                if args and args[0] == 'push':
                    stack.append(pack)
                    if len(args) > 1:
                        pack = val(args[1])
                elif args and args[0] == 'pop':
                    pack = stack.pop() if stack else None
                elif args:
                    pack = val(args[0])
                else:
                    pack = None
            continue
        for t in TOKEN.findall(line):
            if t == '{':
                # `) {` is a function body: skip it up to the matching brace
                if depth == 0 and braces == 0 and cur and cur[-1] == ')':
                    last_close_paren_body = True
                braces += 1
                cur.append(t)
                continue
            if t == '}':
                braces -= 1
                cur.append(t)
                if braces == 0 and last_close_paren_body:
                    last_close_paren_body = False
                    decls.append((None, pack))      # function definition: dropped
                    cur = []
                continue
            if t == '(' or t == '[':
                depth += 1
            elif t == ')' or t == ']':
                depth -= 1
            cur.append(t)
            if t == ';' and braces == 0 and depth <= 0:
                depth = 0
                decls.append((cur, pack))
                cur = []
    return [d for d in decls if d[0]]


def declared_names(toks):
    """Names (typedef names, tags, enumerators, functions, variables) a declaration introduces."""
    toks = strip_attrs(toks)
    names = set()
    is_typedef = bool(toks) and toks[0] == 'typedef'
    # tags and enumerators
    i = 0
    flat, depth = [], 0
    while i < len(toks):
        t = toks[i]
        if t in ('struct', 'union', 'enum') and i + 1 < len(toks) and IDENT.fullmatch(toks[i + 1]) and toks[i + 1] not in KEYWORDS:
            names.add(toks[i + 1])
        if t == '{':
            # find the matching brace; enumerators are the first identifier of each comma item at depth 1
            j, d = i, 0
            while j < len(toks):
                d += toks[j] == '{'
                d -= toks[j] == '}'
                if d == 0:
                    break
                j += 1
            head = toks[max(0, i - 3):i]
            if 'enum' in head:
                item_start = True
                dd = 0
                for k in range(i + 1, j):
                    x = toks[k]
                    if x in '([{':
                        dd += 1
                    elif x in ')]}':
                        dd -= 1
                    if dd == 0 and x == ',':
                        item_start = True
                    elif item_start and IDENT.fullmatch(x):
                        names.add(x)
                        item_start = False
            flat.append('{}')
            i = j + 1
            continue
        flat.append(t)
        i += 1
    # declarators: split at top-level commas, take the declared identifier of each
    decl_list, cur, d = [], [], 0
    for t in flat:
        if t in '([':
            d += 1
        elif t in ')]':
            d -= 1
        if t == ',' and d == 0:
            decl_list.append(cur)
            cur = []
        else:
            cur.append(t)
    decl_list.append(cur)
    for n, dl in enumerate(decl_list):
        dl = [t for t in dl if t != ';']
        name = None
        for k in range(len(dl) - 2):                       # (*name)(...) function pointer
            if dl[k] == '(' and dl[k + 1] == '*' and IDENT.fullmatch(dl[k + 2]) and dl[k + 2] not in KEYWORDS:
                name = dl[k + 2]
                break
        if name is None:
            d = 0
            for k, t in enumerate(dl):
                if t == '(' and d == 0 and k > 0 and IDENT.fullmatch(dl[k - 1]) and dl[k - 1] not in KEYWORDS:
                    name = dl[k - 1]                       # prototype: identifier before the first parameter list
                    break
                if t == '=':
                    break
            if name is None:
                cand = [t for k, t in enumerate(dl) if IDENT.fullmatch(t) and t not in KEYWORDS]
                # stop at '[' (array dims) and '=' (initialiser)
                end = len(dl)
                for k, t in enumerate(dl):
                    if t in ('[', '='):
                        end = k
                        break
                cand = [t for t in dl[:end] if IDENT.fullmatch(t) and t not in KEYWORDS]
                name = cand[-1] if cand else None
        if name and (n > 0 or is_typedef or len(dl) > 1):
            names.add(name)
    return names


def index_text(text):
    decls = split_decls(text)
    by_name = {}
    info = []
    for n, (toks, pack) in enumerate(decls):
        names = declared_names(toks)
        words = set(IDENT.findall(' '.join(toks))) - names
        info.append((toks, pack, names, words))
        for nm in names:
            by_name.setdefault(nm, []).append(n)
    return info, by_name


def fix_long(toks):
    out = []
    for i, t in enumerate(toks):
        if t == 'long':
            prev = out[-1] if out else ''
            nxt = toks[i + 1] if i + 1 < len(toks) else ''
            if prev == 'long' or nxt in ('long', 'double'):
                out.append(t)
            else:
                out.append('int')
        else:
            out.append(t)
    return out


def render(toks):
    s = ''
    for t in toks:
        if t in ('{', '}', ';'):
            s += ' ' + t + ('\n' if t != '{' else '')
        else:
            s += ' ' + t
    return s.strip() + ('\n' if not s.endswith('\n') else '')


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--gen', default=os.path.join(REPO_ROOT, 'gen'))
    a = ap.parse_args(argv)
    src_words = set()
    src_dir = os.path.join(a.gen, 'src')
    for fn in os.listdir(src_dir):
        src_words.update(IDENT.findall(open(os.path.join(src_dir, fn), encoding='utf-8', errors='ignore').read()))
    # the generated headers define their own names: those must not come from the Windows slice
    own = set()
    for h in ('decl_all.h', 'types_gen.h', 'globals.h', 'globals_extra.h'):
        own.update(index_text(open(os.path.join(a.gen, h), encoding='utf-8', errors='ignore').read())[1])

    win = preprocess(toolchain.clang_base(), a.gen, '#include "ghidra_shim.h"\n')
    win_info, win_index = index_text(win)

    mac = subprocess.run(['clang', '--target=arm64-apple-macos', '-E', '-x', 'c', '-w', '-'], capture_output=True, text=True,
                         input='#include <stdint.h>\n#include <stddef.h>\n#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n'
                               '#include <time.h>\n#include <math.h>\n#include <stdbool.h>\n#include <stdarg.h>\n#include <wchar.h>\n'
                               '#include <ctype.h>\n#include <locale.h>\n#include <errno.h>\n#include <setjmp.h>\n#include <signal.h>\n').stdout
    mac_info, mac_index = index_text(mac)
    provided = set(mac_index)

    # names the Ghidra shim itself defines (Ghidra pseudo types) must not be re-declared either
    shim = open(os.path.join(a.gen, 'ghidra_shim.h'), encoding='utf-8', errors='ignore').read()
    shim_defined = set(index_text(shim)[1])
    skip = provided | shim_defined

    wanted = {w for w in src_words if w in win_index and w not in skip and w not in own}
    keep, work = set(), list(wanted)
    while work:
        nm = work.pop()
        for di in win_index.get(nm, []):
            if di in keep or win_info[di][2] & skip:
                continue          # (a declaration that also declares a name macOS provides, like `typedef struct _iobuf FILE`, is dropped)
            keep.add(di)
            for w in win_info[di][3]:
                if w in win_index and w not in skip and w not in own:
                    work.append(w)
    out = ['/* generated by tools/win32_slice.py: the Win32/CRT declarations the generated sources use, with Windows (32-bit)',
           ' * type sizes: `long` is rewritten to `int`. Included by ghidra_shim.h when the target is not Windows. */',
           '#pragma once', '']
    cur_pack = None
    for di in sorted(keep):
        toks, pack, names, words = win_info[di]
        if pack != cur_pack:
            out.append('#pragma pack(%s)' % ('' if pack is None else pack))
            cur_pack = pack
        out.append(render(fix_long(strip_attrs(toks))).rstrip('\n'))
    if cur_pack is not None:
        out.append('#pragma pack()')
    path = os.path.join(a.gen, 'win32_compat.h')
    open(path, 'w', encoding='utf-8', newline='\n').write('\n'.join(out) + '\n')
    print('win32_compat.h: %d declarations, %d seed names, %d names skipped as provided by macOS headers' %
          (len(keep), len(wanted), len(wanted & provided)))


if __name__ == '__main__':
    main()
