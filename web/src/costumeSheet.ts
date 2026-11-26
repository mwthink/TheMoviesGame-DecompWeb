// Dev only (docs/CHARACTER_VIEWER.md, "Costume contact sheets"): every costume the game has, drawn standing in a grid with its file name under it, as PNG sheets.
// Run by `tools/costume_sheets.sh` (headless Chrome against the dev server) or opened in a browser; each sheet is shown here and saved by the dev server
// (`/__sheet`) under docs/generated/costume_sheets/ (game-derived, so not in git). Query: cols, rows (the grid of a sheet), cellw, cellh (pixels), match (a regular
// expression on the costume file name), save=0 (show only), turn (degrees).

import { Engine } from "@babylonjs/core/Engines/engine";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { PakIndex } from "./assets/Pak.ts";
import { localDevSources } from "./assets/sources.ts";
import { parseAnm } from "./formats/Anm.ts";
import { decodeDds, type Rgba } from "./formats/Dds.ts";
import { clipFits, poseBones, skinTransforms } from "./sim/anim/AutoAnimation.ts";
import { STANDING_POSE_CLIP } from "./sim/character/PersonModel.ts";
import { PersonMeshes } from "./world/PersonMeshes.ts";
import { findTexture, PersonModelBuilder } from "./world/WorldData.ts";

const q = new URLSearchParams(location.search);
const num = (key: string, fallback: number) => { const v = Number(q.get(key)); return Number.isFinite(v) && v > 0 ? v : fallback; };
const COLS = num("cols", 12), ROWS = num("rows", 8), CELL_W = num("cellw", 150), CELL_H = num("cellh", 260);
const TURN = Number(q.get("turn") ?? 90); // at 0 the person is in profile, looking to the right of the picture; 90 faces the camera
const SAVE = q.get("save") !== "0";
/** A person is about 1.9 units tall; a cell is this many units high (room for the name under the feet). */
const CELL_UNITS = 2.4;

const status = document.getElementById("status")!;
const say = (t: string) => { status.textContent = t; console.log(t); };

async function post(name: string, body: Blob | string): Promise<void> {
  if (!SAVE) return;
  const r = await fetch(`/__sheet?name=${encodeURIComponent(name)}`, { method: "POST", body });
  if (!r.ok) throw new Error(`saving ${name}: ${r.status}`);
}

