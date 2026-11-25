import { Constants } from "@babylonjs/core/Engines/constants";
import type { Engine } from "@babylonjs/core/Engines/engine";
import { Effect } from "@babylonjs/core/Materials/effect";
import { EffectRenderer, EffectWrapper } from "@babylonjs/core/Materials/effectRenderer";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { HighlightLayer } from "@babylonjs/core/Layers/highlightLayer";
import "@babylonjs/core/Layers/effectLayerSceneComponent"; // side effect: lets the scene render effect layers
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateLineSystem } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation";
import type { Scene } from "@babylonjs/core/scene";
import type { SunShadows } from "./SunShadows.ts";

/**
 * Outlines what the pointer is over (docs/DEV_TOOLS.md): a person's meshes, or a building. Babylon's `HighlightLayer` takes plain meshes only (an instanced mesh has no
 * `onBeforeBindObservable`), so a building is outlined by its footprint drawn as lines on the ground.
 */
/**
 * The outline of a footprint (`b15_02`: indexed triangles in the model's x, y plane) as closed loops of scene points: the edges used by one triangle only, turned by the placement's angle
 * (game counter-clockwise), scaled, moved to its position and lifted to `height`. Game (x, y) is scene (x, z).
 */
export function footprintOutline(fp: { verts: ArrayLike<number>; tris: ArrayLike<number> }, position: ArrayLike<number>, angle: number, scale: number, height: number): Vector3[][] {
  const count = new Map<string, [number, number, number]>();
  for (let t = 0; t + 2 < fp.tris.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = fp.tris[t + e]!, b = fp.tris[t + (e + 1) % 3]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const entry = count.get(key);
      if (entry) entry[2]++; else count.set(key, [a, b, 1]);
    }
  }
  const c = Math.cos(angle), s = Math.sin(angle);
  const point = (i: number) => {
    const x = fp.verts[i * 3]! * scale, y = fp.verts[i * 3 + 1]! * scale;
    return new Vector3(position[0] + x * c - y * s, height, position[1] + x * s + y * c);
  };
  const lines: Vector3[][] = [];
  for (const [a, b, n] of count.values()) if (n === 1) lines.push([point(a), point(b)]);
  return lines;
}

export class HoverHighlight {
  private layer: HighlightLayer | null = null;
  private enabled = true;
  private current: string | null = null;
  private meshes: Mesh[] = [];
  private outline: LinesMesh | null = null;

  constructor(private readonly scene: Scene) {}

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.clear();
  }

  private ensureLayer(): HighlightLayer {
    if (!this.layer) {
      this.layer = new HighlightLayer("hover", this.scene);
      this.layer.innerGlow = false;
      this.layer.blurHorizontalSize = 0.8;
      this.layer.blurVerticalSize = 0.8;
    }
    return this.layer;
  }

  /** Outline a person (the meshes under their node); `null` clears. The same key twice does nothing. */
  setPerson(node: TransformNode | null): void {
    if (!this.enabled) return;
    const key = node ? `person:${node.name}` : null;
    if (key === this.current) return;
    this.clear();
    if (!node) return;
    this.current = key;
    const layer = this.ensureLayer();
    for (const m of node.getChildMeshes()) { layer.addMesh(m as Mesh, new Color3(1, 0.85, 0.3)); this.meshes.push(m as Mesh); }
  }

  /**
   * Outline a building by its footprint on the ground (`footprintOutline`). The glow cannot be used here: a building that shows its rooms is cut open by a discard in its own shader, and
   * the glow layer draws the whole uncut silhouette in the highlight colour over the rooms.
   */
  setBuilding(key: string | null, loops: Vector3[][]): void {
    if (!this.enabled) return;
    const k = key ? `building:${key}` : null;
    if (k === this.current) return;
    this.clear();
    if (!key || !loops.length) return;
    this.current = k;
    this.outline = CreateLineSystem("hover/footprint", { lines: loops }, this.scene);
    this.outline.color = new Color3(0.5, 0.8, 1);
    this.outline.isPickable = false;
  }

  private clear(): void {
    this.current = null;
    if (this.layer) for (const m of this.meshes) this.layer.removeMesh(m);
    this.outline?.dispose();
    this.outline = null;
    this.meshes = [];
  }

  dispose(): void {
    this.clear();
    this.layer?.dispose();
    this.layer = null;
  }
}

/** The shadow frustum as a wireframe box in the scene (dev menu). */
export class FrustumLines {
  private lines: LinesMesh | null = null;

  constructor(private readonly scene: Scene, private readonly shadows: () => SunShadows | null) {}

  /** Show or hide, and rebuild from the shadows' current matrix. Call again after the sun changes. */
  update(on: boolean): void {
    this.lines?.dispose();
    this.lines = null;
    const corners = on ? this.shadows()?.corners() : null;
    if (!corners) return;
    // corners are indexed (u, v, d) as 4 * u + 2 * v + d: the 12 edges join corners that differ in one index bit
    const edges: [number, number][] = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    this.lines = CreateLineSystem("shadowFrustum", { lines: edges.map(([a, b]) => [corners[a]!, corners[b]!]) }, this.scene);
    this.lines.color = new Color3(1, 0.4, 0.2);
    this.lines.isPickable = false;
  }

