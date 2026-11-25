// The gameplay camera port (src/camera/GameCamera.ts) against the same numbers as src/tests/CameraTest.cpp: the camera the game itself stored in
// saves (CLot SL_CamPos / SL_CamFoc / SL_CamZoo), hand-worked helpers, and the real data\ui\camera.ini.
import assert from "node:assert/strict";
import { test } from "node:test";
import { clampPush, emptyInput, GameCamera, MAX_ZOOM, parseCameraIni, rotateAbout, wrapAngle, type Bounds } from "../src/camera/GameCamera.ts";
import { lotBounds, lotSize } from "../src/world/Perimeter.ts";
import { readFile } from "node:fs/promises";
import { parseSave } from "../src/formats/Jad.ts";
import { haveGame, haveSave, pakIndex, SAVE_PATH } from "./helpers.ts";

const INI = `wheelscale = 10
pushdistance = 10
[normal]
	startfocus = -0.68345982,13.165312,1.6000000
	heading = 0.0, 57.0,-70.0
	fov = 0.8
	zoomcurve = 2.0
	cameraspeed = 300
	rotationspeed = 0.4
	zoomspeed = 0.5
	acceleration = 150
	maxvelocity = 40
	damping = 0.001
	startzoom = 0.25
`;
const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const BOUNDS: Bounds = { minX: -164.6, minY: 2, maxX: 148.75, maxY: 222 };
function make(): GameCamera {
  const { config, problems } = parseCameraIni(INI);
  assert.deepEqual(problems, []);
  return new GameCamera(config!.normal, config!.globals, BOUNDS);
}

test("camera.ini: values and defaults", () => {
  const { config } = parseCameraIni(INI);
  const n = config!.normal;
  near(n.heading.y, 57); near(n.heading.z, -70); near(n.fov, 0.8); near(n.zoomCurve, 2); near(n.acceleration, 150); near(n.maxVelocity, 40); near(n.damping, 0.001);
  near(n.wheelSpeed, 1); // missing -> 1
  const bare = parseCameraIni("[normal]\nheading = 0,200,-300\nstartfocus = 0,0,0\n").config!.normal;
  near(bare.fov, 1); near(bare.cameraSpeed, 300); near(bare.acceleration, 300); near(bare.maxVelocity, 30); near(bare.damping, 0.2); near(bare.rotationSpeed, 2); near(bare.zoomSpeed, 2);
});

test("helpers", () => {
  const r = rotateAbout({ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, Math.PI / 2);
  near(r.x, 0); near(r.y, -1); near(r.z, 0);
  near(wrapAngle(7), 7 - 2 * Math.PI); near(wrapAngle(-7), -7 + 2 * Math.PI);
  const b: Bounds = { minX: -10, minY: 0, maxX: 10, maxY: 20 };
  const p = { x: 0, y: 0 };
  clampPush(b, 0, 10, 0, p); assert.deepEqual(p, { x: 0, y: 0 });
  clampPush(b, -20, 10, 0, p); near(p.x, 11.5);
  const q = { x: 0, y: 0 };
  clampPush(b, 0, -3, 2, q); near(q.y, 2.5);
  const z = { x: 0, y: 0 };
  clampPush(b, 0, -3, -1, z); assert.equal(z.y, 0); // a negative margin skips the low-y test
});

test("the eye follows the focus, angle and zoom the game saved (SL_CamPos), including the close-zoom pull-in", () => {
  const c = make();
  c.restore({ x: -46.2731514, y: 15.34938335, z: 1.6 }, 0, 0.005999999586);
  near(c.eye.x, -46.2731514); near(c.eye.y, -41.30861664); near(c.eye.z, 66.51699829);
  c.restore({ x: 71.15304565, y: 55.864151, z: 1.6 }, 0, 0.582000196);
  near(c.eye.x, 71.15304565); near(c.eye.y, 42.45326996); near(c.eye.z, 6.810667992);
  c.restore({ x: 54.17318344, y: 27.63374137, z: 1.6 }, 0, 0);
  near(c.eye.z, 67.33575439); near(c.eye.y, -29.36614, 0.01);
});

test("start state, rest, scrolling, zoom and the lot clamp", () => {
  const c = make();
  near(c.focus.x, -0.68346, 1e-2); near(c.zoom, 0.25); near(c.fov, 0.8);
  near(c.eye.y, -29.585, 1e-2); near(c.eye.z, 37.39, 0.05);
  const input = emptyInput(); input.dt = 1 / 60;
  const y0 = c.focus.y;
  for (let i = 0; i < 120; i++) c.tick(input);
  near(c.focus.y, y0, 1e-3);
  input.forward = true;
  for (let i = 0; i < 60; i++) c.tick(input);
  assert.ok(c.focus.y > y0 + 5);
  assert.ok(c.debug.keyVelY <= 40.0001);
  input.forward = false;
  const y1 = c.focus.y;
  for (let i = 0; i < 60; i++) c.tick(input);
  const y2 = c.focus.y;
  assert.ok(y2 - y1 > 2 && y2 - y1 < 6, `coast ${y2 - y1}`);
  for (let i = 0; i < 60; i++) c.tick(input);
  assert.ok(c.focus.y - y2 < 0.01);

  const w = make();
  const wi = emptyInput(); wi.dt = 1 / 60; wi.wheel = 120;
  w.tick(wi); near(w.zoom, 0.31, 1e-4);
  wi.wheel = 6000; w.tick(wi); near(w.zoom, MAX_ZOOM);
  wi.wheel = -12000; w.tick(wi); near(w.zoom, 0);

  const l = make();
  const li = emptyInput(); li.dt = 1 / 60; li.left = true;
  for (let i = 0; i < 1800; i++) l.tick(li);
  assert.ok(l.focus.x > -164.6 && l.focus.x < -100, `${l.focus.x}`);
});

test("lot rectangle of the tier 2 lot", () => {
  const s = lotSize(300, 224);
  const b = lotBounds(s.width, s.depth);
  near(b.minX, -164.6); near(b.maxX, 148.75); near(b.minY, 2); near(b.maxY, 222);
  const moved = lotBounds(s.width, s.depth, [10, 5]);
  near(moved.minX, -154.6); near(moved.minY, 7);
});

test("the real data\\ui\\camera.ini", { skip: !haveGame }, async () => {
  const pak = await pakIndex();
  const f = pak.find("camera.ini", { dir: "data\\ui\\" });
  assert.ok(f, "camera.ini in the archives");
  const { config, problems } = parseCameraIni(new TextDecoder().decode(await pak.read(f)));
  assert.deepEqual(problems, []);
  const n = config!.normal;
  near(n.startFocus.y, 13.165312); near(n.heading.z, -70); near(n.zoomCurve, 2); near(n.maxVelocity, 40); near(n.startZoom, 0.25);
});

test("the camera stored in a save is read, and the eye the code computes from it is the saved one", { skip: !(haveGame && haveSave) }, async () => {
  const save = parseSave(new Uint8Array(await readFile(SAVE_PATH)));
  const sc = save.lotCamera;
  assert.ok(sc, "the save's CLot has a camera");
  const c = make();
  c.restore({ x: sc.focus[0], y: sc.focus[1], z: sc.focus[2] }, sc.angle, sc.zoom);
  near(c.eye.x, sc.eye[0]); near(c.eye.y, sc.eye[1]); near(c.eye.z, sc.eye[2]);
});
