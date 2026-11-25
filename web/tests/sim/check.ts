// Shared helpers for the simulation tests (ported with the modules from the earlier C++ tests).
import assert from "node:assert/strict";

export const f32 = Math.fround;

/** |got - want| <= tol in float arithmetic, as the C++ checks these came from compared (so edge cases such as 0.875 against 0.87 +- 0.005 agree). */
export function near(what: string, got: number, want: number, tol: number): void {
  assert.ok(f32(Math.abs(f32(got) - f32(want))) <= f32(tol), `${what}: got ${got}, want ${want} (+-${tol})`);
}

/** The same in double precision, for values the C++ checks held as double. */
export function nearD(what: string, got: number, want: number, tol: number): void {
  assert.ok(Math.abs(got - want) <= tol, `${what}: got ${got}, want ${want} (+-${tol})`);
}

/** Every number (and number array) in `defaults` equals the same field of `loaded` within 1e-6: the defaults were copied from the docs and must be
 * what the installed game ships. */
export function expectSame(what: string, loaded: object, defaults: object): void {
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6;
  for (const [k, v] of Object.entries(defaults)) {
    const got = (loaded as Record<string, unknown>)[k];
    if (Array.isArray(v)) v.forEach((x: number, i) => assert.ok(close((got as number[])[i]!, x), `${what}.${k}[${i}]: ${(got as number[])[i]} in the game files, ${x} in the defaults`));
    else if (typeof v === "number") assert.ok(close(got as number, v), `${what}.${k}: ${got} in the game files, ${v} in the defaults`);
  }
}
