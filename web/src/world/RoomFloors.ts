/**
 * The floors of a building's rooms, drawn when a building is hovered: each room's floor polygon (a `room_*` part of the model) filled baby blue, its boundary
 * drawn as a dark blue wall outline, and the room's text written on the floor itself, in bold dark blue, scaled and wrapped to fit inside the room. The colours
 * are a first guess from a description of the game's look (dark blue for the outline and the bold font, baby blue for the floor), not sampled from the game.
 */
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type { MshChunk } from "../formats/Msh.ts";
import { registerShaders } from "./shaders.ts";

export const FLOOR_COLOUR = "#a9d4f5";
export const INK_COLOUR = "#16307a";

export interface RoomFloor { name: string; lines: string[]; chunk: MshChunk }

const FLOOR_Y = 0.05;
const WALL_Y = 0.07;
const WALL_WIDTH = 0.25; // world units
const PIXELS_PER_UNIT = 48;

/** Largest bold font in which the lines, word-wrapped to `maxW`, fit in `maxH`. */
function fitText(ctx: CanvasRenderingContext2D, lines: string[], maxW: number, maxH: number): { size: number; rows: string[] } {
  for (let size = Math.floor(maxH * 0.5); size >= 8; size -= 2) {
    ctx.font = `bold ${size}px sans-serif`;
    const rows: string[] = [];
    let ok = true;
    for (const line of lines) {
      let row = "";
      for (const word of line.split(/\s+/)) {
        const next = row ? `${row} ${word}` : word;
        if (row && ctx.measureText(next).width > maxW) { rows.push(row); row = word; } else row = next;
      }
      rows.push(row);
    }
    if (rows.some((r) => ctx.measureText(r).width > maxW)) ok = false;
    if (ok && rows.length * size * 1.15 <= maxH) return { size, rows };
  }
  ctx.font = "bold 8px sans-serif";
  return { size: 8, rows: lines };
}

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

/**
 * Build the floors for one placed building. `x`, `y`, `angle` are its game position and rotation. Returns a handle that removes everything.
 */
export function buildRoomFloors(scene: Scene, rooms: RoomFloor[], at: { x: number; y: number; angle: number }): { dispose(): void } {
  registerShaders();
  const parts: { dispose(): void }[] = [];
  const wallMat = new ShaderMaterial("roomWalls", scene, "otmFlat", { attributes: ["position", "uv"], uniforms: ["world", "viewProjection", "tint", "useTex"], samplers: ["tex"] });
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  wallMat.setFloats("tint", [...rgb(INK_COLOUR), 1]);
  wallMat.setFloat("useTex", 0);
  wallMat.backFaceCulling = false;
  wallMat.zOffset = -3;
  parts.push(wallMat);
  const wallPos: number[] = [], wallIdx: number[] = [];

  for (const room of rooms) {
    const { verts, tris } = room.chunk;
    if (!tris.length) continue;
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (let i = 0; i < verts.length; i += 3) {
      minX = Math.min(minX, verts[i]!); maxX = Math.max(maxX, verts[i]!);
      minY = Math.min(minY, verts[i + 1]!); maxY = Math.max(maxY, verts[i + 1]!);
    }
    const bw = Math.max(maxX - minX, 0.1), bh = Math.max(maxY - minY, 0.1);

    // The floor: the polygon, textured across its bounding box (u = +x, v = +y, so the text reads upright with north at the top).
    const mesh = new Mesh(`room/${room.name}`, scene);
    const positions = new Float32Array(verts.length), uvs = new Float32Array((verts.length / 3) * 2);
    for (let i = 0; i < verts.length / 3; i++) {
      positions.set([verts[i * 3]!, 0, verts[i * 3 + 1]!], i * 3);
      uvs.set([(verts[i * 3]! - minX) / bw, (verts[i * 3 + 1]! - minY) / bh], i * 2);
    }
    const data = new VertexData();
    data.positions = positions;
    data.uvs = uvs;
    data.indices = Uint32Array.from(room.chunk.tris);
    data.applyToMesh(mesh);
    const scale = Math.min(PIXELS_PER_UNIT, 1024 / Math.max(bw, bh));
    const tex = new DynamicTexture(`room/${room.name}`, { width: Math.max(8, Math.round(bw * scale)), height: Math.max(8, Math.round(bh * scale)) }, scene, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const w = tex.getSize().width, h = tex.getSize().height;
    ctx.fillStyle = FLOOR_COLOUR;
    ctx.fillRect(0, 0, w, h);
    if (room.lines.length) {
      // centred on the polygon's own middle, within the room's extent around it
      let cx = 0, cy = 0, area = 0;
      for (let t = 0; t < tris.length; t += 3) {
        const a = tris[t]! * 3, b = tris[t + 1]! * 3, c = tris[t + 2]! * 3;
        const ar = Math.abs((verts[b]! - verts[a]!) * (verts[c + 1]! - verts[a + 1]!) - (verts[c]! - verts[a]!) * (verts[b + 1]! - verts[a + 1]!)) / 2;
        cx += ar * (verts[a]! + verts[b]! + verts[c]!) / 3; cy += ar * (verts[a + 1]! + verts[b + 1]! + verts[c + 1]!) / 3; area += ar;
      }
      const px = area ? ((cx / area) - minX) * (w / bw) : w / 2, py = area ? (maxY - cy / area) * (h / bh) : h / 2;
      const maxW = 2 * Math.min(px, w - px) * 0.9, maxH = 2 * Math.min(py, h - py) * 0.9;
      const { size, rows } = fitText(ctx, room.lines, maxW, maxH);
      ctx.font = `bold ${size}px sans-serif`;
      ctx.fillStyle = INK_COLOUR;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lh = size * 1.15;
      rows.forEach((r, i) => ctx.fillText(r, px, py + (i - (rows.length - 1) / 2) * lh));
    }
    tex.update();
    const mat = new ShaderMaterial(`room/${room.name}`, scene, "otmFlat", { attributes: ["position", "uv"], uniforms: ["world", "viewProjection", "tint", "useTex"], samplers: ["tex"] });
    mat.setTexture("tex", tex);
    mat.setFloat("useTex", 1);
    mat.setFloats("tint", [1, 1, 1, 1]);
    mat.backFaceCulling = false;
    mat.zOffset = -2;
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.position.set(at.x, FLOOR_Y, at.y);
    mesh.rotation.y = -at.angle;
    parts.push(mesh, mat, tex);

    // Wall outline: a thin strip along every boundary edge.
    for (const [a, b] of boundary(room.chunk)) {
      const ax = verts[a * 3]!, ay = verts[a * 3 + 1]!, bx = verts[b * 3]!, by = verts[b * 3 + 1]!;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const nx = (-(by - ay) / len) * (WALL_WIDTH / 2), ny = ((bx - ax) / len) * (WALL_WIDTH / 2);
      const base = wallPos.length / 3;
      wallPos.push(ax - nx, 0, ay - ny, ax + nx, 0, ay + ny, bx + nx, 0, by + ny, bx - nx, 0, by - ny);
      wallIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  if (wallIdx.length) {
    const walls = new Mesh("room/walls", scene);
    const d = new VertexData();
    d.positions = Float32Array.from(wallPos);
    d.uvs = new Float32Array((wallPos.length / 3) * 2);
    d.indices = Uint32Array.from(wallIdx);
    d.applyToMesh(walls);
    walls.material = wallMat;
    walls.isPickable = false;
    walls.position.set(at.x, WALL_Y, at.y);
    walls.rotation.y = -at.angle;
    parts.push(walls);
  }
  return { dispose: () => { for (const p of parts) p.dispose(); } };
}