  dispose(): void { this.lines?.dispose(); }
}

/**
 * Draws the sun's shadow map into a small 2D canvas (dev menu): the packed depth is unpacked by a shader into grey (white = far or empty, darker = nearer the sun) on a
 * 192-pixel render target, read back twice a second. Only the small copy is read, never the 4096-pixel map.
 */
export class ShadowMapViewer {
  private readonly renderer: EffectRenderer;
  private readonly wrapper: EffectWrapper;
  private readonly target: RenderTargetTexture;
  private canvas: HTMLCanvasElement | null = null;
  private timer = 0;
  private busy = false;
  private static readonly SIZE = 192;

  constructor(private readonly engine: Engine, scene: Scene, private readonly shadows: () => SunShadows | null) {
    Effect.ShadersStore["otmShadowViewFragmentShader"] = `
      varying vec2 vUV;
      uniform sampler2D shadowMap;
      void main() {
        vec4 c = texture2D(shadowMap, vUV);
        float d = dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0));
        gl_FragColor = vec4(vec3(d), 1.0);
      }`;
    this.renderer = new EffectRenderer(engine);
    this.wrapper = new EffectWrapper({ engine, name: "otmShadowView", fragmentShader: "otmShadowView", useShaderStore: true, samplerNames: ["shadowMap"] });
    this.target = new RenderTargetTexture("shadowView", ShadowMapViewer.SIZE, scene, false, true, Constants.TEXTURETYPE_UNSIGNED_BYTE);
    this.target.renderList = [];
    this.target.refreshRate = 0;
  }

  /** Draw into this canvas (null stops). */
  setCanvas(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    window.clearInterval(this.timer);
    if (canvas) this.timer = window.setInterval(() => void this.refresh(), 500);
  }

  private async refresh(): Promise<void> {
    const shadows = this.shadows();
    const canvas = this.canvas;
    if (!canvas || !shadows?.running || this.busy || !this.wrapper.effect.isReady()) return;
    this.busy = true;
    try {
      this.renderer.setViewport();
      this.engine.bindFramebuffer(this.target.renderTarget!);
      this.renderer.applyEffectWrapper(this.wrapper);
      this.wrapper.effect.setTexture("shadowMap", shadows.map);
      this.renderer.draw();
      this.engine.unBindFramebuffer(this.target.renderTarget!);
      this.renderer.restoreStates();
      const px = (await this.target.readPixels()) as Uint8Array | null;
      if (!px) return;
      const n = ShadowMapViewer.SIZE;
      const flipped = new Uint8ClampedArray(n * n * 4);
      for (let y = 0; y < n; y++) flipped.set(px.subarray((n - 1 - y) * n * 4, (n - y) * n * 4), y * n * 4); // readback is bottom-up
      canvas.getContext("2d")!.putImageData(new ImageData(flipped, n, n), 0, 0);
    } finally {
      this.busy = false;
    }
  }

  dispose(): void {
    window.clearInterval(this.timer);
    this.wrapper.dispose();
    this.target.dispose();
  }
}

/** Frame and draw statistics for the dev menu (Babylon's scene instrumentation). */
export class PerfStats {
  private readonly instrumentation: SceneInstrumentation;

  constructor(private readonly scene: Scene, private readonly shadows: () => SunShadows | null) {
    this.instrumentation = new SceneInstrumentation(scene);
    this.instrumentation.captureFrameTime = true;
    this.instrumentation.captureRenderTime = true;
    this.instrumentation.captureActiveMeshesEvaluationTime = true;
    this.instrumentation.captureRenderTargetsRenderTime = true;
  }

  /** Rows for the dev menu's Performance section. */
  rows(): Record<string, string> {
    const i = this.instrumentation;
    const ms = (v: number) => `${v.toFixed(2)} ms`;
    const engine = this.scene.getEngine();
    return {
      fps: engine.getFps().toFixed(0),
      "frame time (avg)": ms(i.frameTimeCounter.average),
      "render time (avg)": ms(i.renderTimeCounter.average),
      "mesh selection (avg)": ms(i.activeMeshesEvaluationTimeCounter.average),
      "render targets (avg)": ms(i.renderTargetsRenderTimeCounter.average),
      "shadow pass (cpu)": this.shadows()?.running ? ms(this.shadows()!.passMs) : "off",
      "draw calls": String(i.drawCallsCounter.current),
      "active meshes": String(this.scene.getActiveMeshes().length),
      "triangles drawn": String(Math.round(this.scene.getActiveIndices() / 3)),
      materials: String(this.scene.materials.length),
    };
  }

  dispose(): void { this.instrumentation.dispose(); }
}
