// A loading scene as the TypeScript that goes into `LOADING_SCENES` (the editor in the character viewer copies this to the clipboard). No engine types: Node tests run it.

import { encodeCharacter } from "../sim/character/CharacterCode.ts";
import type { LoadingScene } from "./loadingScenes.ts";

/** A number as short as it can be written: at most three decimals, no trailing zeros. */
function num(n: number): string {
  return String(Number(n.toFixed(3)));
}

function str(s: string): string {
  return JSON.stringify(s);
}

/**
 * The scene as an object literal to paste into `LOADING_SCENES` in `web/src/screens/loadingScenes.ts` (and `lookFromCode` / `DEFAULT_CHARACTER` are already imported or defined there).
 * Fields equal to the defaults (a zero nudge, no turn) are left out; a held frame is kept, a looping clip has none. A whole look is written as its character code.
 */
export function sceneToCode(scene: LoadingScene, indent = "  "): string {
  const c = scene.character;
  const fields = [`enabled: true`, `side: ${str(c.side)}`, `size: ${num(c.size)}`];
  if (c.nudgeX !== 0) fields.push(`nudgeX: ${num(c.nudgeX)}`);
  if (c.nudgeY !== 0) fields.push(`nudgeY: ${num(c.nudgeY)}`);
  if (c.turn !== 0) fields.push(`turn: ${num(c.turn)}`);
  fields.push(`costume: ${str(c.costume)}`, `clip: ${str(c.clip)}`);
  if (c.frame !== undefined) fields.push(`frame: ${num(c.frame)}`);
  if (c.look) fields.push(`look: lookFromCode(${str(encodeCharacter(c.look))})`);
  const lines = [
    `{`,
    `${indent}name: ${str(scene.name)},`,
    `${indent}character: { ...DEFAULT_CHARACTER, ${fields.join(", ")} },`,
    `${indent}background: ${str(scene.background)},`,
  ];
  const b = scene.backdrop;
  if (b) {
    const v = (a: readonly number[]) => `[${a.map(num).join(", ")}]`;
    lines.push(`${indent}backdrop: { mesh: ${str(b.mesh)}, eye: ${v(b.eye)}, look: ${v(b.look)}, fovDeg: ${num(b.fovDeg)}, blurPx: ${num(b.blurPx)}, brightness: ${num(b.brightness)} },`);
  }
  lines.push(`},`);
  return lines.join("\n");
}
