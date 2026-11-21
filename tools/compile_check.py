"""Syntax-checks the generated C sources with MSVC (cl /Zs) and reports how much of the export is compilable.

Writes docs/generated/compile_report.json and compile_report.md:
  - functions with no reported error / total
  - histogram of error codes, and the most frequent undeclared identifiers (what the shim or globals.h still lacks)
Errors are attributed to functions through gen/functions.json (line ranges), so one broken function does not hide the rest.

Usage: python compile_check.py [--gen DIR] [--jobs N] [--limit FILES]
"""
import argparse
import collections
import concurrent.futures
import json
import os
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import toolchain


def check(env, gen, fname, target=None):
    return fname, toolchain.run_check(os.path.join(gen, 'src', fname), gen, env, target=target)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--gen', default=os.path.join(REPO_ROOT, 'gen'))
    ap.add_argument('--out', default=os.path.join(REPO_ROOT, 'docs', 'generated'))
    ap.add_argument('--jobs', type=int, default=8)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--fresh', action='store_true', help='forget the accumulated failed_functions list')
    ap.add_argument('--target', choices=['default', 'arm64'], default='default',
                    help='default: cl on Windows, clang i686 MinGW elsewhere; arm64: native Apple Silicon front end')
    a = ap.parse_args()
    funcs = json.load(open(os.path.join(a.gen, 'functions.json')))
    by_file = collections.defaultdict(list)
    for fu in funcs:
        by_file[fu['file']].append(fu)
    files = sorted(by_file)
    if a.limit:
        files = files[:a.limit]
    env = toolchain.get_env()
    codes = collections.Counter()
    undecl = collections.Counter()
    failed = set()
    header_errors = collections.Counter()
    fatal_files = []
    with concurrent.futures.ThreadPoolExecutor(a.jobs) as ex:
        for fname, text in ex.map(lambda f: check(env, a.gen, f, None if a.target == 'default' else a.target), files):
            ranges = by_file[fname]
            starts = [r['first'] for r in ranges]
            nerr = 0
            for ffile, ln, kind, code, msg in toolchain.parse_errors(text):
                if kind == 'warning':
                    continue
                if kind == 'fatal error':
                    fatal_files.append((fname, msg))
                if not os.path.basename(ffile) == fname:
                    header_errors[(os.path.basename(ffile), code)] += 1
                    continue          # error inside a shared header
                nerr += 1
                codes[code] += 1
                lo, hi = 0, len(ranges)
                while lo < hi:
                    mid = (lo + hi) // 2
                    if starts[mid] <= ln:
                        lo = mid + 1
                    else:
                        hi = mid
                if lo > 0 and ranges[lo - 1]['first'] <= ln <= ranges[lo - 1]['last']:
                    failed.add(ranges[lo - 1]['name'])
                nm = toolchain.undeclared_name(msg)
                if nm:
                    undecl[nm] += 1
            print('%s: %d errors' % (fname, nerr), flush=True)

    total = sum(len(by_file[f]) for f in files)
    ok = total - len([n for f in files for n in [fu['name'] for fu in by_file[f]] if n in failed])
    report = {'all_undeclared': dict(undecl), 'files': len(files), 'functions': total, 'functions_without_error': ok,
              'error_codes': codes.most_common(40), 'top_undeclared': undecl.most_common(60), 'fatal': fatal_files[:10]}
    os.makedirs(a.out, exist_ok=True)
    suffix = '_arm64' if a.target == 'arm64' else ''
    # failed functions accumulate across runs (a regeneration that stubs them would otherwise forget what it stubbed); --fresh resets
    fpath = os.path.join(a.out, 'failed_functions%s.txt' % suffix)
    prev = set(open(fpath).read().split()) if os.path.exists(fpath) and not a.fresh else set()
    print('new failing functions: %d' % len(failed - prev))
    with open(fpath, 'w') as ff:
        ff.write('\n'.join(sorted(prev | failed)) + '\n')
    json.dump(report, open(os.path.join(a.out, 'compile_report%s.json' % ('_arm64' if a.target == 'arm64' else '')), 'w'), indent=1)
    with open(os.path.join(a.out, 'compile_report%s.md' % ('_arm64' if a.target == 'arm64' else '')), 'w', encoding='utf-8') as f:
        f.write('# Compile check of the generated sources (%s, C mode)' % ('cl /Zs' if toolchain.IS_WINDOWS else 'clang --target=i686-w64-mingw32 -fsyntax-only') + '\n\n')
        f.write('Functions with no reported error: **%d of %d** (%.1f%%) across %d files\n\n' % (ok, total, 100.0 * ok / max(total, 1), len(files)))
        f.write('## Error codes\n\n')
        for c, n in codes.most_common(25):
            f.write('- %s: %d\n' % (c, n))
        f.write('\n## Most frequent undeclared identifiers\n\n')
        for c, n in undecl.most_common(40):
            f.write('- `%s`: %d\n' % (c, n))
        if fatal_files:
            f.write('\n## Fatal errors\n\n')
            for fn_, msg in fatal_files[:10]:
                f.write('- %s: %s\n' % (fn_, msg))
    print('functions without error: %d of %d' % (ok, total))
    if header_errors:
        print('header errors (summed over files):', header_errors.most_common(8))


if __name__ == '__main__':
    sys.exit(main())
