/**
 * Turns browser events into the per-frame `CameraInput` the game camera reads. The mapping of engine key codes to physical keys comes from the
 * game's own scancode table (docs/CAMERA.md, "Input"): engine 0x0B..0x24 are the letters, 0x6B..0x6E the arrows, 0x38/0x39 the Ctrl keys, 0x3A/0x3B
 * the Shift keys; the camera's four scroll actions are bound by default to W A S D and the arrow keys.
 * Not confirmed against the running game: which mouse button is engine 0x75 (assumed the middle one) and what engine keys 0x7D..0x80 are (left unmapped).
 */
import { emptyInput, type CameraInput } from "./GameCamera.ts";

const LEFT = ["ArrowLeft", "KeyA"], RIGHT = ["ArrowRight", "KeyD"], FORWARD = ["ArrowUp", "KeyW"], BACK = ["ArrowDown", "KeyS"];
const CTRL = ["ControlLeft", "ControlRight"], SHIFT = ["ShiftLeft", "ShiftRight"];
/** Pixels from the window edge that count as "at the edge" (a browser pointer cannot go past it, the original's can). */
const EDGE_ZONE = 1;

export class CameraInputSource {
  private readonly keys = new Set<string>();
  private x = 0;
  private y = 0;
  private relX = 0;
  private relY = 0;
  private latchX = 0;
  private latchY = 0;
  private wasInZone = false;
  private middleDown = false;
  private wheel = 0;
  /** Whether the pointer has been seen over the page at all (before that the position is meaningless). */
  seenPointer = false;
  edgeScrollEnabled = true;

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    this.keys.add(e.code);
    if (e.code.startsWith("Arrow")) e.preventDefault(); // do not scroll the page
  };
  private readonly onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private readonly onBlur = () => { this.keys.clear(); this.middleDown = false; };
  private readonly onMove = (e: PointerEvent) => {
    this.x = e.clientX; this.y = e.clientY;
    this.relX += e.movementX; this.relY += e.movementY;
    this.seenPointer = true;
    // The original reads relative device motion, which keeps coming after the pointer reaches the edge; a browser's stops. Remember the motion
    // that carried the pointer into the edge zone and keep reporting it while the pointer stays there.
    const inZone = this.inZone();
    if (inZone && !this.wasInZone) { this.latchX = e.movementX; this.latchY = e.movementY; }
    if (!inZone) { this.latchX = 0; this.latchY = 0; }
    this.wasInZone = inZone;
  };
  private readonly onDown = (e: PointerEvent) => { if (e.button === 1) { this.middleDown = true; e.preventDefault(); } };
  private readonly onUp = (e: PointerEvent) => { if (e.button === 1) this.middleDown = false; };
  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // Wheel units as Windows reports them: 120 per notch. A mouse notch is 100 pixels in Chromium, a line-mode notch 3 lines. Unconfirmed for the original.
    const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 120 * 10 : 1.2;
    this.wheel += -e.deltaY * k;
  };
  private readonly onContext = (e: Event) => { if (this.middleDown) e.preventDefault(); };

  constructor(private readonly canvas: HTMLCanvasElement) {}

  attach(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    this.canvas.addEventListener("pointerdown", this.onDown);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("contextmenu", this.onContext);
  }

  detach(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContext);
    this.keys.clear();
    this.wheel = this.relX = this.relY = 0;
  }

  private inZone(): boolean {
    return this.x <= EDGE_ZONE || this.y <= EDGE_ZONE || this.x >= window.innerWidth - 1 - EDGE_ZONE || this.y >= window.innerHeight - 1 - EDGE_ZONE;
  }

  private any(codes: string[]): boolean { return codes.some((c) => this.keys.has(c)); }

  /** The input for one frame; the wheel and the pointer motion are consumed. */
  sample(dt: number): CameraInput {
    const i = emptyInput();
    i.dt = dt;
    i.left = this.any(LEFT); i.right = this.any(RIGHT); i.forward = this.any(FORWARD); i.back = this.any(BACK);
    i.rotateModifier = this.any(CTRL);
    i.fastModifier = this.any(SHIFT);
    const w = window.innerWidth, h = window.innerHeight;
    i.viewportW = w; i.viewportH = h;
    const zone = this.seenPointer && this.inZone();
    // At the edge the camera tests mouseX <= 0 or >= width: snap the position onto the border.
    i.mouseX = zone && this.x <= EDGE_ZONE ? 0 : zone && this.x >= w - 1 - EDGE_ZONE ? w : this.x;
    i.mouseY = zone && this.y <= EDGE_ZONE ? 0 : zone && this.y >= h - 1 - EDGE_ZONE ? h : this.y;
    if (!this.seenPointer) { i.mouseX = w / 2; i.mouseY = h / 2; }
    i.mouseRelX = zone ? this.latchX : this.relX;
    i.mouseRelY = zone ? this.latchY : this.relY;
    i.windowFocused = document.hasFocus();
    i.edgeScrollEnabled = this.edgeScrollEnabled;
    i.rotateDrag = this.middleDown;
    i.wheel = this.wheel;
    this.wheel = 0;
    this.relX = 0; this.relY = 0;
    return i;
  }
}
