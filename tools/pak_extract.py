"""List and extract files from The Movies .pak archives (no game tools needed, works on macOS/Linux).

Format as read from the archives (version 5):
  header   u32 version(5), u32 end, u32 0, u32 file count, u32 256, u32 dir count, u32 ?, u32 0, u32 0, u32 0,
           u32 entry table offset (0x34), u32 directory index offset, u32 directory name table offset
  entry    56 bytes at entry table + 56*i: u32, u32 (look like hashes), u32 chunk offset, u32 chunk compressed size,
           u32 uncompressed size, u32 flags, char name[32] (zero padded; names of 32+ characters are cut off here)
  chunk    at the chunk offset: u32 chunk size, u32 uncompressed size, u32, u32 stored flag (1: raw bytes follow, 0: a zlib stream)
The directory of an entry (data\\scene\\...) is not resolved here: names are matched on the 32-character file name.

Usage:
  python3 tools/pak_extract.py list   <Data/pak dir or .pak> [glob]
  python3 tools/pak_extract.py extract <Data/pak dir or .pak> <out dir> <glob> [<glob> ...]

When several archives hold the same name (the Addon_* archives patch earlier files) the archive with the newest file date wins.
Two files of the same name inside one archive (different directories) are written as name and name.2 in archive order. Extracted game files are game assets: keep them under data/ (gitignored).
"""
import fnmatch
import os
import struct
import sys
import zlib


def read_entries(path):
    with open(path, 'rb') as f:
        head = f.read(0x34)
        if len(head) < 0x34:
            return []
        version, _end, _z, count = struct.unpack_from('<4I', head, 0)
        if version not in (5, 6):
            sys.stderr.write('skipping %s: unsupported pak version %d\n' % (os.path.basename(path), version))
            return []
        table = struct.unpack_from('<I', head, 0x28)[0]
        f.seek(table)
        raw = f.read(56 * count)
    entries = []
    for i in range(count):
        e = raw[i * 56:(i + 1) * 56]
        _h1, _h2, off, comp, size, flags = struct.unpack_from('<6I', e, 0)
        name = e[24:56].split(b'\0')[0].decode('latin-1')
        entries.append((name, off, comp, size, flags))
    return entries


def read_file(path, entry):
    name, off, comp, size, _flags = entry
    with open(path, 'rb') as f:
        f.seek(off)
        chunk = f.read(16 + comp)
    total, u, _stream, stored = struct.unpack_from('<4I', chunk, 0)
    if stored == 1:                          # small files are stored as they are
        data = chunk[16:16 + u]
    else:                                    # otherwise a zlib stream
        data = zlib.decompressobj().decompress(chunk[16:])
    if len(data) != u:
        raise ValueError('%s: size mismatch (%d, expected %d)' % (name, len(data), u))
    return data


def paks(arg):
    if os.path.isdir(arg):
        files = [os.path.join(arg, n) for n in os.listdir(arg) if n.lower().endswith('.pak')]
        return sorted(files, key=lambda p: (os.path.getmtime(p), p))
    return [arg]


def main(argv):
    if len(argv) < 3 or argv[1] not in ('list', 'extract'):
        print(__doc__)
        return 2
    cmd, src = argv[1], argv[2]
    if cmd == 'list':
        pats = [p.lower() for p in argv[3:]] or ['*']
        for p in paks(src):
            for e in read_entries(p):
                if any(fnmatch.fnmatch(e[0].lower(), pat) for pat in pats):
                    print('%s\t%s\t%d bytes' % (os.path.basename(p), e[0], e[3]))
        return 0
    out, pats = argv[3], [p.lower() for p in argv[4:]]
    chosen = {}
    for p in paks(src):                      # later archives override earlier ones
        seen = {}                            # several files of one archive can share a name (different directories)
        for e in read_entries(p):
            if any(fnmatch.fnmatch(e[0].lower(), pat) for pat in pats):
                seen[e[0].lower()] = seen.get(e[0].lower(), 0) + 1
                chosen[(e[0].lower(), seen[e[0].lower()])] = (p, e)
    os.makedirs(out, exist_ok=True)
    for (key, n), (p, e) in sorted(chosen.items()):
        data = read_file(p, e)
        target = e[0] if n == 1 else '%s.%d' % (e[0], n)   # the second file of that name becomes name.2
        with open(os.path.join(out, target), 'wb') as f:
            f.write(data)
        print('%s <- %s (%d bytes)' % (target, os.path.basename(p), len(data)))
    print('extracted %d file(s)' % len(chosen))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
