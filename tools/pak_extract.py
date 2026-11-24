"""List and extract files from The Movies .pak archives (no game tools needed, works on macOS/Linux).

Format as read from the archives (version 5):
  header   u32 version(5), u32 end, u32 0, u32 file count, u32 256, u32 dir count, u32 ?, u32 0, u32 0, u32 0,
           u32 entry table offset (0x34), u32 directory index offset, u32 directory name table offset
  entry    56 bytes at entry table + 56*i: u32, u32 (look like hashes), u32 chunk offset, u32 chunk compressed size,
           u32 uncompressed size, u32 flags, char name[32] (zero padded; names of 32+ characters are cut off here)
  chunk    at the chunk offset: u32 chunk size, u32 uncompressed size, u32, u32 stored flag (1: raw bytes follow, 0: a zlib stream)
Directories: the header's last u32 is the offset of the directory name table (NUL separated, `ndir` names such as `data\\textures\\hair\\`). An entry's first u32 is
the string hash of its full path, h = h*0x17 + (c & ~0x20) over `dir + name` (the same hash as the saved-game variable tags), so the directory of an entry is the
name in the table whose hash matches (checked on TEX_COS_0001.pak: every entry resolves). The second u32 is another hash (not decoded). Names are still matched on the
32-character file name (longer names are cut), so a name cut at 32 characters may not resolve.
Several files share one name in different directories (`hair_50s_m1.dds` is a 512x512 texture in `data\\textures\\hair\\` and a 128x128 icon in `data\\textures\\thumbs\\hair\\`):
archives override each other only for the same directory + name, and the extra copies are written as name.2, name.3 ... in directory order; `list` prints the directory;
`--tree` writes `<out>/<directory>/<name>` instead, so nothing collides.

Usage:
  python3 tools/pak_extract.py list   <Data/pak dir or .pak> [glob]
  python3 tools/pak_extract.py extract <Data/pak dir or .pak> <out dir> <glob> [<glob> ...] [--tree]

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
        ndir = struct.unpack_from('<I', head, 0x14)[0]
        dir_names = struct.unpack_from('<I', head, 0x30)[0]
        f.seek(table)
        raw = f.read(56 * count)
        f.seek(dir_names)
        dirs = f.read(4096).split(b'\0')[:ndir]
    dirs = [x.decode('latin-1') for x in dirs]
    entries = []
    for i in range(count):
        e = raw[i * 56:(i + 1) * 56]
        _h1, _h2, off, comp, size, flags = struct.unpack_from('<6I', e, 0)
        name = e[24:56].split(b'\0')[0].decode('latin-1')
        entries.append((name, off, comp, size, flags, resolve_dir(_h1, name, dirs)))
    return entries


def path_hash(text):
    h = 0
    for c in text.encode('latin-1', 'replace'):
        h = (h * 0x17 + (c & ~0x20)) & 0xFFFFFFFF
    return h


def resolve_dir(h1, name, dirs):
    for d in dirs:
        if path_hash(d + name) == h1:
            return d
    return ''


def read_file(path, entry):
    name, off, comp, size, _flags, _dir = entry
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
    tree = '--tree' in argv
    argv = [x for x in argv if x != '--tree']
    if cmd == 'list':
        pats = [p.lower() for p in argv[3:]] or ['*']
        for p in paks(src):
            for e in read_entries(p):
                if any(fnmatch.fnmatch(e[0].lower(), pat) for pat in pats):
                    print('%s\t%s\t%d bytes\t%s' % (os.path.basename(p), e[0], e[3], e[5]))
        return 0
    out, pats = argv[3], [p.lower() for p in argv[4:]]
    chosen = {}
    for p in paks(src):                      # later archives override earlier ones, per directory + name
        for e in read_entries(p):
            if any(fnmatch.fnmatch(e[0].lower(), pat) for pat in pats):
                chosen[(e[5].lower(), e[0].lower())] = (p, e)
    os.makedirs(out, exist_ok=True)
    seen = {}
    for (dkey, key), (p, e) in sorted(chosen.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        data = read_file(p, e)
        if tree:
            target = os.path.join(e[5].replace('\\', os.sep), e[0])
            os.makedirs(os.path.dirname(os.path.join(out, target)) or out, exist_ok=True)
        else:
            seen[key] = seen.get(key, 0) + 1
            n = seen[key]
            target = e[0] if n == 1 else '%s.%d' % (e[0], n)   # further files of that name become name.2, name.3 ...
        with open(os.path.join(out, target), 'wb') as f:
            f.write(data)
        print('%s <- %s (%d bytes)' % (target, os.path.basename(p), len(data)))
    print('extracted %d file(s)' % len(chosen))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
