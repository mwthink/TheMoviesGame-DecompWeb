"""Turns the Ghidra export (decomp_*.c) into compilable-looking C sources plus shared headers.

Outputs (in --out, default gen/):
  types_gen.h       typedefs for the struct names / array return types the signatures and bodies refer to
  decl_all.h        prototype for every exported function (taken from its own signature line)
  src/decomp_N.c    one source per export file, each including ghidra_shim.h, types_gen.h, decl_all.h and globals.h
  functions.json    per function: name, address, output file and first/last line (used by compile_check.py)

The generator does only mechanical work: comment blocks are dropped, the signature is lifted into one line (and into a
prototype), calling conventions are kept as written (the shim maps __thiscall to __fastcall). Function bodies are
untouched except for: queued renames, C++ template arguments being dropped from type names, `::` becoming `__`,
Ghidra's `undefined1 [N]` array return types, and functions whose name collides with a type or a header symbol being
given a `_fn` suffix at their definition and at every call site.

Usage: python generate_sources.py [--repo PATH] [--out DIR] [--no-renames]
"""
import argparse
import csv
import json
import os
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import re
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import toolchain

HDR = re.compile(r'^//// FUNCTION (.+?) @ ([0-9a-fA-F]+) ////$')
ARR_RET = re.compile(r'\b(undefined\d?|byte|uchar|char)\s+\[(\d+)\]')
IDENT = re.compile(r'[A-Za-z_][A-Za-z0-9_]*')
KNOWN = set('''void char short int long float double signed unsigned const struct union enum bool byte uchar ushort uint ulong
undefined undefined1 undefined2 undefined3 undefined4 undefined5 undefined6 undefined7 undefined8 longlong ulonglong float10
code __cdecl __stdcall __fastcall __thiscall this size_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t
wchar_t dword errno_t FILE'''.split())
CAST_T = re.compile(r'\(\s*(?:const\s+)?([A-Za-z_]\w*)\s*\*+\s*\)')
DECL_T = re.compile(r'^\s+(?:const\s+)?([A-Z_][A-Za-z0-9_]*)\s*\*+\s*\w+\s*[;=\[]')
SIG_T = re.compile(r'(?:^|[,(]\s*)(?:const\s+)?([A-Za-z_]\w*)\s*\*+')
SIG_RET = re.compile(r'^\s*([A-Za-z_]\w*)\s*\*+\s*(?:__\w+\s+)?[A-Za-z_]\w*\s*\(')
SIG_VAL = re.compile(r'[,(]\s*([A-Za-z_]\w*)\s+(?:param_\d+|this)\b')
STACK_TMP = re.compile(r'\bstack0x[0-9a-fA-F]+\b')
UNDER_DAT = re.compile(r'(?<![A-Za-z0-9_])_((?:DAT|PTR_[A-Za-z]+|s|u)_[0-9a-zA-Z_]*[0-9a-fA-F]{8})\b')
PART_WRITE = re.compile(r'^(\s*)(\w+)\._(\d)_(\d)_\s*=\s*(.*);\s*$')
PART_READ = re.compile(r'\b(\w+)\._(\d)_(\d)_')


def part_write(m):
    ind, name, a, b, expr = m.group(1), m.group(2), int(m.group(3)), int(m.group(4)), m.group(5)
    mask = '0x%XULL' % ((1 << (8 * b)) - 1)
    return '%s%s = (%s & ~(%s << %d)) | (((uint64_t)(%s) & %s) << %d);' % (ind, name, name, mask, 8 * a, expr, mask, 8 * a)


def part_read(m):
    name, a, b = m.group(1), int(m.group(2)), int(m.group(3))
    return '((uint64_t)(%s >> %d) & 0x%XULL)' % (name, 8 * a, (1 << (8 * b)) - 1)
SEH_STATE = re.compile(r'^\s*(?:local_4|uStack_4)(?:\._\d_\d_)?\s*=\s*[^;]*;\s*$')
TEMPLATE = re.compile(r'([A-Za-z_][A-Za-z0-9_:]*)<[A-Za-z_][^<>()=;]*?>')


