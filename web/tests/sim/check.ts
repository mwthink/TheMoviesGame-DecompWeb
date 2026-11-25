// Shared helpers for the simulation tests (ported from the C++ tests in src/tests, which used plain Near / CHECK macros).
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
