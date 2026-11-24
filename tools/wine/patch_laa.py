#!/usr/bin/env python3
"""Set the large-address-aware flag on a copy of MoviesSE.exe (what the NTCore 4GB Patch does; Mac/Wine counterpart of
tools/winbox/jobs/patch_laa.ps1). Only one PE header bit changes, no code, so every address in the docs stays valid.

    python3 tools/wine/patch_laa.py "<game>/MoviesSE.exe" <out>/MoviesSE.exe

The source must be the patch-1.2 executable (SHA-256 below). The source is never modified.
"""
import hashlib, sys

EXPECTED = "48f909d7f89051ff0d3277f7dc0aa7c65cd1c92015542fcbc3d5f86700b1566a"
LAA = 0x20


def main(src, dst):
    data = bytearray(open(src, "rb").read())
    digest = hashlib.sha256(data).hexdigest()
    if digest != EXPECTED:
        sys.exit(f"unexpected executable: sha256 {digest}\n(expected {EXPECTED}: patch 1.2, unmodified)")
    pe = int.from_bytes(data[0x3C:0x40], "little")
    if data[pe:pe + 4] != b"PE\0\0":
        sys.exit("not a PE file")
    off = pe + 22                                   # IMAGE_FILE_HEADER.Characteristics
    chars = int.from_bytes(data[off:off + 2], "little")
    if chars & LAA:
        sys.exit("flag is already set")
    data[off:off + 2] = (chars | LAA).to_bytes(2, "little")
    open(dst, "wb").write(data)
    out = open(dst, "rb").read()
    orig = open(src, "rb").read()
    assert len(out) == len(orig) and [i for i in range(len(out)) if out[i] != orig[i]] == [off], "unexpected difference"
    print(f"characteristics {chars:#06x} -> {chars | LAA:#06x} at file offset {off:#x}; wrote {dst}")
    print("patched sha256:", hashlib.sha256(out).hexdigest())


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