async function main(): Promise<void> {
  const local = await localDevSources();
  if (!local?.paks.length) throw new Error("the dev server has no game files (run it with OTM_GAME_DIR set)");
  const pak = await PakIndex.open(local.paks);
  const pattern = new RegExp(q.get("match") ?? ".", "i");
  const costumes = pak.list("data\\costume\\datas\\").map((f) => f.entry.name).filter((n) => /\.cos$/i.test(n) && pattern.test(n)).sort((a, b) => a.localeCompare(b));
  const clipBytes = await pak.readByName(STANDING_POSE_CLIP, { dir: "data\\animations\\high\\" });
  const clip = clipBytes ? parseAnm(clipBytes) : null;
  const per = COLS * ROWS;
  const sheets = Math.ceil(costumes.length / per);
  const gl = document.getElementById("gl") as HTMLCanvasElement;
  gl.width = COLS * CELL_W; gl.height = ROWS * CELL_H;
  gl.style.width = `${gl.width}px`; gl.style.height = `${gl.height}px`;
  const engine = new Engine(gl, true, { preserveDrawingBuffer: true });
  engine.setSize(gl.width, gl.height);
  const failed: string[] = [];

  for (let s = 0; s < sheets; s++) {
    const batch = costumes.slice(s * per, (s + 1) * per);
    const label = String(s + 1).padStart(2, "0");
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.16, 0.17, 0.2, 1);
    const unitsW = CELL_UNITS * (CELL_W / CELL_H);
    const camera = new FreeCamera("sheet", new Vector3(0, 0, -10), scene);
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    camera.orthoTop = (ROWS * CELL_UNITS) / 2; camera.orthoBottom = -camera.orthoTop;
    camera.orthoRight = (COLS * unitsW) / 2; camera.orthoLeft = -camera.orthoRight;
    camera.minZ = 0.1; camera.maxZ = 50;
    // cell (col, row) covers x from col * unitsW and y from -(row + 1) * CELL_UNITS up one cell; the camera looks at the middle of the grid
    camera.position.set((COLS * unitsW) / 2, -(ROWS * CELL_UNITS) / 2, -10);
    camera.setTarget(new Vector3((COLS * unitsW) / 2, -(ROWS * CELL_UNITS) / 2, 0));

    // a fresh builder and texture cache per sheet keeps the decoded textures of 96 people from piling up
    const textures = new Map<string, Promise<Rgba | null>>();
    const builder = new PersonModelBuilder(pak, (name) => {
      const key = name.toLowerCase();
      let t = textures.get(key);
      if (!t) textures.set(key, (t = (async () => { const f = findTexture(pak, key); return f ? decodeDds(await pak.read(f)) : null; })()));
      return t;
    });
    const materials = new Map<string, StandardMaterial>();
    const names: string[] = [];
    for (const [i, cos] of batch.entries()) {
      say(`Sheet ${s + 1} of ${sheets}: ${i + 1} / ${batch.length} ${cos}`);
      names.push(cos);
      const col = i % COLS, row = Math.floor(i / COLS);
      try {
        const hair = cos.toLowerCase().startsWith("f_") ? "hair_20s_f1.msh" : "hair_20s_m1.msh"; // a plain hair by the costume's sex, as the loading scene does
        const model = await builder.build({ cos, head: "", hair, ageYears: 30, weightKg: 70, look: {} });
        const meshes = new PersonMeshes(scene, { bind: model.parts, textures: model.textures, skeleton: model.skeleton }, `sheet/${cos}`, materials);
        // feet at the bottom of the cell's picture area (the name goes under them), centred in the cell
        meshes.node.position.set((col + 0.5) * unitsW, -(row + 1) * CELL_UNITS + 0.3, 0);
        meshes.node.rotation.y = (TURN * Math.PI) / 180;
        if (clip && clipFits(model.skeleton, clip)) meshes.applyPose(skinTransforms(model.skeleton, poseBones(model.skeleton, clip, 0, "absolute")));
      } catch (e) {
        failed.push(cos);
        console.warn(`costume ${cos} could not be built:`, e);
      }
    }
    await new Promise<void>((resolve) => scene.executeWhenReady(() => resolve()));
    scene.render();
    // the sheet: the 3D picture with the file names written under each person
    const out = document.createElement("canvas");
    out.width = gl.width; out.height = gl.height;
    const g = out.getContext("2d")!;
    g.drawImage(gl, 0, 0);
    g.font = "12px system-ui, sans-serif"; g.textAlign = "center"; g.fillStyle = "#e8e6dc";
    names.forEach((cos, i) => g.fillText(cos.replace(/\.cos$/i, ""), (i % COLS) * CELL_W + CELL_W / 2, (Math.floor(i / COLS) + 1) * CELL_H - 8, CELL_W - 6));
    const blob = await new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png"));
    await post(`costumes_${label}.png`, blob);
    await post(`costumes_${label}.txt`, names.map((n, i) => `${Math.floor(i / COLS) + 1},${(i % COLS) + 1}\t${n}`).join("\n") + "\n");
    const fig = document.createElement("figure");
    const img = document.createElement("img");
    img.src = URL.createObjectURL(blob);
    fig.append(img, Object.assign(document.createElement("figcaption"), { textContent: `costumes_${label}.png: ${names[0]} to ${names[names.length - 1]}` }));
    document.getElementById("sheets")!.append(fig);
    scene.dispose();
  }
  engine.dispose();
  await post("done.txt", `${costumes.length} costumes, ${sheets} sheets${failed.length ? `, ${failed.length} failed: ${failed.join(" ")}` : ""}\n`);
  say(`Done: ${costumes.length} costumes on ${sheets} sheets${failed.length ? `; ${failed.length} could not be built (see the console)` : ""}${SAVE ? ", saved under docs/generated/costume_sheets/" : ""}.`);
}

main().catch((e) => { console.error(e); say(`Failed: ${e instanceof Error ? e.message : e}`); void post("done.txt", `failed: ${e instanceof Error ? e.message : e}\n`).catch(() => {}); });
