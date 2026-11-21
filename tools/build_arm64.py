"""Apple Silicon build of the generated C: sources -> arm64 Mach-O objects -> static library.

    python3 tools/build_arm64.py [--fresh] [--jobs N] [--opt -O0|-O1]

1. generate_sources.py (stubbing every function listed in docs/generated/failed_functions_arm64.txt),
2. compile_check.py --target arm64: functions that still fail are added to that list; repeat until nothing new fails,
3. compile every gen/src/*.c to build/arm64/*.o and archive them into build/arm64/libthemovies.a,
4. write build/arm64/symbols.txt: how many symbols the library defines and which it still needs from elsewhere.

A "stubbed" function keeps its signature and address in the listing but its body is a trap (GHIDRA_STUB): it compiled-out
because the decompiler output for it is not valid C yet. The list is gen/stubbed_functions.csv.
This is a build of the code, not a runnable game: pointers are 64-bit here while the code stores them in 32-bit ints.
"""
import argparse
import concurrent.futures
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import toolchain

FAILED = os.path.join(REPO, 'docs', 'generated', 'failed_functions_arm64.txt')


def run(cmd):
    print('+', ' '.join(cmd)[:160], flush=True)
    r = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
    sys.stdout.write(r.stdout[-1500:] if r.stdout else '')
    if r.returncode:
        sys.stderr.write(r.stderr[-3000:])
        raise SystemExit(r.returncode)
    return r.stdout


def compile_one(args):
    src, obj, opt = args
    r = subprocess.run(toolchain.arm64_cmd(src, os.path.join(REPO, 'gen'), obj, [opt]), capture_output=True, text=True)
    return src, r.returncode, r.stderr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fresh', action='store_true', help='forget which functions were stubbed and start from the raw export')
    ap.add_argument('--jobs', type=int, default=os.cpu_count() or 4)
    ap.add_argument('--opt', default='-O0')
    a = ap.parse_args()
    if a.fresh and os.path.exists(FAILED):
        os.remove(FAILED)
    for rnd in range(1, 6):
        gen = [sys.executable, 'tools/generate_sources.py']
        if os.path.exists(FAILED):
            gen += ['--stub-from', FAILED]
        run(gen)
        out = run([sys.executable, 'tools/compile_check.py', '--target', 'arm64', '--jobs', str(a.jobs)])
        new = [l for l in out.splitlines() if l.startswith('new failing functions')]
        print('round %d: %s' % (rnd, new[-1] if new else '?'))
        if new and new[-1].endswith(' 0'):
            break
    else:
        raise SystemExit('still finding failing functions after 5 rounds')

    gen_src = os.path.join(REPO, 'gen', 'src')
    build = os.path.join(REPO, 'build', 'arm64')
    os.makedirs(build, exist_ok=True)
    jobs = [(os.path.join(gen_src, f), os.path.join(build, f[:-2] + '.o'), a.opt) for f in sorted(os.listdir(gen_src)) if f.endswith('.c')]
    bad = 0
    with concurrent.futures.ThreadPoolExecutor(a.jobs) as ex:
        for src, rc, err in ex.map(compile_one, jobs):
            if rc:
                bad += 1
                print('FAILED', os.path.basename(src), err[-600:])
    print('compiled %d of %d sources to object code' % (len(jobs) - bad, len(jobs)))
    if bad:
        raise SystemExit(1)
    lib = os.path.join(build, 'libthemovies.a')
    if os.path.exists(lib):
        os.remove(lib)
    run(['libtool', '-static', '-o', lib] + [j[1] for j in jobs])
    defined = subprocess.run(['nm', '-g', '--defined-only', lib], capture_output=True, text=True).stdout.splitlines()
    undef = subprocess.run(['nm', '-u', lib], capture_output=True, text=True).stdout.splitlines()
    dnames = {l.split()[-1] for l in defined if len(l.split()) >= 3}
    unames = sorted({l.split()[-1] for l in undef if l.strip() and not l.endswith(':')} - dnames)
    with open(os.path.join(build, 'symbols.txt'), 'w') as f:
        f.write('defined: %d\nundefined (needed from elsewhere): %d\n\n' % (len(dnames), len(unames)))
        f.write('\n'.join(unames) + '\n')
    size = os.path.getsize(lib) / 1e6
    print('%s: %.1f MB, %d symbols defined, %d still undefined (see build/arm64/symbols.txt)' % (lib, size, len(dnames), len(unames)))


if __name__ == '__main__':
    main()
