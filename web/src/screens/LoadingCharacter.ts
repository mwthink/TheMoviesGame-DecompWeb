import { Engine } from "@babylonjs/core/Engines/engine";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import type { PakIndex } from "../assets/Pak.ts";
import { anmDurationMs, anmFramePosition, parseAnm, type Anm } from "../formats/Anm.ts";
import { decodeDds, type Rgba } from "../formats/Dds.ts";
import { clipFits, poseBones, skinTransforms } from "../sim/anim/AutoAnimation.ts";
import { findTexture, PersonModelBuilder, type PersonModel } from "../world/WorldData.ts";
import { PersonMeshes } from "../world/PersonMeshes.ts";
import { characterFraming, DEFAULT_CHARACTER, type CharacterSettings } from "./LoadingCharacterFraming.ts";

export { characterFraming, DEFAULT_CHARACTER, PERSON_HEIGHT, type CharacterSettings } from "./LoadingCharacterFraming.ts";

/**
 * A real-time 3D character on its own transparent canvas, to be laid over the loading screen's background and under its text box. It has its own Babylon engine (the page
 * canvas belongs to the game view), builds the person from the archives with the same pipeline as the world and the character viewer, and plays a looping clip.
 */
export class LoadingCharacter {
  readonly canvas: HTMLCanvasElement;
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: FreeCamera;
  private meshes: PersonMeshes | null = null;
  private model: PersonModel | null = null;
  private clip: Anm | null = null;
  private timeMs = 0;
  /** True once the held frame (`settings.frame`) has been posed, so a still character is skinned once rather than every tick. */
  private posed = false;
  private settings: CharacterSettings = { ...DEFAULT_CHARACTER };
  private token = 0;
  private readonly builder: PersonModelBuilder;
  private readonly textures = new Map<string, Promise<Rgba | null>>();
  private readonly observer: ResizeObserver;

  /** `before` is the element the canvas goes in front of (the text box), so the character is drawn behind the text. `parent` is the picture's square in the lab, or the whole window in a scene. */
  constructor(private readonly pak: PakIndex, parent: HTMLElement, before: Element | null = null) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "char3d";
    this.canvas.setAttribute("aria-hidden", "true");
    parent.insertBefore(this.canvas, before);
    this.engine = new Engine(this.canvas, true, { alpha: true, premultipliedAlpha: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0, 0, 0, 0); // transparent: the picture shows through
    this.camera = new FreeCamera("loadingChar", new Vector3(0, 1, -10), this.scene);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.setTarget(new Vector3(0, 1, 0));
    this.camera.minZ = 0.1;
    this.camera.maxZ = 50;
    this.builder = new PersonModelBuilder(pak, (name) => this.texture(name));
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(parent);
    this.resize();
    let last = performance.now();
    this.engine.runRenderLoop(() => {
      const now = performance.now();
      this.tick(Math.min(now - last, 99));
      last = now;
      this.scene.render();
    });
  }

  private texture(name: string): Promise<Rgba | null> {
    const key = name.toLowerCase();
    let t = this.textures.get(key);
    if (!t) {
      t = (async () => {
        const f = findTexture(this.pak, key);
        return f ? decodeDds(await this.pak.read(f)) : null;
      })();
      this.textures.set(key, t);
    }
    return t;
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(2, Math.round(parent.clientWidth * dpr));
    this.canvas.height = Math.max(2, Math.round(parent.clientHeight * dpr));
    this.engine.resize();
    this.frame();
  }

  /** Aim the orthographic camera for the current framing (it is square: the picture is). */
  private frame(): void {
    const f = characterFraming(this.settings);
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    this.camera.orthoTop = f.halfHeight;
    this.camera.orthoBottom = -f.halfHeight;
    this.camera.orthoLeft = -f.halfHeight * aspect;
    this.camera.orthoRight = f.halfHeight * aspect;
    // the framing's sideways position is a share of the width of a square picture; on a wider canvas the same share is `aspect` times as far
    const lookX = f.lookX * aspect;
    this.camera.position.set(lookX, f.lookY, -10);
    this.camera.setTarget(new Vector3(lookX, f.lookY, 0));
  }

  /** Apply settings. A new costume or clip is loaded; the rest takes effect at once. */
  async set(s: CharacterSettings): Promise<void> {
    const old = this.settings;
    this.settings = { ...s };
    this.frame();
    this.canvas.hidden = !s.enabled;
    if (this.meshes) this.meshes.node.rotation.y = (s.turn * Math.PI) / 180;
    if (!s.enabled) return;
    if (!this.model || s.costume !== old.costume || s.look !== old.look) await this.build();
    if (!this.clip || s.clip !== old.clip) await this.loadClip();
    this.posed = false;
    this.tick(0); // pose it now, so a screen that shows it on the next line never sees the unposed model
  }

  private async build(): Promise<void> {
    const mine = ++this.token;
    try {
      // a plain hair mesh by the costume's sex (the costume names the body only)
      const l = this.settings.look;
      const hair = l ? l.hair : this.settings.costume.toLowerCase().startsWith("f_") ? "hair_20s_f1.msh" : "hair_20s_m1.msh";
      const model = await this.builder.build({
        cos: this.settings.costume, head: l?.head ?? "", hair, ageYears: l?.ageYears ?? 30, weightKg: l?.weightKg ?? 70,
        look: l ? { layers: l.layers, accessories: l.accessories } : undefined,
      });
      if (mine !== this.token) return;
      this.meshes?.dispose();
      this.model = model;
      this.meshes = new PersonMeshes(this.scene, { bind: model.parts, textures: model.textures, skeleton: model.skeleton }, "loading/person", new Map<string, StandardMaterial>());
      this.meshes.node.rotation.y = (this.settings.turn * Math.PI) / 180;
      await this.loadClip();
    } catch (e) {
      console.warn("loading character unavailable:", e);
    }
  }

  private async loadClip(): Promise<void> {
    const bytes = await this.pak.readByName(this.settings.clip, { dir: "data\\animations\\high\\" });
    if (!bytes) return;
    const clip = parseAnm(bytes);
    if (this.model && !clipFits(this.model.skeleton, clip)) return;
    this.clip = clip;
    this.timeMs = 0;
    this.posed = false;
  }

  /** Advance the clip and re-skin. */
  private tick(dtMs: number): void {
    if (!this.model || !this.meshes || !this.clip || !this.settings.enabled) return;
    const sk = this.model.skeleton;
    const held = this.settings.frame;
    if (held !== undefined) {
      if (this.posed) return;
      this.posed = true;
      this.meshes.applyPose(skinTransforms(sk, poseBones(sk, this.clip, Math.min(Math.max(0, held), this.clip.nFrames - 1), "absolute")));
      return;
    }
    this.timeMs = (this.timeMs + dtMs) % anmDurationMs(this.clip);
    this.meshes.applyPose(skinTransforms(sk, poseBones(sk, this.clip, anmFramePosition(this.clip, this.timeMs), "absolute")));
  }

  /** True once a person is built and posed, so a screen can wait for it before showing the scene. */
  get ready(): boolean { return this.model !== null && this.clip !== null && (this.settings.frame === undefined || this.posed); }

  dispose(): void {
    this.token++;
    this.observer.disconnect();
    this.engine.stopRenderLoop();
    this.meshes?.dispose();
    this.scene.dispose();
    this.engine.dispose();
    this.canvas.remove();
  }
}
