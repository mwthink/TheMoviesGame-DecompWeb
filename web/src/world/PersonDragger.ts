import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { holdBegins, hoverLift, hoverYaw, returnStep, RETURN_TICK_SECONDS } from "../sim/ui/PersonDrag.ts";

/** What `PersonDragger` needs from the game view. */
export interface DragHost {
  /** Where the ray through a canvas pixel (render pixels) meets the ground, in scene (x, z); null for a ray that misses it. */
  groundPoint(px: number, py: number): { x: number; z: number } | null;
  /** Convert a client position to render pixels (the engine's render size over the window's). */
  scale(): number;
  /** Stop and restart the camera's own handling of the mouse (orbit) while a person is held. */
  suspendCamera(): void;
  resumeCamera(): void;
  /** Whether a person may be put down at a scene (x, z); a drop that is not allowed sends the person back. */
  canDrop(x: number, z: number): boolean;
  /** A person was put down for good at scene (x, z) (game x, y). */
  dropped(personId: number, x: number, z: number): void;
  /** A person was picked up (true) or is no longer held, put down or back where they were (false). */
  held?(personId: number, held: boolean): void;
}

type Phase = "idle" | "pressed" | "held" | "returning";

/**
 * Click-and-hold to carry a person (docs/DRAGGING.md): press on a person and hold (or move) to pick them up, move to carry them over the ground, release to put them down. A
 * short press is left to the normal click handling. A held person hangs a little above the ground and sways (`PersonDrag.ts`); a drop the host refuses sends them back to
 * where they were picked up the way the original does.
 */
export class PersonDragger {
  private phase: Phase = "idle";
  private node: TransformNode | null = null;
  private personId = 0;
  private pressAt = { x: 0, y: 0, ms: 0 };
  private pointer = { x: 0, y: 0 };
  /** Where and how the person stood when picked up (the node's position and facing). */
  private rest = { x: 0, y: 0, z: 0, yaw: 0 };
  private returnAccumulator = 0;
  /** The person last pressed on (picked up or just clicked), 0 for none. */
  lastPressed = 0;

  constructor(private readonly scene: Scene, private readonly canvas: HTMLCanvasElement, private readonly host: DragHost) {}

  /** True while a person is being carried or is on the way back. */
  get active(): boolean { return this.phase === "held" || this.phase === "returning"; }

  /** The person under a client position, or null. */
  private personAt(clientX: number, clientY: number): TransformNode | null {
    const k = this.host.scale();
    const hit = this.scene.pick(clientX * k, clientY * k, (m) => m.isPickable && m.isEnabled() && !!(m.metadata as { person?: unknown } | null)?.person);
    const parent = hit?.hit ? hit.pickedMesh?.parent : null;
    return parent && (parent.metadata as { person?: unknown } | null)?.person ? (parent as TransformNode) : null;
  }

  /** A left press. Returns true when it landed on a person (the camera is then kept from also taking the mouse). */
  down(e: PointerEvent): boolean {
    if (e.button !== 0 || this.phase === "held") return false;
    const node = this.personAt(e.clientX, e.clientY);
    if (!node) return false;
    if (this.phase === "returning") this.finishReturn();
    this.node = node;
    this.personId = (node.metadata as { person: { id: number } }).person.id;
    this.lastPressed = this.personId;
    this.pressAt = { x: e.clientX, y: e.clientY, ms: performance.now() };
    this.pointer = { x: e.clientX, y: e.clientY };
    this.phase = "pressed";
    this.host.suspendCamera();
    return true;
  }

  move(e: PointerEvent): void {
    this.pointer = { x: e.clientX, y: e.clientY };
    if (this.phase === "pressed" && holdBegins(performance.now() - this.pressAt.ms, Math.hypot(e.clientX - this.pressAt.x, e.clientY - this.pressAt.y))) this.pickUp();
  }

  /** A left release. Returns "click" for a press that never became a hold (the caller handles it as a click), "dropped" when a person was carried, "none" otherwise. */
  up(e: PointerEvent): "click" | "dropped" | "none" {
    if (e.button !== 0) return "none";
    if (this.phase === "pressed") {
      this.phase = "idle";
      this.host.resumeCamera();
      return "click";
    }
    if (this.phase !== "held" || !this.node) return "none";
    const node = this.node;
    this.canvas.style.cursor = "";
    this.host.resumeCamera();
    if (this.host.canDrop(node.position.x, node.position.z)) {
      node.position.y = this.rest.z; // set down on the ground (their own floor height)
      node.rotation.y = this.rest.yaw;
      this.phase = "idle";
      this.host.held?.(this.personId, false);
      this.host.dropped(this.personId, node.position.x, node.position.z);
    } else {
      this.phase = "returning";
      this.returnAccumulator = 0;
    }
    return "dropped";
  }

  private pickUp(): void {
    const node = this.node!;
    this.rest = { x: node.position.x, y: node.position.z, z: node.position.y, yaw: node.rotation.y };
    this.phase = "held";
    this.host.held?.(this.personId, true);
    this.canvas.style.cursor = "grabbing";
  }

  /** Every frame: carry the held person to the cursor's ground point, or step a returning person back. `dtMs` is real frame time. */
  tick(dtMs: number): void {
    const node = this.node;
    if (!node) return;
    if (this.phase === "held") {
      const k = this.host.scale();
      const g = this.host.groundPoint(this.pointer.x * k, this.pointer.y * k);
      const ms = performance.now();
      if (g) { node.position.x = g.x; node.position.z = g.z; }
      node.position.y = this.rest.z + hoverLift(ms);
      node.rotation.y = this.rest.yaw + hoverYaw(ms);
    } else if (this.phase === "returning") {
      this.returnAccumulator += dtMs / 1000;
      while (this.returnAccumulator >= RETURN_TICK_SECONDS && this.phase === "returning") {
        this.returnAccumulator -= RETURN_TICK_SECONDS;
        const s = returnStep({ x: node.position.x, y: node.position.z }, { x: this.rest.x, y: this.rest.y });
        node.position.x = s.x;
        node.position.z = s.y;
        if (s.done) this.finishReturn();
      }
    }
  }

  private finishReturn(): void {
    const node = this.node;
    if (node) { node.position.set(this.rest.x, this.rest.z, this.rest.y); node.rotation.y = this.rest.yaw; }
    this.phase = "idle";
    this.host.held?.(this.personId, false);
  }
}
