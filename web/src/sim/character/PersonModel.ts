// Putting a saved person's model together from files: the head shape (the .hd morph on generic_head.msh), which head and hair file to use, the age.
// Pure data in, pure data out (no engine); docs/PEOPLE.md. The rules come from tools/export_person.py (which was checked by eye against the game) and
// docs/CHARACTERS.md.
import type { Anm } from "../../formats/Anm.ts";
import type { Msh, MshBone } from "../../formats/Msh.ts";
import { poseBones, skinVertices } from "../anim/AutoAnimation.ts";
import { applyHdMorph, HEAD_VERTEX_COUNT, type HeadFile } from "./HeadFile.ts";

/**
 * The head file a person without a saved head gets: the defaults named in the loader (docs/CHARACTERS.md), `head_f_white_jane.hd` for a woman and
 * `head_m_white_joe.hd` for a man. The costume names say which: female costumes start with `f_`.
 */
export function defaultHeadFor(cosName: string): string {
  return cosName.toLowerCase().startsWith("f_") ? "head_f_white_jane.hd" : "head_m_white_joe.hd";
}

/**
 * The head morph amounts for an age in years and a weight in kg (`CharacterModel_SetAgeMorph` / `SetWeightMorph`, docs/CHARACTERS.md): the age morph is 0
 * below 30 years and rises 0.025 a year to 1 at 70; the weight morph is 0 at 60 kg and rises 0.025 a kg to 1 at 100.
 */
export function morphAmounts(ageYears: number, weightKg: number): { age: number; weight: number } {
  const age = ageYears >= 30 ? Math.max(0, Math.min(1, (Math.min(ageYears, 70) - 30) * 0.025)) : 0;
  const weight = Math.max(0, Math.min(1, (Math.max(60, Math.min(weightKg, 100)) - 60) * 0.025));
  return { age, weight };
}

/**
 * A person's age in years. `birth` and `today` are game day counts (365 per year). [guess, as in the Python tool] today = the save's date.
 * Not saved for everyone: callers use 25 when there is no birth day.
 */
export function ageYears(birth: number | undefined, today: number | undefined): number {
  if (birth === undefined || today === undefined || !(birth > 0)) return 25;
  return Math.max(0, (today - birth) / 365);
}

/** One drawable piece of a head or body: vertices in model space (z up), z-up normals, uvs and triangle indices. */
export interface ModelPart {
  positions: Float32Array;
  normals: Float32Array;
  uv: Float32Array;
  indices: Uint16Array;
  /** The texture file the part is drawn with (`""` when unknown). */
  texture: string;
  /** Bone weights per vertex when the part is skinned (bodies, heads and hair are; the skeleton is the body's). */
  skin: { weights: Float32Array; bones: Uint8Array } | null;
}

/** The clip whose first frame is the standing pose people are drawn in until they animate (docs/PEOPLE.md): arms hanging by the sides. [guess] a stand-in, not what the game shows. */
export const STANDING_POSE_CLIP = "idle_male_half1.anm";

/** Move skinned parts from the bind pose into frame 0 of a clip, with the body's skeleton. Parts without skin stay as they are. */
export function poseParts(parts: ModelPart[], skeleton: MshBone[], clip: Anm): ModelPart[] {
  const pose = poseBones(skeleton, clip, 0, "absolute");
  return parts.map((p) => {
    if (!p.skin) return p;
    const positions = new Float32Array(p.positions.length);
    const normals = new Float32Array(p.normals.length);
    skinVertices(skeleton, pose, { positions: p.positions, normals: p.normals, skin: p.skin }, positions, normals);
    return { ...p, positions, normals };
  });
}

/**
 * The generic head with a person's shape: every vertex of `generic_head.msh` (996 over its three primitives, in file order) takes the morphed position and
 * normal. The eyeball primitive (58 vertices) is not morphed by the .hd but the face and the mouth/lid primitives around it move by up to 5 mm, which
 * buries the 2-3 mm proud eyeballs; a deviation from the file data (from `export_person.py`): the morph of a vertex of those two primitives fades to nothing
 * within 6 mm of an eyeball vertex and is complete from 2.6 cm (smoothstep). `textureOverride` replaces the texture the generic head names.
 */
export function morphedHead(generic: Msh, first: HeadFile, second: HeadFile | null, mix: number, ageYearsValue: number, weightKg: number, textureOverride: string): ModelPart[] {
  const prims = generic.primitives;
  const total = prims.reduce((n, p) => n + p.positions.length / 3, 0);
  if (total !== HEAD_VERTEX_COUNT) throw new Error(`generic_head.msh has ${total} vertices, the .hd morph ${HEAD_VERTEX_COUNT}`);
  const amounts = morphAmounts(ageYearsValue, weightKg);
  const shape = applyHdMorph(first, second, mix, amounts.weight, amounts.age);
  const eyes = prims.length === 3 && prims[1]!.positions.length / 3 === 58 ? prims[1]!.positions : null;
  const parts: ModelPart[] = [];
  let at = 0;
  prims.forEach((p, pi) => {
    const n = p.positions.length / 3;
    const positions = new Float32Array(n * 3);
    const normals = new Float32Array(n * 3);
    for (let j = 0; j < n; j++) {
      const s = (at + j) * 6;
      let w = 1;
      if (eyes && pi !== 1) {
        let best = Infinity;
        for (let e = 0; e < eyes.length; e += 3) {
          const dx = p.positions[j * 3]! - eyes[e]!, dy = p.positions[j * 3 + 1]! - eyes[e + 1]!, dz = p.positions[j * 3 + 2]! - eyes[e + 2]!;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < best) best = d2;
        }
        const t = Math.max(0, Math.min(1, (Math.sqrt(best) - 0.006) / 0.02));
        w = t * t * (3 - 2 * t);
      }
      for (let k = 0; k < 3; k++) {
        positions[j * 3 + k] = p.positions[j * 3 + k]! + w * (shape[s + k]! - p.positions[j * 3 + k]!);
        normals[j * 3 + k] = shape[s + 3 + k]!;
      }
    }
    at += n;
    const mat = generic.materials[p.material];
    const own = mat ? generic.textures[mat.tex[0]] ?? "" : "";
    parts.push({ positions, normals, uv: p.uv, indices: p.indices, texture: /^head_/i.test(own) ? textureOverride : own, skin: p.skin });
  });
  return parts;
}

/** The parts of a plain mesh (a body, hair): its primitives with the diffuse texture each material names. */
export function meshParts(msh: Msh): ModelPart[] {
  return msh.primitives.map((p) => {
    const mat = msh.materials[p.material];
    return { positions: p.positions, normals: p.normals, uv: p.uv, indices: p.indices, texture: mat ? msh.textures[mat.tex[0]] ?? "" : "", skin: p.skin };
  });
}
