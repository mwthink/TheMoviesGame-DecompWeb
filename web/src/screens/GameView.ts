import type { Engine } from "@babylonjs/core/Engines/engine";
import { sharedEngine } from "../world/sharedEngine.ts";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Culling/ray"; // side effect: adds Scene.pick
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { Screen } from "./Screen.ts";
import { buildWorld, type PeopleControl } from "../world/WorldScene.ts";
import type { Locomotion } from "../sim/anim/Gaits.ts";
import { buildRoomFloors, type RoomFloors } from "../world/RoomFloors.ts";
import { ALWAYS_RULE, distanceToPolygon, RevealTracker, revealRule, type RevealCandidate } from "../sim/ui/FloorplanReveal.ts";
import type { MshChunk } from "../formats/Msh.ts";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import type { WorldData } from "../world/WorldData.ts";
import { FAR_PLANE, GameCamera } from "../camera/GameCamera.ts";
import { CameraInputSource } from "../camera/CameraInput.ts";
import { DevMenu, type CameraMode } from "../ui/DevMenu.ts";
import { MenuBar } from "../ui/MenuBar.ts";
import { GameToolbar } from "../ui/GameToolbar.ts";
import { StaffPanel } from "../ui/StaffPanel.ts";
import { Tooltip } from "../ui/Tooltip.ts";
import { PauseMenu } from "../ui/PauseMenu.ts";
import { PersonDragger } from "../world/PersonDragger.ts";
import { applySun, createSunLights, type SunLights } from "../world/SunLight.ts";
import { DEFAULT_SHADOWS, DEFAULT_SUN, type ShadowSettings, type SunSettings } from "../world/Sun.ts";
import { SunShadows } from "../world/SunShadows.ts";
import { footprintOutline, FrustumLines, HoverHighlight, PerfStats, ShadowMapViewer } from "../world/DevViews.ts";
import { setDebugMode } from "../world/SunLight.ts";
import { skyVariantForYear, yearOfDate } from "../world/Sky.ts";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { FxaaPostProcess } from "@babylonjs/core/PostProcesses/fxaaPostProcess";
import type { Settings, SettingsStore } from "../settings/Settings.ts";
import { GameClock, SPEED_FACTOR, type GameSpeed } from "../sim/core/GameClock.ts";

interface RoomInfo { name: string; lines: string[]; x: number; y: number; chunk: MshChunk }
interface Meta { key: string; source: string; position: number[]; angle: number; rooms: RoomInfo[] }

