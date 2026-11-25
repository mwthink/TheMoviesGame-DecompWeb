import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { Screen } from "./Screen.ts";
import { buildWorld } from "../world/WorldScene.ts";
import type { WorldData } from "../world/WorldData.ts";
import { FAR_PLANE, GameCamera } from "../camera/GameCamera.ts";
import { CameraInputSource } from "../camera/CameraInput.ts";
import { DevMenu, type CameraMode } from "../ui/DevMenu.ts";
import { MenuBar } from "../ui/MenuBar.ts";

/** The in-game view: a Babylon scene on the page canvas, showing the loaded world (or nothing when there is none). */
export class GameView implements Screen {
  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private readonly onResize = () => this.engine?.resize();
  private readonly onKey = (e: KeyboardEvent) => { if (e.key === "Escape") this.onExit(); };

  // Overlays and the cameras (see docs/CAMERA.md). The orbit camera is the default; the game camera is ported from the original's code.
  private hud: HTMLElement | null = null;
  private devMenu: DevMenu | null = null;
  private menuBar: MenuBar | null = null;
  private orbit: ArcRotateCamera | null = null;
  private gameCamera: GameCamera | null = null;
  private gameBabylon: FreeCamera | null = null;
  private input: CameraInputSource | null = null;
  private mode: CameraMode = "default";
  private frame = 0;

