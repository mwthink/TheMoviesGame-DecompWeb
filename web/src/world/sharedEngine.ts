import { Engine } from "@babylonjs/core/Engines/engine";

let engine: Engine | null = null;
let multisampling = false;

/** Whether the canvas gets the browser's own multisampling (MSAA). It is fixed when the engine is made, so call this before the first `sharedEngine`; later calls change nothing. */
export function setEngineMultisampling(on: boolean): void {
  if (!engine) multisampling = on;
}

/**
 * The one Babylon engine on the page canvas, made on first use. The game view and the character viewer both draw on that canvas, one at a time, and a new
 * WebGL context per visit would be wasteful (and a canvas gives out only one).
 */
export function sharedEngine(canvas: HTMLCanvasElement): Engine {
  engine ??= new Engine(canvas, multisampling, { preserveDrawingBuffer: false, stencil: true });
  return engine;
}
