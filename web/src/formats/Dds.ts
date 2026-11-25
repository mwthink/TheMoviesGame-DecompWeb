/** A decoded texture: RGBA8, rows top to bottom (the same order as the file). */
export interface Rgba {
  width: number;
  height: number;
  data: Uint8Array;
}

function rgb565(v: number): [number, number, number] {
  return [(((v >> 11) & 31) * 255 / 31) | 0, (((v >> 5) & 63) * 255 / 63) | 0, ((v & 31) * 255 / 31) | 0];
}

/** Write the 16 pixels of a DXT colour block (8 bytes at `o`) into `out` as RGBA. `dxt1` enables the 1-bit-alpha mode. */
function colourBlock(d: DataView, o: number, dxt1: boolean, out: Uint8Array): void {
  const c0 = d.getUint16(o, true);
  const c1 = d.getUint16(o + 2, true);
  const bits = d.getUint32(o + 4, true);
  const a = rgb565(c0);
  const b = rgb565(c1);
  const pal: number[][] = [[...a, 255], [...b, 255], [], []];
  if (c0 > c1 || !dxt1) {
    pal[2] = [((2 * a[0] + b[0]) / 3) | 0, ((2 * a[1] + b[1]) / 3) | 0, ((2 * a[2] + b[2]) / 3) | 0, 255];
    pal[3] = [((a[0] + 2 * b[0]) / 3) | 0, ((a[1] + 2 * b[1]) / 3) | 0, ((a[2] + 2 * b[2]) / 3) | 0, 255];
  } else {
    pal[2] = [((a[0] + b[0]) / 2) | 0, ((a[1] + b[1]) / 2) | 0, ((a[2] + b[2]) / 2) | 0, 255];
    pal[3] = [0, 0, 0, 0];
  }
  for (let i = 0; i < 16; i++) out.set(pal[(bits >>> (2 * i)) & 3]!, i * 4);
}

/**
 * An uncompressed RGB or RGBA .dds (pixel-format flag 0x40; 16, 24 or 32 bits a pixel with channel masks). Only the sky box's lightmap `lm_sky.dds` (128 x 128, 24-bit BGR) is known
 * to use it, so only whole-byte channels are supported.
 */
function decodeUncompressed(d: DataView, file: Uint8Array, width: number, height: number): Rgba {
  const bits = d.getUint32(88, true);
  const bpp = bits / 8;
  if (bits !== 24 && bits !== 32) throw new Error(`unsupported uncompressed DDS (${bits} bits)`);
  const masks = [92, 96, 100, 104].map((o) => d.getUint32(o, true)); // R, G, B, A
  const shift = (m: number) => (m === 0 ? -1 : 31 - Math.clz32(m & -m));
  const [sr, sg, sb, sa] = masks.map(shift) as [number, number, number, number];
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = 128 + i * bpp;
    let v = 0;
    for (let k = 0; k < bpp; k++) v |= file[o + k]! << (8 * k);
    data[i * 4] = (v >>> sr) & 255;
    data[i * 4 + 1] = (v >>> sg) & 255;
    data[i * 4 + 2] = (v >>> sb) & 255;
    data[i * 4 + 3] = sa < 0 ? 255 : (v >>> sa) & 255;
  }
  return { width, height, data };
}

/** Decode the top mip of a DXT1, DXT3 or DXT5 .dds (the only formats the game's textures use). Port of tools/dds.py. */
export function decodeDds(file: Uint8Array): Rgba {
  const d = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (d.getUint32(0, true) !== 0x20534444) throw new Error("not a DDS file");
  const height = d.getUint32(12, true);
  const width = d.getUint32(16, true);
  const fourcc = String.fromCharCode(file[84]!, file[85]!, file[86]!, file[87]!);
  const data = new Uint8Array(width * height * 4);
  const pfFlags = d.getUint32(80, true);
  if ((pfFlags & 0x40) !== 0 && (pfFlags & 4) === 0) return decodeUncompressed(d, file, width, height); // uncompressed RGB(A): the sky's lightmap is 24-bit
  const block = new Uint8Array(64);
  let o = 128;
  for (let by = 0; by < Math.max(1, height >> 2); by++) {
    for (let bx = 0; bx < Math.max(1, width >> 2); bx++) {
      if (fourcc === "DXT1") {
        colourBlock(d, o, true, block);
        o += 8;
      } else if (fourcc === "DXT3") {
        colourBlock(d, o + 8, false, block);
        const lo = d.getUint32(o, true);
        const hi = d.getUint32(o + 4, true);
        for (let i = 0; i < 16; i++) {
          const nib = i < 8 ? (lo >>> (4 * i)) & 15 : (hi >>> (4 * (i - 8))) & 15;
          block[i * 4 + 3] = nib * 17;
        }
        o += 16;
      } else if (fourcc === "DXT5") {
        colourBlock(d, o + 8, false, block);
        const a0 = file[o]!;
        const a1 = file[o + 1]!;
        const tab = [a0, a1];
        if (a0 > a1) for (let i = 0; i < 6; i++) tab.push((((6 - i) * a0 + (i + 1) * a1) / 7) | 0);
        else {
          for (let i = 0; i < 4; i++) tab.push((((4 - i) * a0 + (i + 1) * a1) / 5) | 0);
          tab.push(0, 255);
        }
        // 48 bits of 3-bit indices: read as two 24-bit halves to stay within 32-bit integer maths.
        const lo = file[o + 2]! | (file[o + 3]! << 8) | (file[o + 4]! << 16);
        const hi = file[o + 5]! | (file[o + 6]! << 8) | (file[o + 7]! << 16);
        for (let i = 0; i < 16; i++) {
          const idx = i < 8 ? (lo >>> (3 * i)) & 7 : (hi >>> (3 * (i - 8))) & 7;
          block[i * 4 + 3] = tab[idx]!;
        }
        o += 16;
      } else {
        throw new Error(`unsupported DDS format ${fourcc}`);
      }
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i & 3);
        const y = by * 4 + (i >> 2);
        if (x < width && y < height) data.set(block.subarray(i * 4, i * 4 + 4), (y * width + x) * 4);
      }
    }
  }
  return { width, height, data };
}