  /** The world to draw on the next enter(); null shows the blank placeholder scene. */
  world: WorldData | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly onExit: () => void) {}

  enter(): void {
    // The engine is created on first entry and reused afterwards: a new WebGL context per visit is wasteful.
    this.engine ??= new Engine(this.canvas, true, { preserveDrawingBuffer: false, stencil: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.04, 0.05, 0.08, 1);

    if (this.world) {
      this.orbit = buildWorld(this.scene, this.canvas, this.world).camera;
    } else {
      // A scene needs a camera to render. This one is a placeholder until the real game camera exists.
      this.orbit = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 3, 20, Vector3.Zero(), this.scene);
    }
    this.mode = "default";
    this.setupHud(this.scene);

    if (import.meta.env.DEV) {
      // Console helpers for checking the world by hand: __otm.goto(x, y [, distance]) looks at game ground position (x, y); __otm.paths(false) hides the sidewalk layer.
      const scene = this.scene;
      const helpers = {
        engine: this.engine,
        scene,
        goto: (x: number, y: number, radius = 60) => {
          const cam = scene.activeCamera as ArcRotateCamera;
          cam.target.set(x, 0, y);
          cam.radius = radius;
        },
        paths: (on: boolean) => (scene.getMaterialByName("terrain") as ShaderMaterial | null)?.setFloat("pathOn", on ? 1 : 0),
      };
      (window as unknown as { __otm?: unknown }).__otm = helpers;
    }
    this.engine.runRenderLoop(() => {
      this.tickCamera();
      this.scene?.render();
    });
    window.addEventListener("resize", this.onResize);
    window.addEventListener("keydown", this.onKey);
    this.engine.resize();
    this.canvas.focus();
  }

  exit(): void {
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKey);
    this.engine?.stopRenderLoop();
    this.input?.detach();
    this.devMenu?.dispose();
    this.menuBar?.dispose();
    this.hud?.remove();
    this.hud = this.devMenu = this.menuBar = this.input = this.gameCamera = this.gameBabylon = this.orbit = null;
    this.scene?.dispose();
    this.scene = null;
  }

  /** The menu bar, the dev menu and the game camera's Babylon stand-in. */
  private setupHud(scene: Scene): void {
    const w = this.world;
    this.gameCamera = null;
    if (w?.camera && w.lot) {
      this.gameCamera = new GameCamera(w.camera.normal, w.camera.globals, w.lot.bounds);
      const sc = w.lot.savedCamera;
      if (sc) this.gameCamera.restore({ x: sc.focus[0], y: sc.focus[1], z: sc.focus[2] }, sc.angle, sc.zoom);
      // Babylon's side of the game camera: its position, target and projection are set every frame from the port's numbers.
      this.gameBabylon = new FreeCamera("gameCamera", Vector3.Zero(), scene);
      this.gameBabylon.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED; // the game's fov is horizontal
      this.gameBabylon.maxZ = FAR_PLANE;
      this.gameBabylon.inputs.clear(); // the port moves it; no built-in controls
      this.input = new CameraInputSource(this.canvas);
    }

    this.hud = document.createElement("div");
    this.hud.className = "hud";
    document.body.append(this.hud);
    this.menuBar = new MenuBar(() => this.onExit());
    this.menuBar.mount(this.hud);
    this.devMenu = new DevMenu((m) => this.selectCamera(m), this.gameCamera !== null);
    this.devMenu.mount(this.hud);
  }

  private selectCamera(mode: CameraMode): void {
    if (!this.scene || !this.orbit) return;
    if (mode === "game" && !(this.gameCamera && this.gameBabylon && this.input)) return;
    this.mode = mode;
    if (mode === "game") {
      this.orbit.detachControl();
      this.input!.attach();
      this.scene.activeCamera = this.gameBabylon!;
      this.tickCamera(0); // place it before the first frame
    } else {
      this.input?.detach();
      this.orbit.attachControl(this.canvas, true);
      this.scene.activeCamera = this.orbit;
    }
    this.devMenu?.setCameraMode(mode);
  }

  /** Runs every frame: advances the game camera when it is the active one and refreshes the dev menu a few times a second. */
  private tickCamera(forcedDt?: number): void {
    const engine = this.engine;
    if (!engine || !this.scene) return;
    if (this.mode === "game" && this.gameCamera && this.gameBabylon && this.input) {
      const gc = this.gameCamera;
      const dt = forcedDt ?? Math.min(engine.getDeltaTime() / 1000, 0.25);
      const input = this.input.sample(dt);
      input.viewportW = engine.getRenderWidth();
      input.viewportH = engine.getRenderHeight();
      // Pointer positions are in CSS pixels, the viewport in render pixels: the camera only uses their ratio to the viewport, so scale them together.
      const k = engine.getRenderWidth() / window.innerWidth;
      input.mouseX *= k; input.mouseY *= k; input.mouseRelX *= k; input.mouseRelY *= k;
      gc.tick(input);
      const cam = this.gameBabylon;
      // game (x, y, z) -> Babylon (x, z, y)
      cam.position.set(gc.eye.x, gc.eye.z, gc.eye.y);
      cam.setTarget(new Vector3(gc.focus.x, gc.focus.z, gc.focus.y));
      cam.fov = gc.fov;
      cam.minZ = gc.near;
      cam.maxZ = FAR_PLANE;
    }
    if (++this.frame % 6 === 0) this.refreshDevMenu();
  }

  private refreshDevMenu(): void {
    if (!this.devMenu || !this.engine || !this.scene) return;
    const f = (v: number, d = 2) => v.toFixed(d);
    const v3 = (x: number, y: number, z: number) => `${f(x, 1)}, ${f(y, 1)}, ${f(z, 1)}`;
    const deg = (r: number) => `${f((r * 180) / Math.PI, 1)}°`;
    const w = this.world;
    const state: Record<string, Record<string, string>> = {
      Scene: {
        fps: f(this.engine.getFps(), 0),
        "camera in use": this.mode === "game" ? "game camera" : "default (orbit)",
        placements: w ? String(w.placements.length) : "none",
      },
    };
    const gc = this.gameCamera;
    if (this.mode === "game" && gc) {
      const d = gc.debug;
      const aspect = this.engine.getRenderWidth() / this.engine.getRenderHeight();
      const vfov = 2 * Math.atan(Math.tan(gc.fov / 2) / aspect);
      state["Game camera"] = {
        eye: v3(gc.eye.x, gc.eye.y, gc.eye.z),
        focus: v3(gc.focus.x, gc.focus.y, gc.focus.z),
        zoom: `${f(gc.zoom, 3)} / 0.8`,
        angle: deg(gc.angle),
        "fov (h / v)": `${deg(gc.fov)} / ${deg(vfov)}`,
        "lens scale": f(gc.fovScale, 2),
        "near / far": `${f(gc.near, 2)} / ${FAR_PLANE}`,
        "key velocity": `${f(d.keyVelX, 1)}, ${f(d.keyVelY, 1)}`,
        "edge velocity": `${f(d.edgeVelX, 1)}, ${f(d.edgeVelY, 1)}`,
        "edge scroll": d.edgeActive ? "active" : "off",
        "lot clamp": `${f(d.pushX, 2)}, ${f(d.pushY, 2)}`,
      };
      if (w?.lot) {
        const b = w.lot.bounds;
        state["Game camera"]!["lot rect"] = `x ${f(b.minX, 1)}..${f(b.maxX, 1)}, y ${f(b.minY, 1)}..${f(b.maxY, 1)}`;
      }
    } else if (this.orbit) {
      const o = this.orbit;
      state["Default camera"] = {
        target: v3(o.target.x, o.target.z, o.target.y),
        distance: f(o.radius, 1),
        "alpha / beta": `${deg(o.alpha)} / ${deg(o.beta)}`,
      };
    }
    this.devMenu.show(state);
  }
}
