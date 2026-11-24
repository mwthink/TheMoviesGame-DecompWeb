#!/usr/bin/env python3
"""Animated GIF of facial expressions: each expression ramps in (0 to 200 ticks), holds, and ramps out (200 to 400 ticks), as the face
controller's envelope does (docs/STARMAKER.md section 8). Pure Python.

    python3 tools/render_expression_gif.py <dir with generic_facialskin.msh, eyes.dds, fe_<head>.anm> <head.dds> <out.gif> <frame[:intensity]> ...
"""
import sys

sys.path.insert(0, __import__("os").path.dirname(__file__))
import dds
from render_expression import Face, render

def median_cut(colors, n):
    boxes = [colors]
    while len(boxes) < n:
        boxes.sort(key=lambda b: -len(b))
        b = boxes.pop(0)
        if len(b) < 2:
            boxes.append(b); break
        rng = [max(c[i] for c in b) - min(c[i] for c in b) for i in range(3)]
        ax = rng.index(max(rng))
        b.sort(key=lambda c: c[ax])
        h = len(b) // 2
        boxes += [b[:h], b[h:]]
    return [tuple(sum(c[i] for c in b) // len(b) for i in range(3)) for b in boxes]

def lzw(indices, mincode=8):
    clear, end = 1 << mincode, (1 << mincode) + 1
    out, bits, nbits = bytearray(), 0, 0
    def emit(code, size):
        nonlocal bits, nbits
        bits |= code << nbits; nbits += size
        while nbits >= 8:
            out.append(bits & 255); bits >>= 8; nbits -= 8
    table = {bytes([i]): i for i in range(clear)}
    nxt, size = end + 1, mincode + 1
    emit(clear, size)
    cur = b""
    for px in indices:
        c = cur + bytes([px])
        if c in table:
            cur = c
        else:
            emit(table[cur], size)
            table[c] = nxt; nxt += 1
            if nxt > (1 << size) and size < 12:
                size += 1
            if nxt >= 4095:
                emit(clear, size); table = {bytes([i]): i for i in range(clear)}; nxt, size = end + 1, mincode + 1
            cur = bytes([px])
    emit(table[cur], size); emit(end, size)
    if nbits: out.append(bits & 255)
    return bytes(out)

def write_gif(path, size, frames, delay):
    sample = []
    for f in frames:
        sample += [tuple(f[i:i + 3]) for i in range(0, len(f), 3 * 37)]
    pal = median_cut(sample, 256)
    cache = {}
    def idx(rgb):
        k = (rgb[0] >> 3, rgb[1] >> 3, rgb[2] >> 3)
        v = cache.get(k)
        if v is None:
            c = (k[0] * 8 + 4, k[1] * 8 + 4, k[2] * 8 + 4)
            v = min(range(len(pal)), key=lambda i: sum((pal[i][j] - c[j]) ** 2 for j in range(3)))
            cache[k] = v
        return v
    out = bytearray(b"GIF89a" + size.to_bytes(2, "little") * 2 + bytes([0xF7, 0, 0]))
    for c in pal + [(0, 0, 0)] * (256 - len(pal)):
        out += bytes(c)
    out += b"\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00"
    for f in frames:
        ix = bytes(idx((f[i], f[i + 1], f[i + 2])) for i in range(0, len(f), 3))
        out += b"\x21\xf9\x04\x04" + delay.to_bytes(2, "little") + b"\x00\x00"
        out += b"\x2c\0\0\0\0" + size.to_bytes(2, "little") * 2 + b"\x00\x08"
        data = lzw(ix)
        for i in range(0, len(data), 255):
            out += bytes([len(data[i:i + 255])]) + data[i:i + 255]
        out += b"\x00"
    open(path, "wb").write(bytes(out) + b"\x3b")

if __name__ == "__main__":
    if len(sys.argv) < 5:
        sys.exit(__doc__)
    d, tex_path, out = sys.argv[1:4]
    head = tex_path.split("head_")[-1].split(".")[0]
    face = Face(d, "fe_" + head + ".anm")
    tex = [dds.load(tex_path), dds.load(d + "/eyes.dds")]
    specs = [(int(a.split(":")[0]), float(a.split(":")[1]) if ":" in a else 1.0) for a in sys.argv[4:]]
    size = 240
    base = face.pose(0, 0.0)
    xs = [p[1] for p in base]; zs = [p[2] for p in base]
    box = (-max(xs) - 0.01, -min(xs) + 0.01, min(zs) - 0.02, max(zs) + 0.02)
    ramp = [0.0, 0.1, 0.25, 0.45, 0.65, 0.82, 0.94, 1.0]       # smooth in; the same values reversed go out
    seq = []
    for fr, it in specs:
        seq += [(fr, it * w) for w in ramp] + [(fr, it)] * 4 + [(fr, it * w) for w in reversed(ramp[:-1])]
    frames = []
    for k, (fr, it) in enumerate(seq):
        frames.append(render(face, face.pose(fr, it), tex, size, box))
        print("frame", k + 1, "of", len(seq), flush=True)
    write_gif(out, size, frames, 6)
    print("wrote", out)
