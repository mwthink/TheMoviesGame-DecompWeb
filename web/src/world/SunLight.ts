import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { sunDirection, type SunSettings } from "./Sun.ts";

/** Marker put in a material's `metadata` when its shader takes the sun uniforms (`sunOn`, `sunDir`, `sunParams`). */
export const SUN_LIT = { sunLit: true };

/**
 * Debug views of the world shaders (dev menu): 0 normal; 1 the diffuse texture only; 2 the baked lightmap only; 3 the normals; 4 the sun's lambert term (normal . toSun);
 * 5 the shadow factor (white = lit, black = shadowed). The people (Babylon materials) are not affected.
 */
export const DEBUG_MODES = ["Normal", "Diffuse only", "Lightmap only", "Normals", "Sun term (n . sun)", "Shadow factor"] as const;

/** Set the debug view on every sun-aware shader material. */
export function setDebugMode(scene: Scene, mode: number): void {
  for (const m of scene.materials) if ((m.metadata as { sunLit?: boolean } | null)?.sunLit) (m as ShaderMaterial).setFloat("debugMode", mode);
}

/** The lights that light the people (the world's own shaders take the sun as uniforms): a directional sun and a hemispheric ambient. */
export interface SunLights { sun: DirectionalLight; ambient: HemisphericLight; }

export function createSunLights(scene: Scene): SunLights {
  const sun = new DirectionalLight("sun", new Vector3(0, -1, 0), scene);
  const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  ambient.groundColor = new Color3(0.35, 0.35, 0.35);
  sun.setEnabled(false);
  ambient.setEnabled(false);
  return { sun, ambient };
}

/**
 * Apply sun settings: the uniforms of every sun-aware shader material (terrain, static models), the two lights, and the people's materials (unlit by their texture when
 * the sun is off, lit by the lights when it is on).
 */
export function applySun(scene: Scene, lights: SunLights, s: SunSettings): void {
  const d = sunDirection(s.azimuth, s.elevation);
  for (const m of scene.materials) {
    if ((m.metadata as { sunLit?: boolean } | null)?.sunLit) {
      const sm = m as ShaderMaterial;
      sm.setFloat("sunOn", s.enabled ? 1 : 0);
      sm.setVector3("sunDir", new Vector3(d.x, d.y, d.z));
      sm.setVector3("sunParams", new Vector3(s.intensity, s.ambient, s.baked));
    } else if (m instanceof StandardMaterial && m.name.startsWith("person|")) {
      m.disableLighting = !s.enabled;
      m.emissiveTexture = s.enabled ? null : m.diffuseTexture;
      m.emissiveColor = s.enabled ? Color3.Black() : Color3.White();
    }
  }
  lights.sun.direction = new Vector3(-d.x, -d.y, -d.z);
  lights.sun.intensity = s.intensity;
  lights.ambient.intensity = s.ambient + 0.25 * s.baked; // people have no lightmap: a floor of baked-style fill so they are not black in shade
  lights.sun.setEnabled(s.enabled);
  lights.ambient.setEnabled(s.enabled);
}
