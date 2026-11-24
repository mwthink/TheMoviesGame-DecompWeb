#!/usr/bin/env python3
"""Which game callbacks do the UI movies call? (docs/FRONTEND.md)

The .mfl files in data\\ui\\flash\\ are ordinary SWF files (signature FWS, versions 4 to 6) with another extension. This reads
the names out of them (ActionScript constant strings) and lists, per movie, the Extern* / cb_* / AddOn* names it contains.
  python3 tools/pak_extract.py extract <Data/pak dir> data/pak_ui '*.mfl' --tree
  python3 tools/mfl_callbacks.py data/pak_ui [name ...]      # extra names to look for, e.g. the registered callbacks
Only strings are read; the ActionScript bytecode itself is not decoded, so this says which names a movie mentions, not how it uses them."""
import glob, os, re, sys

def names(path):
    d = open(path, 'rb').read()
    return d[:4], set(m.group().decode() for m in re.finditer(rb'[A-Za-z_$][A-Za-z0-9_$ ]{3,40}', d)), len(d)

def main(root, extra):
    movies = {os.path.basename(f): names(f) for f in sorted(glob.glob(os.path.join(root, '**', '*.mfl'), recursive=True))}
    print('%d movies; signatures %s' % (len(movies), sorted({m[0] for m in movies.values()})))
    for name, (sig, strs, size) in movies.items():
        hit = sorted(s for s in strs if s.startswith(('Extern', 'cb_', 'AddOn')) or s in extra)
        if hit:
            print('%-24s %6d B  %s' % (name, size, ', '.join(hit)))
    for e in extra:
        if not any(e in m[1] for m in movies.values()):
            print('not in any movie:', e)

if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2:])
