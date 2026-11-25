import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Screen } from "./Screen.ts";
import { buildWorld } from "../world/WorldScene.ts";
import type { WorldData } from "../world/WorldData.ts";

/** The in-game view: a Babylon scene on the page canvas, showing the loaded world (or nothing when there is none). */
export class GameView implements Screen {
  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private readonly onResize = () => this.engine?.resize();
  private readonly onKey = (e: KeyboardEvent) => { if (e.key === "Escape") this.onExit(); };

  /** The world to draw on the next enter(); null shows the blank placeholder scene. */
  world: WorldData | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly onExit: () => void) {}

  enter(): void {
    // The engine is created on first entry and reused afterwards: a new WebGL context per visit is wasteful.
    this.engine ??= new Engine(this.canvas, true, { preserveDrawingBuffer: false, stencil: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.04, 0.05, 0.08, 1);

    if (this.world) {
      buildWorld(this.scene, this.canvas, this.world);
    } else {
      // A scene needs a camera to render. This one is a placeholder until the real game camera exists.
      new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 3, 20, Vector3.Zero(), this.scene);
    }

    if (import.meta.env.DEV) (window as unknown as { __otm?: unknown }).__otm = { engine: this.engine, scene: this.scene }; // for poking at the scene from the console
    this.engine.runRenderLoop(() => this.scene?.render());
    window.addEventListener("resize", this.onResize);
    window.addEventListener("keydown", this.onKey);
    this.engine.resize();
    this.canvas.focus();
  }

  exit(): void {
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKey);
    this.engine?.stopRenderLoop();
    this.scene?.dispose();
    this.scene = null;
  }
}
