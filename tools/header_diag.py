"""Compiles gen/decl_all.h + globals.h alone and prints each error with the offending line (header problems hide every
function error behind MSVC's 100-error limit, so they have to be clean first)."""
import os
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import toolchain

gen = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO_ROOT, 'gen')
limit = int(sys.argv[2]) if len(sys.argv) > 2 else 40
env = toolchain.get_env()
with open(os.path.join(gen, 'probe.c'), 'w') as f:
    f.write('#include "types_gen.h"\n#include "decl_all.h"\n#include "globals.h"\n')
text = toolchain.run_check('probe.c', gen, env)
files = {}
n = 0
for path, ln, kind, code, msg in toolchain.parse_errors(text):
    fn = os.path.basename(path)
    if kind == 'warning' or not fn.endswith('.h'):
        continue
    if fn not in files:
        files[fn] = open(os.path.join(gen, fn), encoding='utf-8', errors='ignore').read().split('\n')
    src = files[fn][ln - 1] if ln - 1 < len(files[fn]) else ''
    print(fn, ln, code, msg[:80], '|', src[:130])
    n += 1
    if n >= limit:
        break
print('errors shown:', n)