def strip_templates(text):
    prev = None
    while prev != text:
        prev = text
        text = TEMPLATE.sub(lambda m: m.group(1), text)
    return text

NARROW = re.compile(r'\b(float|char|short|bool|byte|uchar|ushort|undefined1|undefined2|int8_t|uint8_t|int16_t|uint16_t|bool8|_Bool|'
                    r'WORD|BYTE|BOOLEAN|CHAR|SHORT|FLOAT|wchar_t|WCHAR|ATOM)\b')


def loose_decl(sig_text):
    """Prototype for decl_all.h. MSVC only warns when a call passes a different number of arguments than the function's
    (Ghidra-inferred) signature has; clang errors. Where the parameters survive default argument promotion, declare the
    function unprototyped, `T f();`, so the definition below still checks against it but call sites are not counted."""
    if re.search(r'__(cdecl|stdcall|fastcall|thiscall)', sig_text):
        return sig_text       # clang does not allow a calling convention on an unprototyped declaration
    i = sig_text.find('(')
    while i > 0 and sig_text[:i].rstrip().endswith('operator'):
        i = sig_text.find('(', i + 2)
    # the parameter list is the first parenthesised group whose name part is a plain identifier (skip `(*name)(...)` returns)
    j = i
    depth = 0
    for j in range(i, len(sig_text)):
        depth += sig_text[j] == '('
        depth -= sig_text[j] == ')'
        if depth == 0:
            break
    params = sig_text[i + 1:j]
    if i < 0 or sig_text[j + 1:].strip() or '(' in params or '...' in params:
        return sig_text
    for p in params.split(','):
        if NARROW.search(p) and '*' not in p:
            return sig_text
    return sig_text[:i] + '()'

CALL = re.compile(r'(?<![\w.>])([A-Za-z_]\w*)\s*\(')
FN_PTR_CALL = re.compile(r'\(\*((?:DAT|PTR)_\w+)\)\s*\(')


def scan_calls(src_dir):
    """Identifiers used as callees (so an unknown one must be declared as a function), and DAT_/PTR_ globals that are called
    through `(*DAT_x)(...)` (import address table slots and function pointer variables)."""
    called, fn_ptrs = set(), set()
    for fn in os.listdir(src_dir):
        text = open(os.path.join(src_dir, fn), encoding='utf-8', errors='ignore').read()
        called.update(CALL.findall(text))
        fn_ptrs.update(FN_PTR_CALL.findall(text))
    return called, fn_ptrs


def retype_fn_pointers(globals_h, names):
    """globals.h types these slots by a vote over casts (`uint32_t *`); a call through them needs a function pointer."""
    if not names or not os.path.exists(globals_h):
        return
    out = []
    rx = re.compile(r'^extern\s+[^;(]*?\b(\w+)(?:\[\d*\])?;(.*)$')
    for line in open(globals_h, encoding='utf-8', errors='ignore').read().split('\n'):
        m = rx.match(line)
        if m and m.group(1) in names:
            line = 'extern code *%s;%s' % (m.group(1), m.group(2))
        out.append(line)
    open(globals_h, 'w', encoding='utf-8', newline='\n').write('\n'.join(out))


def type_clean(text):
    text = strip_templates(text)
    return re.sub(r'(?<=[A-Za-z0-9_])::(?=[A-Za-z_~])', '__', text)


def apply_renames(repo):
    ren = os.path.join(repo, 'renames.csv')
    m = {}
    if os.path.exists(ren):
        for r in csv.DictReader(open(ren, newline='', encoding='utf-8', errors='ignore')):
            try:
                m[r['old_name']] = r['new_name']
            except KeyError:
                pass
    return m


def split_functions(path):
    cur, buf = None, []
    for line in open(path, encoding='utf-8', errors='ignore'):
        line = line.rstrip('\n')
        m = HDR.match(line)
        if m:
            if cur:
                yield cur, buf
            cur, buf = (m.group(1), m.group(2)), []
        elif cur:
            buf.append(line)
    if cur:
        yield cur, buf


def is_library(body):
    return any(l.startswith('/* Library Function') for l in body[:6])


