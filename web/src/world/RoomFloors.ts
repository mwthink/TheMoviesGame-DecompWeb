/**
 * The floors of a building's rooms, drawn when its floor plan is revealed (docs/ROOM_DISPLAY.md): each room's floor polygon (a `room_*` part of the model) filled with the
 * game's room colour, its boundary drawn as a wall outline, and the room's text written on the floor the way the game places it (`sim/ui/RoomText.ts`).
 *
 * [data] The floor colour is the game's "normal" and "hover" room tint (178, 223, 252), read from the executable (`TMRoom_SetHighlightHover`, `TMRoom_ClearHighlight`; the other
 * tints are in `ROOM_COLOURS`). The ink and the wall outline are not known: dark blue is a guess from how the game looks.
 */
import { Engine } from "@babylonjs/core/Engines/engine";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { Scene } from "@babylonjs/core/scene";
import type { MshChunk } from "../formats/Msh.ts";
import { fitLine, lineStrips, roomHasNoText, roomTextLayout, TEXT_HEIGHT, textNeedsFlip } from "../sim/ui/RoomText.ts";
import { registerShaders } from "./shaders.ts";
import { makeTexture } from "./textures.ts";

/**
 * The room tints the game uses (ARGB constants at 0x00E66054..0x00E6606C, set through `Object_SetSubMeshColor` by the `TMRoom_SetHighlight*` functions) as 0-255 RGB.
 * Normal and hover are the same colour. A *selected* room pulses: its colour is scaled by |sin(2 pi t / 20)| (`TMRoom_PulseHighlight`, orig 0x0093B140).
 */
export const ROOM_COLOURS = {
  normal: [178, 223, 252],
  hover: [178, 223, 252],
  selectable: [152, 197, 226],
  selected: [137, 253, 134],
  invalid: [255, 120, 120],
  disabled: [64, 73, 88],
} as const;

export const FLOOR_COLOUR = "#b2dffc";
export const INK_COLOUR = "#16307a";

export interface RoomFloor { name: string; lines: string[]; chunk: MshChunk }

/** Heights above the building's own floor level: the cutaway interior's floor can be a little above ground level, so the room floors sit clear of it. */
const FLOOR_Y = 0.15;
const TEXT_Y = 0.16;
const WALL_Y = 0.17;
const WALL_WIDTH = 0.25; // world units
const PIXELS_PER_UNIT = 64;

/** The boundary edges of a triangle set: edges used by exactly one triangle. */
function boundary(chunk: MshChunk): [number, number][] {
  const count = new Map<number, number>();
  const n = chunk.verts.length / 3;
  for (let t = 0; t < chunk.tris.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = chunk.tris[t + k]!, b = chunk.tris[t + (k + 1) % 3]!;
      const key = Math.min(a, b) * n + Math.max(a, b);
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  const out: [number, number][] = [];
  for (const [key, c] of count) if (c === 1) out.push([Math.floor(key / n), key % n]);
  return out;
}

/** The bounding box of a room polygon in model coordinates (x, y on the ground). */
function bounds(chunk: MshChunk): { min: { x: number; y: number }; max: { x: number; y: number } } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < chunk.verts.length; i += 3) {
    minX = Math.min(minX, chunk.verts[i]!); maxX = Math.max(maxX, chunk.verts[i]!);
    minY = Math.min(minY, chunk.verts[i + 1]!); maxY = Math.max(maxY, chunk.verts[i + 1]!);
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

/** One line of room text: a quad in the strip's frame whose corners and picture turn when the camera sees the text from behind. */
interface TextLine {
  mesh: Mesh;
  /** The text's aspect and the strip it lives in. */
  aspect: number;
  layout: ReturnType<typeof roomTextLayout>;
  index: number;
  count: number;
  flipped: boolean;
}

/** Fill the quad's vertices for a line, unflipped or flipped (`lineStrips` swaps the strips; the picture turns half way round). */
function placeLine(l: TextLine, flipped: boolean): void {
  const { anchor, size, rotation } = l.layout;
  const fit = fitLine(l.aspect, size);
  const strip = lineStrips(l.count, flipped)[l.index]!;
  const u0 = fit.offsetAlong, u1 = u0 + fit.width;
  const v0 = strip.from + fit.offsetAcross, v1 = v0 + fit.height;
  const c = Math.cos(rotation), s = Math.sin(rotation);
  const at = (u: number, v: number) => [anchor.x + u * c - v * s, TEXT_Y - FLOOR_Y, anchor.y + u * s + v * c] as const; // model (x, y) -> (x, up, z)
  const corners = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
  const positions = new Float32Array(12);
  corners.forEach((p, i) => positions.set(p, i * 3));
  l.mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
  l.mesh.updateVerticesData(VertexBuffer.UVKind, Float32Array.from(flipped ? [1, 1, 0, 1, 0, 0, 1, 0] : [0, 0, 1, 0, 1, 1, 0, 1]));
  l.flipped = flipped;
}

/** Draw a line of text in bold ink on a transparent canvas as wide as the text needs; returns the texture and the text's aspect (width over height). */
function textTexture(scene: Scene, text: string, name: string): { tex: DynamicTexture; aspect: number } {
  const heightPx = Math.round(TEXT_HEIGHT * PIXELS_PER_UNIT);
  const probe = document.createElement("canvas").getContext("2d")!;
  const font = `bold ${Math.round(heightPx * 0.78)}px sans-serif`;
  probe.font = font;
  const widthPx = Math.max(16, Math.ceil(probe.measureText(text).width) + 8);
  const tex = new DynamicTexture(name, { width: widthPx, height: heightPx }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, widthPx, heightPx);
  ctx.font = font;
  ctx.fillStyle = INK_COLOUR;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, widthPx / 2, heightPx / 2 + 1);
  tex.hasAlpha = true;
  tex.update();
  return { tex, aspect: widthPx / heightPx };
}

