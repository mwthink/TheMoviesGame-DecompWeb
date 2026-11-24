#!/usr/bin/env python3
"""Read The Movies .cos costume files: which body mesh, texture layers and attached meshes make up a costume.

    python3 tools/cos_dump.py data/game_data/chars/m_50s_1.cos [...]

Layout of the common form (version 7, byte 4 = 3; read from real files, not from the loader):

    u32 version (7), u8 format (3), u8 1, u8 n (the number of kind-1 records in the files looked at, not always), u8 0, u32 0
    0x00c  body mesh name, NUL padded to 128 bytes                       (cos_m_50s_1.msh)
    0x08c  u32, u32, u32, 16 zero bytes                                  (the header ends at 0xa8)
    records of 0x78 bytes up to the end of the file, in two groups (textures first, then the rest, but the group is better told by the kind field):
        file name[32] (com_m_50s_shoes_1_v00.dds or hat_m_gen_v04.msh), 8 bytes, u32 kind at +0x28 (1 = texture, 2 = mesh), u32, slot name[32] at +0x30 (cos_shoes,
        cos_hat, cos_glasses ... empty for a few), then 40 bytes: u32 flags and f32 parameters (a scale, tint colours; not decoded)
    Files with byte 4 = 2 (entourage and extras, 164-352 bytes) have a shorter, different tail: only the body mesh name is read from them.

Checked on all 464 .cos files in the game: the 406 files with format byte 3 all have a size that is 0xa8 + a whole number of 0x78 records, and their records have
kind 1 on a .dds name and kind 2 on a .msh name except for 4 records (listed as "other"). The other 58 files (format byte 2: 47, byte 7: 7, 0: 2, 1: 2; mostly 164-352 bytes, entourage
and extras) are not decoded beyond the body mesh name. Not decoded: the floats and flags, which bone an attached mesh follows (the accessory meshes are skinned like the body,
see docs/ANM_FORMAT.md), and the layout of the other formats.
"""
import os
import struct
import sys
import zlib

HEADER = 0xA8
REC = 0x78


def cstr(b):
    return b.split(b"\0")[0].decode("latin1")


def parse(data):
    if data[:4] == b"zcmp":
        data = zlib.decompress(data[20:])
    version = struct.unpack_from("<I", data, 0)[0]
    fmt = data[4]
    body = cstr(data[0xC:0x8C])
    recs = []
    if fmt == 3:
        rest = len(data) - HEADER
        if rest < 0 or rest % REC:
            raise ValueError("unexpected .cos size %d (version %d)" % (len(data), version))
        for i in range(rest // REC):
            o = HEADER + REC * i
            recs.append({"file": cstr(data[o:o + 32]), "kind": struct.unpack_from("<I", data, o + 0x28)[0],
                         "slot": cstr(data[o + 0x30:o + 0x50]), "flags": struct.unpack_from("<I", data, o + 0x50)[0],
                         "floats": struct.unpack_from("<%df" % ((REC - 0x54) // 4), data, o + 0x54)})
    return {"version": version, "format": fmt, "body": body,
            "textures": [r for r in recs if r["kind"] == 1], "meshes": [r for r in recs if r["kind"] == 2],
            "other": [r for r in recs if r["kind"] not in (1, 2)]}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for p in sys.argv[1:]:
        c = parse(open(p, "rb").read())
        print("%s: v%d format %d body %s" % (os.path.basename(p), c["version"], c["format"], c["body"]))
        for r in c["textures"]:
            print("  texture %-34s slot %s" % (r["file"], r["slot"]))
        for r in c["meshes"]:
            print("  mesh    %-34s slot %s" % (r["file"], r["slot"]))
        for r in c["other"]:
            print("  other   %-34s kind %d" % (r["file"], r["kind"]))
