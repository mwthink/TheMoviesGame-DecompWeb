import { Constants } from "@babylonjs/core/Engines/constants";
import type { Material } from "@babylonjs/core/Materials/material";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { shadowMatrix, sunDirection, type ShadowSettings, type SunSettings, type Vec3 } from "./Sun.ts";
import { makeTexture, WHITE } from "./textures.ts";

/** What a shadow-casting model's material tells the depth pass: its diffuse texture (for alpha testing) and the cut height of a cutaway model. Put in the material's `metadata`. */
export interface CasterInfo { diffuse?: Texture | null; cutHeight?: number; }

/**
 * The sun's shadows (docs/LIGHTING.md): one orthographic shadow map around the whole lot, rendered by our own depth shader (`otmDepth`) and read by the terrain and static-model
 * shaders (`shadowFactor`). Casters are the placed models and the people. Each model's material gets a twin for the depth pass, carrying the same diffuse texture so alpha-cut
 * leaves and hair cast shaped shadows and a cutaway model drops its roof. The map is redrawn every other frame, because people and flags move.
 */
export class SunShadows {
  private readonly scene: Scene;
  private rtt: RenderTargetTexture;
  private readonly box: { min: Vec3; max: Vec3 };
  private readonly twins = new Map<Material | null, ShaderMaterial>();
  private readonly registered = new Set<Mesh>();
  private active = false;
  private size: number;
  private white: Texture | null = null;

  /** `box` is the volume that must be inside the map: the lot's ground and the height of the tallest things on it. */
  constructor(scene: Scene, box: { min: Vec3; max: Vec3 }, size = 4096) {
    this.scene = scene;
    this.box = box;
    this.size = size;
    this.rtt = this.makeMap(size);
  }

  private makeMap(size: number): RenderTargetTexture {
    // depth packed in RGBA bytes, nearest-filtered (the shader does its own 3 x 3 filtering), cleared to the far plane
    const rtt = new RenderTargetTexture("sunShadowMap", size, this.scene, false, true, Constants.TEXTURETYPE_UNSIGNED_BYTE, false, Texture.NEAREST_SAMPLINGMODE, true);
    rtt.clearColor = new Color4(1, 1, 1, 1);
    rtt.wrapU = Texture.CLAMP_ADDRESSMODE;
    rtt.wrapV = Texture.CLAMP_ADDRESSMODE;
    rtt.refreshRate = 2;
    rtt.renderList = [];
    return rtt;
  }

  /** Make `mesh` (a model instance or a person's part) cast shadows. `material` is the one it is drawn with, for its alpha-test texture and cut height. */
  addCaster(mesh: AbstractMesh, material: Material | null): void {
    this.rtt.renderList!.push(mesh);
    const source = mesh instanceof InstancedMesh ? mesh.sourceMesh : (mesh as Mesh);
    if (this.registered.has(source)) return;
    this.registered.add(source);
    this.rtt.setMaterialForRendering(source, this.twinOf(material));
  }

  private twinOf(material: Material | null): ShaderMaterial {
    let twin = this.twins.get(material);
    if (twin) return twin;
    const info = (material?.metadata ?? {}) as CasterInfo;
    twin = new ShaderMaterial(`depth|${material?.name ?? "generic"}`, this.scene, "otmDepth", {
      attributes: ["position", "uv"],
      uniforms: ["world", "shadowMatrix", "cutHeight", "alphaTest"],
      samplers: ["diffuse"],
    });
    this.white ??= makeTexture(this.scene, WHITE, { mips: false });
    twin.setTexture("diffuse", info.diffuse ?? this.white);
    twin.setFloat("alphaTest", info.diffuse ? 1 : 0);
    twin.setFloat("cutHeight", info.cutHeight ?? 1e9);
    twin.backFaceCulling = false; // thin walls and leaves are seen from either side by the sun
    this.twins.set(material, twin);
    return twin;
  }

  /**
   * Apply the settings: turn the pass on or off, set the map size, and give the shadow matrix, the map and the shadow numbers to every receiver (the terrain and static
   * model materials marked `sunLit`) and the depth twins. Call it whenever the sun or the shadow settings change.
   */
  update(sun: SunSettings, shadows: ShadowSettings): void {
    const on = sun.enabled && shadows.enabled;
    if (on && shadows.size !== this.size) {
      this.size = shadows.size;
      this.rtt.resize(shadows.size);
    }
    if (on && !this.active) this.scene.customRenderTargets.push(this.rtt);
    if (!on && this.active) this.scene.customRenderTargets.splice(this.scene.customRenderTargets.indexOf(this.rtt), 1);
    this.active = on;
    const frustum = shadowMatrix(sunDirection(sun.azimuth, sun.elevation), this.box);
    const matrix = Matrix.FromArray(frustum.m);
    const params = new Vector3(shadows.bias / frustum.depthRange, shadows.darkness, 1 / this.size);
    for (const twin of this.twins.values()) twin.setMatrix("shadowMatrix", matrix);
    for (const m of this.scene.materials) {
      if (!(m.metadata as { sunLit?: boolean } | null)?.sunLit) continue;
      const sm = m as ShaderMaterial;
      sm.setFloat("shadowOn", on ? 1 : 0);
      sm.setMatrix("shadowMatrix", matrix);
      sm.setTexture("shadowMap", this.rtt);
      sm.setVector3("shadowParams", params);
    }
  }

  dispose(): void {
    this.rtt.dispose();
    for (const t of this.twins.values()) t.dispose();
  }
}
