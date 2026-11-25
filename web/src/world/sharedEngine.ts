import { Engine } from "@babylonjs/core/Engines/engine";

let engine: Engine | null = null;

/**
 * The one Babylon engine on the page canvas, made on first use. The game view and the character viewer both draw on that canvas, one at a time, and a new
 * WebGL context per visit would be wasteful (and a canvas gives out only one).
 */
export function sharedEngine(canvas: HTMLCanvasElement): Engine {
  engine ??= new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
  return engine;
}
