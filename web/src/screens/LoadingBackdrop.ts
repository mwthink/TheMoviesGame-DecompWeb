import { Engine } from "@babylonjs/core/Engines/engine";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Scene } from "@babylonjs/core/scene";
import type { PakIndex } from "../assets/Pak.ts";
import { decodeDds, type Rgba } from "../formats/Dds.ts";
import { parseMsh } from "../formats/Msh.ts";
import { findTexture } from "../world/WorldData.ts";
import { makeTexture, WHITE } from "../world/textures.ts";
import type { BackdropSettings } from "./loadingScenes.ts";

/** Textures a set piece uses that are not colour (reflection and lightmap layers) or would look wrong opaque (glass), as a prefix of the file name. */
const SKIPPED = ["refl", "envmap", "lm_", "glas", "win_smash"];

/**
 * A film set drawn as a blurred, dimmed backdrop for a loading scene (docs/LOADING_SCREENS.md, "New loading scenes"): the set's model (`set_saloon.msh`), lit by its textures alone,
 * seen from a camera inside it and blown up by the field of view, then blurred and darkened with CSS. The set is not scaled to the person; it is only suggestive. It has its own
 * Babylon engine on its own canvas, and renders once (and again when the window changes size), since nothing moves.
 */
export class LoadingBackdrop {
  readonly canvas: HTMLCanvasElement;
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: FreeCamera;
  private readonly observer: ResizeObserver;
  private disposed = false;
  private drawn = false;

  /** `before` is the element the canvas goes in front of, so the backdrop is behind the character. */
  constructor(private readonly pak: PakIndex, parent: HTMLElement, before: Element | null = null) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "backdrop3d";
    this.canvas.setAttribute("aria-hidden", "true");
    parent.insertBefore(this.canvas, before);
    this.engine = new Engine(this.canvas, true, { preserveDrawingBuffer: true }); // kept, so the one drawing stays on screen
    this.engine.setHardwareScalingLevel(2); // a blurred picture needs no detail: a quarter of the pixels is plenty
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0, 0, 0, 1);
    this.camera = new FreeCamera("loadingBackdrop", Vector3.Zero(), this.scene);
    this.camera.minZ = 0.1;
    this.camera.maxZ = 200;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(parent);
    this.resize();
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent || this.disposed) return;
    this.engine.resize(); // sizes the drawing buffer from the canvas's CSS size (the half-resolution scaling is set in the constructor)
    if (this.drawn) void this.draw();
  }

  /** Draw the set once its materials are ready (a frame drawn while their shaders still compile skips those meshes and comes out black), and again after a resize. */
  private draw(): Promise<void> {
    return new Promise((resolve) => {
      this.scene.executeWhenReady(() => {
        if (!this.disposed) this.scene.render();
        resolve();
      });
    });
  }

  /** Put the canvas in another parent (in front of `before`) and size it to that: the set was drawn elsewhere, ahead of time. */
  moveTo(parent: HTMLElement, before: Element | null): void {
    parent.insertBefore(this.canvas, before);
    this.observer.disconnect();
    this.observer.observe(parent);
    this.resize();
  }

  /** Build the set and aim the camera; resolves when it is drawn. Throws if the model is not in the archives. */
  async set(b: BackdropSettings): Promise<void> {
    const bytes = await this.pak.readByName(b.mesh);
    if (!bytes) throw new Error(`${b.mesh} not found`);
    const msh = parseMsh(bytes);
    const images = new Map<string, Rgba>();
    for (const name of msh.textures) {
      const key = name.toLowerCase();
      if (images.has(key) || SKIPPED.some((p) => key.startsWith(p))) continue;
      const f = findTexture(this.pak, key);
      if (f) images.set(key, decodeDds(await this.pak.read(f)));
    }
    if (this.disposed) return;
    const materials = new Map<string, StandardMaterial>();
    msh.primitives.forEach((p, i) => {
      const mat = msh.materials[p.material];
      const name = mat ? msh.textures[mat.tex[0]]?.toLowerCase() : undefined;
      if (!name || SKIPPED.some((s) => name.startsWith(s))) return;
      let material = materials.get(name);
      if (!material) {
        material = new StandardMaterial(`backdrop|${name}`, this.scene);
        const tex = makeTexture(this.scene, images.get(name) ?? WHITE);
        tex.hasAlpha = true;
        material.diffuseTexture = tex;
        material.emissiveTexture = tex; // unlit: the texture is the colour
        material.disableLighting = true;
        material.specularColor = Color3.Black();
        material.backFaceCulling = false; // the walls are seen from inside
        material.useAlphaFromDiffuseTexture = true;
        material.transparencyMode = Material.MATERIAL_ALPHATEST;
        material.alphaCutOff = 0.4;
        materials.set(name, material);
      }
      // game (x, y, z up) -> Babylon (x, z, y), as in the world
      const n = p.positions.length / 3;
      const positions = new Float32Array(n * 3);
      const normals = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) {
        positions.set([p.positions[v * 3]!, p.positions[v * 3 + 2]!, p.positions[v * 3 + 1]!], v * 3);
        normals.set([p.normals[v * 3]!, p.normals[v * 3 + 2]!, p.normals[v * 3 + 1]!], v * 3);
      }
      const mesh = new Mesh(`${b.mesh}/${i}`, this.scene);
      const data = new VertexData();
      data.positions = positions;
      data.normals = normals;
      data.uvs = p.uv;
      data.indices = Uint32Array.from(p.indices);
      data.applyToMesh(mesh);
      mesh.material = material;
      mesh.isPickable = false;
    });
    this.aim(b);
    this.canvas.style.filter = `blur(${b.blurPx}px) brightness(${b.brightness})`;
    this.drawn = true;
    await this.draw();
  }

  /** Put the camera at `eye` looking at `look` (game coordinates, z up) with the given field of view (vertical, degrees). */
  private aim(b: BackdropSettings): void {
    this.camera.position.set(b.eye[0], b.eye[2], b.eye[1]);
    this.camera.setTarget(new Vector3(b.look[0], b.look[2], b.look[1]));
    this.camera.fov = (b.fovDeg * Math.PI) / 180;
  }

  dispose(): void {
    this.disposed = true;
    this.observer.disconnect();
    this.scene.dispose();
    this.engine.dispose();
    this.canvas.remove();
  }
}
