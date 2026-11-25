// A costume's looks: which numbered variants of its texture layers and accessory meshes exist, and the layers painted over the body atlas.
// Pure data in, pure data out (no engine); docs/CHARACTER_VIEWER.md, docs/STARMAKER.md section 11.
import type { Rgba } from "../../formats/Dds.ts";

/** The variant number in a layer or accessory file name (`com_m_50s_trousers_v02.dds` is 2), or undefined when the name has none (`com_m_50s_2_a.dds`). */
export function variantOf(file: string): number | undefined {
  const m = /_v(\d+)\.[a-z]+$/i.exec(file);
  return m ? Number(m[1]) : undefined;
}

/** The same file with another variant number, written with at least two digits (`_v00`; `FUN_0042c570` splices `_v%02d`). */
export function withVariant(file: string, variant: number): string {
  return file.replace(/_v\d+(\.[a-z]+)$/i, (_, ext: string) => `_v${String(variant).padStart(2, "0")}${ext}`);
}

/** Whether a texture record is an alpha map (`com_m_50s_2_a.dds`): the game draws those into the alpha channel only, which is not done here. */
export function isAlphaMap(file: string): boolean {
  return /_a\.dds$/i.test(file);
}

/**
 * Paint colour layers over a base atlas, in order, each with the normal "over" blend of its own alpha. A layer of another size is sampled with the nearest pixel.
 * [guess] the base atlas (which already shows the costume's default layers baked in) stands in for the skin and overlays the original paints under the layers
 * (`STARMAKER.md` section 11); the result is opaque where the base is.
 */
export function compositeLayers(base: Rgba, layers: Rgba[]): Rgba {
  const out = new Uint8Array(base.data);
  for (const layer of layers) {
    for (let y = 0; y < base.height; y++) {
      const ly = Math.min(layer.height - 1, Math.floor((y * layer.height) / base.height));
      for (let x = 0; x < base.width; x++) {
        const lx = Math.min(layer.width - 1, Math.floor((x * layer.width) / base.width));
        const s = (ly * layer.width + lx) * 4;
        const a = layer.data[s + 3]! / 255;
        if (a <= 0) continue;
        const d = (y * base.width + x) * 4;
        for (let c = 0; c < 3; c++) out[d + c] = Math.round(layer.data[s + c]! * a + out[d + c]! * (1 - a));
        out[d + 3] = Math.max(out[d + 3]!, layer.data[s + 3]!);
      }
    }
  }
  return { width: base.width, height: base.height, data: out };
}
