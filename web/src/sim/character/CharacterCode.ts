// A character as one line of text, to copy between the character viewer and the loading-screen editor (docs/CHARACTER_VIEWER.md). Pure data, no engine.

/** Everything that makes up a look: the costume file, head and hair (`""` = the default head, no hair), age, weight and the costume's variant choices. */
export interface CharacterLook {
  cos: string;
  head: string;
  hair: string;
  ageYears: number;
  weightKg: number;
  /** Variant numbers by position in the `.cos` (`CostumeLook`). */
  layers: Record<number, number>;
  accessories: Record<number, number>;
}

const PREFIX = "OTMCHAR1:";

/** The look as a string: the prefix, then base64 of a compact JSON array. Meant to be pasted, so it is one line with no spaces. */
export function encodeCharacter(c: CharacterLook): string {
  return PREFIX + btoa(JSON.stringify([c.cos, c.head, c.hair, c.ageYears, c.weightKg, c.layers, c.accessories]));
}

function variants(v: unknown): Record<number, number> {
  const out: Record<number, number> = {};
  if (v && typeof v === "object") {
    for (const [k, n] of Object.entries(v)) if (/^\d+$/.test(k) && Number.isInteger(n) && (n as number) >= 0 && (n as number) < 1000) out[Number(k)] = n as number;
  }
  return out;
}

/** Read a string made by `encodeCharacter`; null when it is not one (surrounding space is ignored). Values are checked, not trusted. */
export function decodeCharacter(text: string): CharacterLook | null {
  const t = text.trim();
  if (!t.startsWith(PREFIX)) return null;
  let a: unknown;
  try {
    a = JSON.parse(atob(t.slice(PREFIX.length)));
  } catch {
    return null;
  }
  if (!Array.isArray(a) || typeof a[0] !== "string" || !a[0] || typeof a[1] !== "string" || typeof a[2] !== "string") return null;
  const age = Number(a[3]), weight = Number(a[4]);
  if (!Number.isFinite(age) || !Number.isFinite(weight)) return null;
  const name = /^[\w.\- ]+$/;
  if (![a[0], a[1], a[2]].every((s) => s === "" || name.test(s as string))) return null;
  return { cos: a[0], head: a[1], hair: a[2], ageYears: Math.min(120, Math.max(0, age)), weightKg: Math.min(250, Math.max(20, weight)), layers: variants(a[5]), accessories: variants(a[6]) };
}