/** The handle `buildRoomFloors` returns. */
export interface RoomFloors {
  /** Turn each line of text to read upright from the camera: `right` and `forward` are its screen-right and forward directions on the ground, in scene (x, z) coordinates. */
  faceCamera(right: { x: number; z: number }, forward: { x: number; z: number }): void;
  dispose(): void;
}

/**
 * Build the floors for one placed building. `x`, `y`, `angle` are its game position and rotation. Rooms whose name contains `hall` get no text
 * (`roomHasNoText`); the others write their lines (at most two) along the strip `roomTextLayout` gives, 1.5 units tall, shrunk to fit.
 */
export function buildRoomFloors(scene: Scene, rooms: RoomFloor[], at: { x: number; y: number; angle: number }): RoomFloors {
  registerShaders();
  const parts: { dispose(): void }[] = [];
  const root = new TransformNode("room/root", scene);
  root.position.set(at.x, FLOOR_Y, at.y);
  root.rotation.y = -at.angle; // counter-clockwise seen from above in the game = this in the mirrored space
  parts.push(root);
  const flat = (name: string) => new ShaderMaterial(name, scene, "otmFlat", { attributes: ["position", "uv"], uniforms: ["world", "viewProjection", "tint", "useTex"], samplers: ["tex"] });
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

  // Floors: one mesh, every room polygon in the room colour.
  const floorMat = flat("roomFloor");
  // Solid colours go through the textured path (a 1 x 1 texture): that is how the floors were drawn when they first worked; the shader's flat-tint path did not draw.
  const solidColour = (hex: string) => {
    const [r, g, b] = rgb(hex).map((v) => Math.round(v * 255));
    return makeTexture(scene, { width: 1, height: 1, data: new Uint8Array([r!, g!, b!, 255]) }, { mips: false, clamp: true });
  };
  const floorTex = solidColour(FLOOR_COLOUR);
  parts.push(floorTex);
  floorMat.setTexture("tex", floorTex);
  floorMat.setFloat("useTex", 1);
  floorMat.setFloats("tint", [1, 1, 1, 1]);
  floorMat.backFaceCulling = false;
  floorMat.zOffset = -8;
  parts.push(floorMat);
  const fPos: number[] = [], fIdx: number[] = [];
  const wallMat = flat("roomWalls");
  const wallTex = solidColour(INK_COLOUR);
  parts.push(wallTex);
  wallMat.setTexture("tex", wallTex);
  wallMat.setFloat("useTex", 1);
  wallMat.setFloats("tint", [1, 1, 1, 1]);
  wallMat.backFaceCulling = false;
  wallMat.zOffset = -9;
  parts.push(wallMat);
  const wPos: number[] = [], wIdx: number[] = [];
  const textMat = flat("roomText");
  textMat.setFloat("useTex", 1);
  textMat.setFloats("tint", [1, 1, 1, 1]);
  textMat.backFaceCulling = false;
  textMat.zOffset = -10;
  textMat.needAlphaBlending = () => true;
  textMat.alphaMode = Engine.ALPHA_COMBINE;
  parts.push(textMat);
  const lines: TextLine[] = [];

  for (const room of rooms) {
    const { verts, tris } = room.chunk;
    if (!tris.length) continue;
    const base = fPos.length / 3;
    for (let i = 0; i < verts.length; i += 3) fPos.push(verts[i]!, 0, verts[i + 1]!); // model (x, y) -> (x, up, z)
    for (const t of tris) fIdx.push(base + t);
    for (const [a, b] of boundary(room.chunk)) {
      const ax = verts[a * 3]!, ay = verts[a * 3 + 1]!, bx = verts[b * 3]!, by = verts[b * 3 + 1]!;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const nx = (-(by - ay) / len) * (WALL_WIDTH / 2), ny = ((bx - ax) / len) * (WALL_WIDTH / 2);
      const w = wPos.length / 3;
      wPos.push(ax - nx, WALL_Y - FLOOR_Y, ay - ny, ax + nx, WALL_Y - FLOOR_Y, ay + ny, bx + nx, WALL_Y - FLOOR_Y, by + ny, bx - nx, WALL_Y - FLOOR_Y, by - ny);
      wIdx.push(w, w + 1, w + 2, w, w + 2, w + 3);
    }
    if (!room.lines.length || roomHasNoText(room.name)) continue;
    const { min, max } = bounds(room.chunk);
    const layout = roomTextLayout(min, max);
    const shown = room.lines.slice(0, 2);
    shown.forEach((text, index) => {
      const { tex, aspect } = textTexture(scene, text, `room/${room.name}/${index}`);
      const mesh = new Mesh(`room/${room.name}/text${index}`, scene);
      const d = new VertexData();
      d.positions = new Float32Array(12);
      d.uvs = new Float32Array(8);
      d.indices = [0, 2, 1, 0, 3, 2];
      d.applyToMesh(mesh, true);
      const mat = textMat.clone(`room/${room.name}/${index}`) as ShaderMaterial;
      mat.setTexture("tex", tex);
      mat.needAlphaBlending = () => true;
      mat.alphaMode = Engine.ALPHA_COMBINE;
      mat.setFloat("useTex", 1);
      mat.setFloats("tint", [1, 1, 1, 1]);
      mat.backFaceCulling = false;
      mat.zOffset = -10;
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.parent = root;
      const line: TextLine = { mesh, aspect, layout, index, count: shown.length, flipped: false };
      placeLine(line, false);
      lines.push(line);
      parts.push(mesh, mat, tex);
    });
  }

  const solid = (name: string, pos: number[], idx: number[], mat: ShaderMaterial) => {
    if (!idx.length) return;
    const mesh = new Mesh(name, scene);
    const d = new VertexData();
    d.positions = Float32Array.from(pos);
    d.uvs = new Float32Array((pos.length / 3) * 2);
    d.indices = Uint32Array.from(idx);
    d.applyToMesh(mesh);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.parent = root;
    parts.push(mesh);
  };
  solid("room/floors", fPos, fIdx, floorMat);
  solid("room/walls", wPos, wIdx, wallMat);

  return {
    faceCamera(right, forward) {
      const world = root.getWorldMatrix();
      for (const l of lines) {
        const c = Math.cos(l.layout.rotation), s = Math.sin(l.layout.rotation);
        const read = Vector3.TransformNormal(new Vector3(c, 0, s), world); // the reading direction in the scene
        const up = Vector3.TransformNormal(new Vector3(-s, 0, c), world); // the text's up side
        const flip = textNeedsFlip({ x: read.x, y: read.z }, { x: right.x, y: right.z }, up.x * forward.x + up.z * forward.z > 0);
        if (flip !== l.flipped) placeLine(l, flip);
      }
    },
    dispose: () => { for (const p of parts) p.dispose(); },
  };
}