/** The in-game view: a Babylon scene on the page canvas, showing the loaded world (or nothing when there is none). */
export class GameView implements Screen {
  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private readonly onResize = () => this.engine?.resize();
  private readonly onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !this.overlayOpen) this.togglePause(); };
  /** A screen shown over the running game (the Options screen from the pause menu) is open: Esc belongs to it. */
  private overlayOpen = false;
  private pauseMenu: PauseMenu | null = null;
  /** The speed to go back to when the pause menu closes. */
  private speedBeforePause: GameSpeed = "play";

  // Overlays and the cameras (see docs/CAMERA.md). The orbit camera is the default; the game camera is ported from the original's code.
  private hud: HTMLElement | null = null;
  private devMenu: DevMenu | null = null;
  private menuBar: MenuBar | null = null;
  private toolbar: GameToolbar | null = null;
  private staffPanel: StaffPanel | null = null;
  private tooltip: Tooltip | null = null;
  /** The game's date and speed (sim/core/GameClock.ts), advanced from the render loop at the original's fixed 10 Hz tick. */
  private clock = new GameClock(1920 * 365);
  /** Moves the flags on, by real frame time (world/WorldScene.ts `stepAutoAnimations`); independent of the clock and the pause. */
  private stepAutoAnimations: ((dtMs: number) => void) | null = null;
  /** Moves the people's animations on by game time (scaled by the speed buttons; frozen while paused). */
  private stepPeople: ((dtMs: number) => void) | null = null;
  private people: PeopleControl | null = null;
  /** The gait a right-click order walks at (dev menu). */
  private orderGait: Locomotion = 1;
  private rightDownAt: { x: number; y: number } | null = null;
  private peopleClips: (() => { name: string; clip: string; source: string }[]) | null = null;
  private autoAnimated: { model: string; clip: () => number }[] = [];
  private orbit: ArcRotateCamera | null = null;
  private gameCamera: GameCamera | null = null;
  private gameBabylon: FreeCamera | null = null;
  private input: CameraInputSource | null = null;
  private mode: CameraMode = "default";
  private frame = 0;

  // Hover cutaway: pointing at a building that has rooms cuts its shell away above CUT_HEIGHT and writes each room's name on its floor.
  private instances = new Map<string, { full: InstancedMesh[]; cut: InstancedMesh[] }>();
  private hoverAt: { x: number; y: number } | null = null;
  private hoverDirty = false;
  private hoverMs = 0;
  private hovered: { key: string; source: string; rooms: RoomInfo[] } | null = null;
  private floors: RoomFloors | null = null;
  /** Buildings with rooms, and which one's floor plan is showing (`FloorplanReveal.ts`). */
  private buildings: { meta: Meta; facility: string; footprint: { verts: Float32Array; tris: Uint16Array } | null }[] = [];
  private readonly reveal = new RevealTracker();
  private revealMs = 0;
  /** Dev menu: show a floor plan as soon as the pointer is over the building, whatever the game's rules say. */
  private revealAlways = false;
  /** The dev menu's sun (docs/LIGHTING.md) and the lights that light the people. */
  private sun: SunSettings = { ...DEFAULT_SUN };
  private sunLights: SunLights | null = null;
  private shadowSettings: ShadowSettings = { ...DEFAULT_SHADOWS };
  private shadows: SunShadows | null = null;
  /** Dev tools (docs/DEV_TOOLS.md): hover outline, the shadow frustum and map viewer, performance rows, the sky variant and the pointer's person. */
  private highlight: HoverHighlight | null = null;
  private frustum: FrustumLines | null = null;
  private frustumOn = false;
  private shadowViewer: ShadowMapViewer | null = null;
  private perf: PerfStats | null = null;
  private setSkyVariant: ((v: 0 | 1 | 2) => void) | null = null;
  private skyMode: "auto" | 0 | 1 | 2 = "auto";
  private skyShown: number = -1;
  private hoverPerson: TransformNode | null = null;
  private readonly onHoverMove = (e: PointerEvent) => {
    this.hoverAt = e.target === this.canvas && e.buttons === 0 ? { x: e.clientX, y: e.clientY } : null;
    this.hoverDirty = true;
  };
  /** What the last click hit, for the dev menu. */
  private lastClick: Record<string, string> = { object: "no click yet" };
  private downAt: { x: number; y: number } | null = null;
  /** Click-and-hold carries a person (world/PersonDragger.ts, docs/DRAGGING.md). */
  private dragger: PersonDragger | null = null;
  private readonly onDown = (e: PointerEvent) => {
    this.downAt = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    this.rightDownAt = e.button === 2 ? { x: e.clientX, y: e.clientY } : null;
    this.dragger?.down(e);
  };
  private readonly onContext = (e: Event) => e.preventDefault(); // right-click orders people, not the browser menu
  private readonly onDragMove = (e: PointerEvent) => this.dragger?.move(e);
  private readonly onUp = (e: PointerEvent) => {
    const d = this.downAt;
    this.downAt = null;
    const r = this.rightDownAt;
    this.rightDownAt = null;
    if (e.button === 2 && r && Math.hypot(e.clientX - r.x, e.clientY - r.y) <= 4) this.orderWalk(e.clientX, e.clientY);
    if (this.dragger?.up(e) === "dropped") return; // a person was carried: not a click
    if (!d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return; // a drag (orbit, rotate) is not a click
    this.pickAt(e.clientX, e.clientY);
  };

  /** The world to draw on the next enter(); null shows the blank placeholder scene. */
  world: WorldData | null = null;

  /** Resolves once the scene from the last enter() is compiled and has drawn a frame (or the view was exited first). */
  ready: Promise<void> = Promise.resolve();
  private resolveReady: (() => void) | null = null;

  private readonly settings: SettingsStore | null;
  private unsubscribeSettings: (() => void) | null = null;
  private fxaa: FxaaPostProcess[] = [];
  private fpsEl: HTMLElement | null = null;

  /** `onOptions` shows the Options screen over the running game and calls `done` when it is closed. */
  constructor(private readonly canvas: HTMLCanvasElement, private readonly onExit: () => void, settings: SettingsStore | null = null, private readonly onOptions: (done: () => void) => void = () => {}) {
    this.settings = settings;
  }

  enter(): void {
    // The engine is created on first entry and reused afterwards: a new WebGL context per visit is wasteful.
    this.engine ??= sharedEngine(this.canvas);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.04, 0.05, 0.08, 1);

    if (this.world) {
      const built = buildWorld(this.scene, this.canvas, this.world, { anisotropy: this.settings?.get().anisotropy });
      this.orbit = built.camera;
      this.instances = built.instances;
      this.buildings = this.world.placements
        .filter((p) => p.mesh.rooms.some((r) => r.lines.length))
        .map((p) => ({
          meta: { key: `${p.asset.source}#${p.asset.id}`, source: p.asset.source, position: p.asset.position, angle: p.asset.angle, rooms: p.mesh.rooms },
          facility: p.asset.source.slice(p.asset.source.lastIndexOf("/") + 1),
          footprint: p.mesh.msh.chunks.b15_02 ?? null,
        }));
      this.stepAutoAnimations = built.stepAutoAnimations;
      this.shadows = new SunShadows(this.scene, { min: { x: -192, y: 0, z: -128 }, max: { x: 192, y: 45, z: 256 } }, this.shadowSettings.size);
      for (const c of built.shadowCasters) this.shadows.addCaster(c.mesh, c.material);
      this.stepPeople = built.stepPeople;
      this.setSkyVariant = built.setSkyVariant;
      this.skyShown = -1;
      this.highlight = new HoverHighlight(this.scene);
      this.frustum = new FrustumLines(this.scene, () => this.shadows);
      this.perf = new PerfStats(this.scene, () => this.shadows);
      this.dragger = this.makeDragger(this.scene);
      this.peopleClips = built.peopleClips;
      this.people = built.peopleControl;
      this.autoAnimated = built.autoAnimated;
    } else {
      this.stepAutoAnimations = null;
      this.shadows = null;
      this.highlight = null;
      this.frustum = null;
      this.perf = null;
      this.setSkyVariant = null;
      this.stepPeople = null;
      this.peopleClips = null;
      this.people = null;
      this.autoAnimated = [];
      // A scene needs a camera to render. This one is a placeholder until the real game camera exists.
      this.orbit = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 3, 20, Vector3.Zero(), this.scene);
    }
    this.clock = new GameClock(this.world?.header?.date ?? 1920 * 365); // a fresh studio starts on 1 January 1920
    this.mode = "default";
    this.hovered = null;
    this.reveal.revealed = null;
    this.revealMs = performance.now();
    window.addEventListener("pointermove", this.onHoverMove);
    this.lastClick = { object: "no click yet" };
    this.canvas.addEventListener("pointerdown", this.onDown, true); // capture: before the orbit camera sees the press
    window.addEventListener("pointermove", this.onDragMove);
    this.canvas.addEventListener("pointerup", this.onUp);
    this.canvas.addEventListener("contextmenu", this.onContext);
    this.sun = { ...DEFAULT_SUN };
    this.shadowSettings = { ...DEFAULT_SHADOWS };
    this.sunLights = createSunLights(this.scene);
    this.setupHud(this.scene);
    applySun(this.scene, this.sunLights, this.sun);
    this.unsubscribeSettings = this.settings?.subscribe((s) => this.applySettings(s)) ?? null;
    if (this.settings) this.applySettings(this.settings.get());

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
    let frames = 0;
    const scene = this.scene;
    this.ready = new Promise<void>((resolve) => { this.resolveReady = resolve; });
    this.engine.runRenderLoop(() => {
      this.tickGame();
      this.tickCamera();
      this.updateHover();
      this.faceFloors();
      this.scene?.render();
      // Shaders compile in the background: count a frame as ready only once the scene reports ready and has drawn one.
      if (++frames >= 2 && scene.isReady()) this.finishReady();
    });
    void scene.whenReadyAsync().then(() => { if (this.scene === scene) this.finishReady(); });
    window.addEventListener("resize", this.onResize);
    window.addEventListener("keydown", this.onKey);
    this.engine.resize();
    this.canvas.focus();
  }

  private finishReady(): void {
    const resolve = this.resolveReady;
    this.resolveReady = null;
    resolve?.();
  }

  exit(): void {
    this.finishReady();
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKey);
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    for (const f of this.fxaa) f.dispose();
    this.fxaa = [];
    this.engine?.setHardwareScalingLevel(1);
    this.engine?.stopRenderLoop();
    window.removeEventListener("pointermove", this.onHoverMove);
    this.setHovered(null);
    this.canvas.removeEventListener("pointerdown", this.onDown, true);
    window.removeEventListener("pointermove", this.onDragMove);
    this.dragger = null;
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("contextmenu", this.onContext);
    this.input?.detach();
    this.devMenu?.dispose();
    this.menuBar?.dispose();
    this.toolbar?.dispose();
    this.pauseMenu?.dispose();
    this.pauseMenu = null;
    this.overlayOpen = false;
    this.staffPanel?.dispose();
    this.tooltip?.dispose();
    this.hud?.remove();
    this.stepAutoAnimations = null;
    this.highlight?.dispose();
    this.frustum?.dispose();
    this.shadowViewer?.dispose();
    this.perf?.dispose();
    this.highlight = this.frustum = this.shadowViewer = this.perf = null;
    this.setSkyVariant = null;
    this.shadows = null;
    this.stepPeople = null;
    this.peopleClips = null;
    this.people = null;
    this.hud = this.devMenu = this.menuBar = this.fpsEl = null;
    this.toolbar = this.staffPanel = this.tooltip = this.input = this.gameCamera = this.gameBabylon = this.orbit = null;
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
    this.menuBar = new MenuBar(() => this.togglePause());
    this.pauseMenu = new PauseMenu({
      onResume: () => this.togglePause(false),
      onOptions: () => { this.overlayOpen = true; this.pauseMenu?.close(); this.onOptions(() => { this.overlayOpen = false; this.pauseMenu?.open(); }); },
      onMainMenu: () => this.onExit(),
    });
    this.menuBar.mount(this.hud);
    this.toolbar = new GameToolbar((speed) => this.setSpeed(speed));
    this.toolbar.mount(this.menuBar.toolbar);
    this.toolbar.setSpeed(this.clock.speed);
    this.toolbar.setStatus(this.clock.date, w?.header?.cash ?? null);
    this.staffPanel = new StaffPanel(w?.staff ?? []);
    this.staffPanel.mount(this.hud);
    this.tooltip = new Tooltip();
    this.tooltip.attach(this.hud);
    this.devMenu = new DevMenu((m) => this.selectCamera(m), this.gameCamera !== null, (on) => { this.revealAlways = on; }, (s) => { this.sun = s; if (this.scene && this.sunLights) applySun(this.scene, this.sunLights, s); this.shadows?.update(this.sun, this.shadowSettings); this.frustum?.update(this.frustumOn); }, (s) => { this.shadowSettings = s; this.shadows?.update(this.sun, s); this.frustum?.update(this.frustumOn); }, {
      onTimeScale: (v) => { this.clock.timeScale = v; },
      onStep: () => this.stepOnce(),
      onWander: (on) => this.people?.setWander(on),
      onGait: (g) => { this.orderGait = g; },
      onDebugMode: (m) => { if (this.scene) setDebugMode(this.scene, m); },
      onSkyVariant: (v) => { this.skyMode = v; this.skyShown = -1; if (v !== "auto") { this.setSkyVariant?.(v); this.skyShown = v; } },
      onShadowFrustum: (on) => { this.frustumOn = on; this.frustum?.update(on); },
      onHighlight: (on) => this.highlight?.setEnabled(on),
      shadowViewCanvas: (canvas) => {
        if (canvas && this.engine && this.scene) this.shadowViewer ??= new ShadowMapViewer(this.engine, this.scene, () => this.shadows);
        this.shadowViewer?.setCanvas(canvas);
      },
    });
    this.devMenu.mount(this.hud);
    this.pauseMenu.mount(this.hud);
  }

  /**
   * Apply the settings that act on a running game view: render size (Babylon hardware scaling), the FXAA post-process on each camera, the frames-per-second
   * counter and the tooltips (help level). Texture sharpness is read when the world is built.
   */
  private applySettings(s: Readonly<Settings>): void {
    const engine = this.engine;
    if (!engine) return;
    engine.setHardwareScalingLevel(1 / s.renderScale);
    for (const f of this.fxaa) f.dispose();
    this.fxaa = [];
    if (s.smoothEdges) for (const cam of [this.orbit, this.gameBabylon]) if (cam) this.fxaa.push(new FxaaPostProcess("fxaa", 1, cam));
    if (!this.fpsEl && this.hud) {
      this.fpsEl = document.createElement("div");
      this.fpsEl.className = "fps";
      this.hud.append(this.fpsEl);
    }
    if (this.fpsEl) this.fpsEl.hidden = !s.showFps;
    this.tooltip?.setEnabled(s.helpLevel !== "none");
  }

  /**
   * Open or close the pause menu (`open` forces one way). Opening pauses the game clock, remembering the speed; closing puts the speed back. The flags and the camera are not
   * part of the simulation and keep running behind the menu.
   */
  private togglePause(open = !this.pauseMenu?.isOpen): void {
    const menu = this.pauseMenu;
    if (!menu || open === menu.isOpen) return;
    if (open) {
      this.speedBeforePause = this.clock.speed;
      this.setSpeed("pause");
      menu.open();
    } else {
      menu.close();
      this.setSpeed(this.speedBeforePause);
      this.canvas.focus();
    }
  }

  /** Dev menu: run one simulation tick now (0.1 s of game time), for watching motion step by step while paused. */
  private stepOnce(): void {
    this.clock.tick();
    this.toolbar?.setStatus(this.clock.date, this.world?.header?.cash ?? null);
    this.stepPeople?.(100);
  }

  /** The toolbar's speed buttons: pause, play (1x) or fast. Only the game clock changes; flags and the camera keep running (docs/AUTO_ANIMATION.md). */
  private setSpeed(speed: GameSpeed): void {
    this.clock.speed = speed;
    this.toolbar?.setSpeed(speed);
  }

  /**
   * Once per rendered frame: advance the game clock by the frame's real time (it turns that into 0.1 s simulation ticks scaled by the speed; none while
   * paused), refresh the toolbar, and step the flags by the same real frame time, which the original also does outside the simulation tick.
   */
  private tickGame(): void {
    const engine = this.engine;
    if (!engine) return;
    const dtMs = engine.getDeltaTime();
    if (this.clock.advance(dtMs / 1000) > 0) this.toolbar?.setStatus(this.clock.date, this.world?.header?.cash ?? null);
    this.stepAutoAnimations?.(dtMs);
    this.dragger?.tick(dtMs);
    // people animate in game time: the speed buttons scale it and a pause freezes them [guess, docs/PEOPLE.md]
    const factor = SPEED_FACTOR[this.clock.speed];
    if (factor > 0) this.stepPeople?.(Math.min(dtMs, 99) * factor * this.clock.timeScale);
    if (this.skyMode === "auto") {
      const v = skyVariantForYear(yearOfDate(this.clock.date));
      if (v !== this.skyShown) { this.setSkyVariant?.(v); this.skyShown = v; }
    }
  }

  /** Right-click: the person last pressed on walks to the ground point (game x, y = scene x, z). */
  private orderWalk(clientX: number, clientY: number): void {
    const id = this.dragger?.lastPressed;
    const engine = this.engine;
    if (!id || !engine || !this.people) return;
    const k = engine.getRenderWidth() / window.innerWidth;
    const g = this.groundPoint(clientX * k, clientY * k);
    if (!g) return;
    const ok = this.people.walkTo(id, g.x, g.z, this.orderGait);
    const name = this.world?.people.find((p) => p.person.id === id)?.person.name || "Someone";
    this.lastClick = { object: ok ? `${name} sent walking` : `${name}: no route`, position: `${g.x.toFixed(1)}, ${g.z.toFixed(1)}` };
  }

  /** Pick the placed object under a canvas pixel (terrain is not pickable) and record it for the dev menu. */
  private pickAt(clientX: number, clientY: number): void {
    const scene = this.scene, engine = this.engine;
    if (!scene || !engine) return;
    const k = engine.getRenderWidth() / window.innerWidth;
    const hit = scene.pick(clientX * k, clientY * k, (m) => m.isPickable && m.isEnabled());
    const f = (v: number) => v.toFixed(1);
    if (!hit?.hit || !hit.pickedMesh) {
      this.lastClick = { object: "nothing" };
    } else {
      const md = (hit.pickedMesh.metadata ?? {}) as { cls?: string; id?: number; source?: string; model?: string; position?: number[] };
      const p = hit.pickedPoint;
      this.lastClick = {
        object: md.source ?? hit.pickedMesh.name,
        class: md.cls ?? "?",
        id: md.id === undefined ? "?" : String(md.id),
        model: md.model ?? "?",
        position: md.position ? md.position.map(f).join(", ") : "?",
        "hit point": p ? `${f(p.x)}, ${f(p.z)}, ${f(p.y)}` : "?", // Babylon (x, y, z) -> game (x, z, y)
        distance: hit.distance.toFixed(1),
      };
    }
    this.refreshDevMenu();
  }

  /**
   * Every 100 ms: name a person under the pointer in the tooltip, and decide which building's floor plan shows. The decision is the game's (`FloorplanReveal.ts`, from
   * `floorplanrevealing.csv`): each building has a distance the pointer must be within, a time it must stay there and a distance at which the walls come back; with an empty
   * cursor most buildings reveal after 2 s over them. A building under the pointer counts as distance 0; the others are measured on the ground from the pointer to their footprint.
   */
  private updateHover(): void {
    if (!this.scene || !this.engine) return;
    const now = performance.now();
    if (now - this.hoverMs < 100) return;
    this.hoverMs = now;
    const dt = Math.min((now - this.revealMs) / 1000, 1);
    this.revealMs = now;
    const at = this.hoverAt;
    const k = this.engine.getRenderWidth() / window.innerWidth;
    let underPointer: string | null = null;
    const ground = at ? this.groundPoint(at.x * k, at.y * k) : null;
    if (this.hoverDirty) {
      this.hoverDirty = false;
      if (!at) { this.tooltip?.show(null); this.hoverPerson = null; }
      else {
        // a person under the pointer: their name goes to the tooltip
        const who = this.scene.pick(at.x * k, at.y * k, (m) => m.isPickable && m.isEnabled() && !!(m.metadata as { person?: unknown } | null)?.person);
        const person = who?.hit ? (who.pickedMesh?.metadata as { person: { name: string; cls: string } }).person : null;
        this.hoverPerson = who?.hit ? ((who.pickedMesh?.parent as TransformNode | null) ?? null) : null;
        this.tooltip?.show(!this.dragger?.active && person ? `${person.name || "Someone"}${person.cls === "CStar" ? " (star)" : person.cls === "CWannabe" ? " (wannabe)" : ""}` : null);
        if (!this.dragger?.active) this.canvas.style.cursor = person ? "grab" : "";
      }
    }
    if (at) {
      const hit = this.scene.pick(at.x * k, at.y * k, (m) => m.isPickable && m.isEnabled() && ((m.metadata as Meta | null)?.rooms?.some((r) => r.lines.length) ?? false));
      underPointer = hit?.hit ? ((hit.pickedMesh?.metadata as Meta | null)?.key ?? null) : null;
    }
    // outline what the pointer is over: a person, else a building (through clones of the instances that are showing)
    if (this.hoverPerson && !this.dragger?.active) this.highlight?.setPerson(this.hoverPerson);
    else if (underPointer) {
      const b = this.buildings.find((x) => x.meta.key === underPointer);
      const scale = this.instances.get(underPointer)?.full[0]?.scaling.x ?? 1;
      this.highlight?.setBuilding(underPointer, b?.footprint ? footprintOutline(b.footprint, b.meta.position, b.meta.angle, scale, 0.2) : []);
    } else this.highlight?.setPerson(null);
    const candidates: RevealCandidate[] = this.buildings.map((b) => {
      let distance = Infinity;
      if (b.meta.key === underPointer) distance = 0;
      else if (ground && b.footprint) {
        // the ground point in the building's own coordinates: undo its position and its counter-clockwise turn (scene x, z = game x, y)
        const dx = ground.x - b.meta.position[0]!, dy = ground.z - b.meta.position[1]!;
        const c = Math.cos(b.meta.angle), s = Math.sin(b.meta.angle);
        distance = distanceToPolygon(b.footprint, dx * c + dy * s, -dx * s + dy * c);
      }
      return { key: b.meta.key, rule: this.revealAlways ? ALWAYS_RULE : revealRule(this.world?.floorplanRules ?? null, b.facility), distance };
    });
    const shown = this.reveal.update(dt, candidates);
    this.setHovered(shown ? this.buildings.find((b) => b.meta.key === shown)?.meta ?? null : null);
  }

  /** The dragger for the people of this world: it needs the ground under the cursor, the camera handed over, and a rule for where a drop is allowed. */
  private makeDragger(scene: Scene): PersonDragger {
    return new PersonDragger(scene, this.canvas, {
      groundPoint: (px, py) => this.groundPoint(px, py),
      scale: () => (this.engine ? this.engine.getRenderWidth() / window.innerWidth : 1),
      suspendCamera: () => { if (this.mode === "default") this.orbit?.detachControl(); },
      resumeCamera: () => { if (this.mode === "default") this.orbit?.attachControl(this.canvas, true); },
      // [guess] CanDropHere (orig 0x0053A560) is about rooms and held objects; with neither, anywhere on the ground the world draws is allowed
      canDrop: (x, z) => x >= -192 && x <= 192 && z >= -128 && z <= 256,
      held: (id, held) => this.people?.hold(id, held),
      dropped: (id, x, z) => {
        this.people?.place(id, x, z);
        const entry = this.world?.people.find((p) => p.person.id === id);
        if (entry) { entry.person.position = [x, z, entry.person.position[2]]; this.lastClick = { object: `${entry.person.name} put down`, position: `${x.toFixed(1)}, ${z.toFixed(1)}` }; }
      },
    });
  }

  /** Where the ray through a canvas pixel meets the ground (scene y = 0), or null when it points at the sky. */
  private groundPoint(px: number, py: number): { x: number; z: number } | null {
    const cam = this.scene?.activeCamera;
    if (!this.scene || !cam) return null;
    const ray = this.scene.createPickingRay(px, py, Matrix.Identity(), cam);
    if (ray.direction.y >= -1e-4) return null;
    const t = -ray.origin.y / ray.direction.y;
    return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
  }

  /** Turn the room text of the showing floor plan to read upright from the camera (the game flips it by the camera angle each frame). */
  private faceFloors(): void {
    const cam = this.scene?.activeCamera;
    if (!this.floors || !cam) return;
    const f = cam.getForwardRay().direction;
    const len = Math.hypot(f.x, f.z) || 1;
    const forward = { x: f.x / len, z: f.z / len };
    this.floors.faceCamera({ x: forward.z, z: -forward.x }, forward); // screen-right in the scene's left-handed ground plane
  }

  /** Cut the shell of the hovered building away (or put it back) and draw (or remove) its room floors. */
  private setHovered(md: Meta | null): void {
    if (md?.key === this.hovered?.key) return;
    this.showCutaway(this.hovered?.key, false);
    this.floors?.dispose();
    this.floors = null;
    this.hovered = null;
    if (!md || !this.scene) return;
    this.showCutaway(md.key, true);
    this.hovered = { key: md.key, source: md.source, rooms: md.rooms };
    this.floors = buildRoomFloors(this.scene, md.rooms, { x: md.position[0]!, y: md.position[1]!, angle: md.angle });
  }

  /** Swap a building between its whole model and its cutaway model. */
  private showCutaway(key: string | undefined, on: boolean): void {
    const set = key ? this.instances.get(key) : undefined;
    if (!set) return;
    for (const i of set.full) i.setEnabled(!on);
    for (const i of set.cut) i.setEnabled(on);
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
    if (++this.frame % 6 === 0) {
      this.refreshDevMenu();
      if (this.fpsEl && !this.fpsEl.hidden) this.fpsEl.textContent = `${engine.getFps().toFixed(0)} fps`;
    }
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
    state["Time"] = {
      date: this.toolbar ? this.clock.date.toFixed(3) : "",
      speed: this.clock.speed,
      "ticks run": String(this.clock.ticks),
      "ticks per day": String(this.clock.ticksPerDay),
      "waving models": this.autoAnimated.length ? this.autoAnimated.map((a) => `${a.model} (clip ${a.clip()})`).join(", ") : "none",
    };
    const clips = this.peopleClips?.() ?? [];
    if (clips.length) {
      state["People"] = { animating: String(clips.length), "from room scenes": String(clips.filter((c) => !c.source.startsWith("fallback")).length), "fallback idle": String(clips.filter((c) => c.source.startsWith("fallback")).length) };
    }
    if (this.perf) state["Performance"] = this.perf.rows();
    state["Last click"] = this.lastClick;
    state["Hover"] = this.hovered ? { building: this.hovered.source, rooms: this.hovered.rooms.map((r) => r.name.replace(/^room_/, "")).join(", ") } : { building: "none" };
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