def extract_sig(body):
    sig, k, in_comment = [], 0, False
    while k < len(body) and not (body[k].strip() == '{' and not in_comment):
        s = body[k].strip()
        if in_comment:
            if '*/' in s:
                in_comment = False
        elif s.startswith('/*'):
            if '*/' not in s:
                in_comment = True
        elif s:
            sig.append(s)
        k += 1
    return sig, k


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', default=REPO_ROOT)
    ap.add_argument('--out', default=os.path.join(REPO_ROOT, 'gen'))
    ap.add_argument('--tools', default=os.path.join(REPO_ROOT, 'tools'))
    ap.add_argument('--globals', default=os.path.join(REPO_ROOT, 'docs', 'generated', 'globals.h'))
    ap.add_argument('--no-renames', action='store_true')
    ap.add_argument('--stub-from', help='file with one function name per line (compile_check\'s failed_functions*.txt): '
                    'their bodies are replaced by GHIDRA_STUB() so every source compiles to object code')
    a = ap.parse_args()

    exp = os.path.join(a.repo, 'data', 'ExportDecompiled')
    files = sorted(f for f in os.listdir(exp) if f.startswith('decomp_') and f.endswith('.c'))
    os.makedirs(os.path.join(a.out, 'src'), exist_ok=True)
    shutil.copy(os.path.join(a.tools, 'ghidra_shim.h'), os.path.join(a.out, 'ghidra_shim.h'))
    if os.path.exists(a.globals):
        shutil.copy(a.globals, os.path.join(a.out, 'globals.h'))
    stubs = set(open(a.stub_from).read().split()) if a.stub_from else set()
    stubbed = []
    emitted = set()
    renames = {} if a.no_renames else apply_renames(a.repo)
    rename_re = re.compile(r'\b(' + '|'.join(re.escape(k) for k in sorted(renames, key=len, reverse=True)) + r')\b') if renames else None
    defined = toolchain.header_words(a.out)
    defined -= {'locale'}     # appears in system headers only as a parameter name; Ghidra means std::locale

    # ---- pass 1: function names, type names referenced
    library = []
    func_names = {}      # header name (after renames) -> safe identifier
    unknown_types = set()
    arr_types = set()
    for fn in files:
        for (name, addr), body in split_functions(os.path.join(exp, fn)):
            if is_library(body):
                library.append((addr, name))
                continue
            nm = renames.get(name, name)
            func_names[nm] = nm
            sig, k = extract_sig(body)
            sig_text = type_clean(' '.join(sig))
            for m in ARR_RET.finditer(sig_text):
                arr_types.add((m.group(1), m.group(2)))
            sig_text = ARR_RET.sub(lambda m: 'x', sig_text)
            for rx in (SIG_T, SIG_RET, SIG_VAL):
                for m in rx.finditer(sig_text):
                    unknown_types.add(m.group(1))
            for l in body[k:]:
                l2 = type_clean(l)
                for rx in (CAST_T, DECL_T):
                    for m in rx.finditer(l2):
                        if m.group(1)[:1].isupper() or m.group(1)[:1] == '_':
                            unknown_types.add(m.group(1))
    unknown_types = {t for t in unknown_types if t not in KNOWN and not t.startswith(('param_', 'ghidra_arr_', 'DAT_', 'PTR_', '_DAT_', 'switchD_', 'caseD_'))}
    unknown_types -= defined
    # a function whose name equals a type name (constructors, ...) or a header symbol is renamed with a suffix
    clash = {n for n in func_names if n in unknown_types or n in defined}
    for n in list(func_names):
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', n):
            func_names[n] = 'cxx_' + re.sub(r'[^A-Za-z0-9_]', '_', n)[:100]
    for n in clash:
        if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', n):
            func_names[n] = n + '_fn'
    call_map = {k: v for k, v in func_names.items() if k != v}
    clash_map = {k: v for k, v in call_map.items() if k in clash and v.endswith('_fn')}
    other_map = {k: v for k, v in call_map.items() if k not in clash_map}

    def mk(mp, tail):
        if not mp:
            return None
        return re.compile(r'(?<![A-Za-z0-9_:~.>])(' + '|'.join(re.escape(k) for k in sorted(mp, key=len, reverse=True)) + r')' + tail)

    call_re = mk(other_map, r'(?![A-Za-z0-9_])')
    clash_re = mk(clash_map, r'(?=\s*\()')
    print('functions: %d, renamed to safe names: %d (type/header clashes: %d), struct typedefs: %d' % (len(func_names), len(call_map), len(clash), len(unknown_types)))

    def fix(text):
        if rename_re:
            text = rename_re.sub(lambda m: renames[m.group(1)], text)
        text = type_clean(text)
        text = ARR_RET.sub(lambda m: 'ghidra_arr_%s_%s' % (m.group(1), m.group(2)), text)
        if call_re:
            text = call_re.sub(lambda m: other_map[m.group(1)], text)
        if clash_re:
            text = clash_re.sub(lambda m: clash_map[m.group(1)], text)
        text = STACK_TMP.sub('ghidra_stack_arg[0]', text)
        text = UNDER_DAT.sub(lambda m: m.group(1), text)
        if '._' in text:
            if PART_WRITE.match(text):
                text = PART_WRITE.sub(part_write, text)
            text = PART_READ.sub(part_read, text)
        return text

    decls, funcs = [], []
    CHUNK = 120   # functions per output file: keeps MSVC's 100-error limit from hiding later functions

    def new_unit(fn, idx):
        return ['/* generated from %s (part %d) by tools/generate_sources.py - do not edit */' % (fn, idx),
                '#include "../ghidra_shim.h"', '#include "../types_gen.h"', '#include "../decl_all.h"',
                '#include "../globals.h"', '#include "../globals_extra.h"', '']

    def write_unit(fn, idx, lines):
        with open(os.path.join(a.out, 'src', '%s_%02d.c' % (fn[:-2], idx)), 'w', encoding='utf-8', newline='\n') as f:
            f.write('\n'.join(lines) + '\n')

    for fn in files:
        part, in_part = 0, 0
        lines_out = new_unit(fn, part)
        for (name, addr), body in split_functions(os.path.join(exp, fn)):
            if is_library(body):
                continue
            sig, k = extract_sig(body)
            if not sig or k >= len(body):
                continue
            nm = renames.get(name, name)
            cname = func_names.get(nm, nm)
            if cname in emitted:
                cname = '%s_%s' % (cname, addr)      # the export holds two functions with this name (e.g. CAsset_OnPlaced)
            emitted.add(cname)
            sig_text = fix(' '.join(sig))
            # replace the name the signature prints by the safe identifier
            mcc = re.search(r'(__cdecl|__stdcall|__fastcall|__thiscall)\s+', sig_text)
            if mcc:
                rest = sig_text[mcc.end():]
                par = rest.find('(')
                while par > 0 and rest[:par].rstrip().endswith('operator'):
                    par = rest.find('(', par + 2)
                if par > 0:
                    sig_text = sig_text[:mcc.end()] + cname + ' ' + rest[par:]
            else:
                mnm = re.match(r'^(.*?)([^\s(*]+)\s*\(', sig_text)
                if mnm:
                    sig_text = mnm.group(1) + cname + sig_text[mnm.end(2):]
            # Ghidra often types functions as void although callers use the value left in EAX: widen every plain
            # `void` return to a 32-bit value (harmless for true void functions).
            sig_text = re.sub(r'^void(?!\s*\*)', 'undefined4', sig_text)
            decls.append((sig_text.rstrip() if toolchain.IS_WINDOWS else loose_decl(sig_text.rstrip())) + ';')
            start = len(lines_out) + 1
            lines_out.append(sig_text)
            has_seh = any('ExceptionList' in l for l in body[k:k + 40])
            if cname in stubs:
                lines_out.extend(['{', '  GHIDRA_STUB();', '}'])
                stubbed.append((addr, cname))
            else:
                for l in body[k:]:
                    if has_seh and SEH_STATE.match(l):
                        continue          # try-level bookkeeping of the compiler-generated SEH frame
                    lines_out.append(fix(l))
            funcs.append({'name': cname, 'addr': addr, 'file': '%s_%02d.c' % (fn[:-2], part), 'first': start, 'last': len(lines_out)})
            lines_out.append('')
            in_part += 1
            if in_part >= CHUNK:
                write_unit(fn, part, lines_out)
                part, in_part = part + 1, 0
                lines_out = new_unit(fn, part)
        if in_part:
            write_unit(fn, part, lines_out)

    with open(os.path.join(a.out, 'types_gen.h'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('/* generated: incomplete struct typedefs for names the signatures and bodies refer to */\n#pragma once\n#include "ghidra_shim.h"\n\n')
        for base, n in sorted(arr_types):
            f.write('typedef struct { uint8_t b[%s]; } ghidra_arr_%s_%s;\n' % (n, base, n))
        for t in sorted(unknown_types):
            if re.fullmatch(r'(?:LP|P)[A-Z][A-Z0-9_]+', t):
                f.write('typedef void *%s;\n' % t)          # Win32 pointer typedef (LPUNKNOWN, PIMAGE_...): by-value use must be complete
            else:
                f.write('typedef struct %s %s;\n' % (t, t))
    with open(os.path.join(a.out, 'decl_all.h'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('/* generated: prototypes of every exported function */\n#pragma once\n#include "ghidra_shim.h"\n#include "types_gen.h"\n\n')
        seen = set()
        for d in decls:
            if d not in seen:
                seen.add(d)
                f.write(d + '\n')
    with open(os.path.join(a.out, 'stubbed_functions.csv'), 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(['address', 'name'])
        w.writerows(sorted(stubbed))
    with open(os.path.join(a.out, 'library_functions.csv'), 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(['address', 'name'])
        w.writerows(sorted(library))
    # Identifiers the previous compile check could not resolve (renamed data labels, RTTI descriptors, code labels) are
    # declared here as externs; the type is a guess by name shape. Run compile_check.py, then this script again.
    shim_macros = set(re.findall(r'^#\s*define\s+(\w+)', open(os.path.join(a.out, 'ghidra_shim.h')).read(), re.M))
    called, fn_ptr_globals = scan_calls(os.path.join(a.out, 'src'))
    extra = {}
    gen_dir = os.path.dirname(os.path.abspath(a.globals))
    known_path = os.path.join(gen_dir, 'extra_externs.json')
    if os.path.exists(known_path):
        extra = {k: 1 for k in json.load(open(known_path))}
    rep = os.path.join(gen_dir, 'compile_report.json')
    if os.path.exists(rep):
        for k, v in json.load(open(rep)).get('all_undeclared', {}).items():
            extra[k] = extra.get(k, 0) + v
    json.dump(sorted(extra), open(known_path, 'w'))
    with open(os.path.join(a.out, 'globals_extra.h'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('/* generated from the last compile_report.json: externs for identifiers the headers did not declare */\n#pragma once\n#include "ghidra_shim.h"\n\n')
        for nm in sorted(extra):
            if nm.startswith(('stack0x', 'param_', 'local_', 'unaff_', 'extraout_', 'in_')) or not IDENT.fullmatch(nm):
                continue
            if nm in func_names.values() or nm in defined or nm in shim_macros:
                continue
            if nm.startswith('LAB_'):
                f.write('extern void %s(void);\n' % nm)
            elif nm in called:
                f.write('extern uint32_t %s();\n' % nm)       # CRT / thunk name that is called but has no export entry
            elif 'RTTI' in nm or nm.startswith(('lpCaption_', 'lpType_', 'DAT_', 'PTR_', 's_', 'u_')):
                f.write('extern uint8_t %s[];\n' % nm)
            else:
                f.write('extern uint32_t %s;\n' % nm)
    retype_fn_pointers(os.path.join(a.out, 'globals.h'), fn_ptr_globals)
    with open(os.path.join(a.out, 'functions.json'), 'w', encoding='utf-8') as f:
        json.dump(funcs, f)
    print('source files: %d, functions emitted: %d, array types: %d' % (len(files), len(funcs), len(arr_types)))
    if not toolchain.IS_WINDOWS:
        import win32_slice
        win32_slice.main(['--gen', a.out])      # gen/win32_compat.h for the arm64 build


if __name__ == '__main__':
    sys.exit(main())
