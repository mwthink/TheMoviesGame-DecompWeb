/**
 * The game's string hash: h = h * 0x17 + (c & ~0x20), 32 bit, so it ignores case (docs/SAVE_FORMAT.md, tools/jad_dump.py `tag_hash`).
 * It names saved-game fields and, over directory + file name, pak entries.
 */
export function gameHash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i) & 0xff;
    h = (Math.imul(h, 0x17) + (c & ~0x20)) >>> 0;
  }
  return h;
}
