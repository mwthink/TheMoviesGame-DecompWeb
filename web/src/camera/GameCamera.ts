/**
 * The in-lot gameplay camera ("normal" mode of the game's camera manager): a port of `src/game/camera/GameCamera.cpp`, which is the reading of the
 * decompile with every function tagged by address. Read docs/CAMERA.md first; this file keeps the same names and order so the two can be compared.
 * Game coordinates (right-handed, z up). No engine types and no DOM: the tests run it in Node.
 */
import { Ini } from "../formats/Ini.ts";

export interface Vec3 { x: number; y: number; z: number }

/** One `[section]` of `data\ui\camera.ini` as FUN_00417010 reads it; a missing or 0 value takes the reader's default. */
export interface StateParams {
  heading: Vec3;          // the eye-to-focus vector at zoom 0
  startFocus: Vec3;
  fov: number;            // radians, horizontal; 0 -> 1
  cameraSpeed: number;    // 0 -> 300
  rotationSpeed: number;  // 0 -> 2
  zoomSpeed: number;      // 0 -> 2
  wheelSpeed: number;     // 0 -> 1
  zoomCurve: number;
  acceleration: number;   // 0 -> cameraSpeed
  maxVelocity: number;    // 0 -> 30
  damping: number;        // 0 -> 0.2; per second
  startZoom: number;
}

/** The two globals at the top of camera.ini. */
export interface Globals { wheelScale: number; pushDistance: number }

export interface CameraConfig { normal: StateParams; globals: Globals }

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export const MAX_ZOOM = 0.8;      // +0x29C
export const FAR_PLANE = 300;     // DAT_00E4E418

const PI = Math.PI;
const TWO_PI = Math.PI * 2;

const num = (s: string | undefined): number | undefined => {
  if (s === undefined) return undefined;
  const v = Number(s.trim());
  return Number.isFinite(v) ? v : undefined;
};

function vec3(s: string | undefined): Vec3 | undefined {
  const p = s?.split(",").map((x) => Number(x.trim()));
  return p && p.length >= 3 && p.slice(0, 3).every(Number.isFinite) ? { x: p[0]!, y: p[1]!, z: p[2]! } : undefined;
}

/** Reads data\ui\camera.ini. Problems (a section without a heading, say) are returned, never thrown. */
export function parseCameraIni(text: string): { config: CameraConfig | null; problems: string[] } {
  const ini = Ini.parse(text);
  const problems: string[] = [];
  const read = (section: string): StateParams | null => {
    const g = (k: string) => num(ini.get(`${section}/${k}`)) ?? 0;
    const heading = vec3(ini.get(`${section}/heading`));
    const startFocus = vec3(ini.get(`${section}/startfocus`));
    if (!heading || !startFocus) { problems.push(`camera.ini [${section}]: missing heading or startfocus`); return null; }
    const cameraSpeed = g("cameraspeed") || 300;
    return {
      heading, startFocus,
      fov: g("fov") || 1,
      cameraSpeed,
      rotationSpeed: g("rotationspeed") || 2,
      zoomSpeed: g("zoomspeed") || 2,
      wheelSpeed: g("wheelspeed") || 1,
      zoomCurve: g("zoomcurve"),
      acceleration: g("acceleration") || cameraSpeed,
      maxVelocity: g("maxvelocity") || 30,
      damping: g("damping") || 0.2,
      startZoom: g("startzoom"),
    };
  };
  const normal = read("normal");
  if (!normal) return { config: null, problems };
  return { config: { normal, globals: { wheelScale: num(ini.get("wheelscale")) ?? 10, pushDistance: num(ini.get("pushdistance")) ?? 10 } }, problems };
}

/** What the host observed this frame (same fields and meaning as `Input` in GameCamera.hpp). */
export interface CameraInput {
  dt: number;
  left: boolean; right: boolean; forward: boolean; back: boolean;
  rotateModifier: boolean; fastModifier: boolean;
  altLeft: boolean; altRight: boolean; altForward: boolean; altBack: boolean;
  mouseX: number; mouseY: number; mouseRelX: number; mouseRelY: number;
  viewportW: number; viewportH: number;
  windowFocused: boolean; edgeScrollEnabled: boolean; rotateDrag: boolean;
  wheel: number; wheelOverUi: boolean; resetRequested: boolean;
}

export function emptyInput(): CameraInput {
  return {
    dt: 0, left: false, right: false, forward: false, back: false, rotateModifier: false, fastModifier: false,
    altLeft: false, altRight: false, altForward: false, altBack: false,
    mouseX: 0, mouseY: 0, mouseRelX: 0, mouseRelY: 0, viewportW: 800, viewportH: 600,
    windowFocused: true, edgeScrollEnabled: true, rotateDrag: false, wheel: 0, wheelOverUi: false, resetRequested: false,
  };
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const len = (a: Vec3) => Math.sqrt(dot(a, a));
function normalized(v: Vec3): Vec3 { const l = len(v); return l === 0 ? v : mul(v, 1 / l); }

/** FUN_004012C0: wrap to (-pi, pi]. */
export function wrapAngle(a: number): number {
  let r = a - Math.round(a / TWO_PI) * TWO_PI;
  if (r > PI) r -= TWO_PI;
  return r;
}

/** FUN_00414360: rotate `point` about the axis through `pivot` (quaternion, v' = q v q^-1 on the vector point -> pivot). */
export function rotateAbout(point: Vec3, pivot: Vec3, axis: Vec3, angle: number): Vec3 {
  if (angle === 0) return point;
  const v = sub(pivot, point);
  const s = Math.sin(angle * 0.5) / len(axis);
  const qx = axis.x * s, qy = axis.y * s, qz = axis.z * s, qw = Math.cos(angle * 0.5);
  const tx = 2 * (qy * v.z - qz * v.y), ty = 2 * (qz * v.x - qx * v.z), tz = 2 * (qx * v.y - qy * v.x);
  const r = { x: v.x + qw * tx + (qy * tz - qz * ty), y: v.y + qw * ty + (qz * tx - qx * tz), z: v.z + qw * tz + (qx * ty - qy * tx) };
  return sub(pivot, r);
}

/** FUN_004166A0: the push that brings (x, y) back inside the lot; the larger push per axis wins, a tie keeps the old one. */
export function clampPush(b: Bounds, x: number, y: number, margin: number, push: { x: number; y: number }): void {
  const minX = b.minX + 1.5, maxX = b.maxX - 1.5, maxY = b.maxY - 1.5, minYm = b.minY + 1.5 - margin;
  let px = 0;
  if (x < minX) px = minX - x; else if (maxX < x) px = maxX - x;
  let py = 0;
  if (margin >= 0 && y < minYm) py = minYm - y; else if (maxY < y) py = maxY - y;
  if (!(Math.abs(px) <= Math.abs(push.x))) push.x = px;
  if (!(Math.abs(py) <= Math.abs(push.y))) push.y = py;
}

interface View { eye: Vec3; forward: Vec3; right: Vec3; up: Vec3; halfW: number; halfH: number; w: number; h: number; nearD: number }

function makeView(eye: Vec3, focus: Vec3, fov: number, nearD: number, w: number, h: number): View {
  let f = sub(focus, eye);
  if (Math.abs(f.x) < 0.001 && Math.abs(f.y) < 0.001) f = { ...f, x: f.x <= 0 ? -0.001 : 0.001 }; // FUN_009A2830
  f = normalized(f);
  const right = normalized(cross(f, { x: 0, y: 0, z: 1 }));
  const halfW = Math.tan(fov * 0.5) * nearD;
  return { eye, forward: f, right, up: cross(right, f), halfW, halfH: halfW / (w / h), w, h, nearD };
}

/** FUN_009A1A20 + TMInWorld_RayToPlane (0x538EF0): where the ray through viewport pixel (px, py) meets the plane z = planeZ. */
export function rayToPlane(v: View, px: number, py: number, planeZ: number): Vec3 {
  const cx = v.w * 0.5, cy = v.h * 0.5;
  const camX = (v.halfW / cx) * (px - cx), camZ = (v.halfH / cy) * (cy - py);
  const p = add(add(add(v.eye, mul(v.right, camX)), mul(v.forward, v.nearD)), mul(v.up, camZ));
  const t = (planeZ - v.eye.z) / (p.z - v.eye.z);
  return t > 0.0001 ? add(v.eye, mul(sub(p, v.eye), t)) : p;
}

/** The last frame's intermediate values, for the dev menu. */
export interface CameraDebug {
  dt: number; keyVelX: number; keyVelY: number; edgeVelX: number; edgeVelY: number; edgeActive: boolean;
  panX: number; panY: number; zoomInput: number; rotateInput: number; pushX: number; pushY: number;
}

export class GameCamera {
  eye: Vec3 = { x: 0, y: 0, z: 0 };    // +0xD0
  focus: Vec3 = { x: 0, y: 0, z: 0 };  // +0xDC
  zoom = 0;                            // +0x21C, 0 far .. MAX_ZOOM close
  angle = 0;                           // +0x218, radians
  fovScale = 1;                        // +0xEC
  near = 0.1;
  nearLimit = 15;                      // +0xF0
  readonly debug: CameraDebug = { dt: 0, keyVelX: 0, keyVelY: 0, edgeVelX: 0, edgeVelY: 0, edgeActive: false, panX: 0, panY: 0, zoomInput: 0, rotateInput: 0, pushX: 0, pushY: 0 };

  private view: Vec3 = { x: 0, y: 0, z: 0 };   // +0x90 = focus - eye
  private dt = 0;
  private vw = 800;
  private vh = 600;
  private keyVelX = 0; private keyVelY = 0;
  private edgeVelX = 0; private edgeVelY = 0;
  private panInX = 0; private panInY = 0;
  private zoomKey = 0; private zoomWheel = 0; private zoomIn = 0;
  private rotKey = 0; private rotMouse = 0; private rotIn = 0;
  private edgeActive = false;

  readonly p: StateParams;
  readonly g: Globals;
  readonly bounds: Bounds;

  constructor(p: StateParams, g: Globals, bounds: Bounds) {
    this.p = p;
    this.g = g;
    this.bounds = bounds;
    this.reset();
  }

  /** Horizontal field of view in radians (FUN_004012C0(+0xEC * +0xE8)). */
  get fov(): number { return wrapAngle(this.p.fov * this.fovScale); }

  /** FUN_0041B730's initial values. */
  reset(): void {
    this.focus = { ...this.p.startFocus };
    this.zoom = this.p.startZoom;
    this.angle = 0;
    this.fovScale = 1;
    this.nearLimit = 15;
    this.keyVelX = this.keyVelY = this.edgeVelX = this.edgeVelY = 0;
    this.panInX = this.panInY = this.zoomKey = this.zoomWheel = this.zoomIn = this.rotKey = this.rotMouse = this.rotIn = 0;
    this.edgeActive = false;
    this.placeEye();
    this.view = sub(this.focus, this.eye);
  }

  /** Where a save had the camera (CLot SL_CamFoc, SL_CamRot, SL_CamZoo); the eye follows (checked against the saved SL_CamPos). */
  restore(focus: Vec3, angle: number, zoom: number): void {
    this.focus = { ...focus };
    this.angle = wrapAngle(angle);
    this.zoom = Math.min(Math.max(zoom, 0), MAX_ZOOM);
    this.placeEye();
    this.view = sub(this.focus, this.eye);
  }

  /** One frame: FUN_00419E50 for the normal state. */
  tick(input: CameraInput): void {
    let dt = input.dt;
    if (Math.abs(dt - this.dt) > 0.05) dt = dt > this.dt ? this.dt + 0.05 : this.dt - 0.05;
    this.dt = dt;
    this.debug.dt = dt;

    this.keyboard(input);
    this.mouseAndWheel(input);
    this.extraKeys(input);
    this.combine(input);
    if (input.resetRequested) this.reset();

    // FUN_004149F0: the input follows the heading and slows as the zoom closes in.
    let panX = 0, panY = 0;
    if (this.panInX !== 0 || this.panInY !== 0) {
      const heading = Math.atan2(this.view.y, this.view.x) - PI * 0.5;
      const c = Math.cos(heading), s = Math.sin(heading), scale = 1 - this.zoom;
      panX = (c * this.panInX - s * this.panInY) * scale;
      panY = (c * this.panInY + s * this.panInX) * scale;
    }
    // LAB_004128A0: a wheel over a window is ignored.
    let zoomAdd = 0;
    if (this.zoomIn !== 0 && !input.wheelOverUi) zoomAdd = this.zoomIn;
    // LAB_00414BF0
    this.angle += this.rotIn;
    if (this.angle < -PI) this.angle += TWO_PI; else if (this.angle > PI) this.angle -= TWO_PI;

    zoomAdd *= this.p.zoomSpeed;
    this.zoom = Math.max(Math.min(this.zoom + zoomAdd, MAX_ZOOM), 0);

    const d = this.debug;
    d.keyVelX = this.keyVelX; d.keyVelY = this.keyVelY; d.edgeVelX = this.edgeVelX; d.edgeVelY = this.edgeVelY;
    d.edgeActive = this.edgeActive; d.panX = panX; d.panY = panY; d.zoomInput = this.zoomIn; d.rotateInput = this.rotIn;

    this.panInX = this.panInY = this.zoomIn = this.rotIn = 0;
    this.zoomKey = this.zoomWheel = this.rotKey = this.rotMouse = 0;

    // LAB_00412750, FUN_004162C0
    this.focus.x += panX; this.focus.y += panY;
    this.eye.x += panX; this.eye.y += panY;
    this.placeEye();
    this.view = sub(this.focus, this.eye);

    // LAB_004167B0 (which starts with FUN_00414F90)
    this.vw = input.viewportW;
    this.vh = input.viewportH;
    this.keepInsideLot();
    this.view = sub(this.focus, this.eye);
  }

  // orig: 0x00414060
  private keyboard(i: CameraInput): void {
    let dx = 0, dy = 0;
    if (i.left) dx = -this.dt; else if (i.right) dx = this.dt;
    if (i.forward) dy = this.dt; else if (i.back) dy = -this.dt;
    const decay = () => { const k = Math.pow(this.p.damping, this.dt); this.keyVelX *= k; this.keyVelY *= k; };
    if (dx === 0 && dy === 0) { decay(); return; }
    if (i.rotateModifier) { decay(); this.rotKey += dx * 60; this.zoomKey += dy * 50; return; }
    this.keyVelX += dx * this.p.acceleration;
    this.keyVelY += dy * this.p.acceleration;
    const l = Math.hypot(this.keyVelX, this.keyVelY);
    if (this.p.maxVelocity < l) { this.keyVelX = this.keyVelX / l * this.p.maxVelocity; this.keyVelY = this.keyVelY / l * this.p.maxVelocity; }
  }

  // orig: 0x00414260
  private extraKeys(i: CameraInput): void {
    this.keyVelX += i.altLeft ? -1 : i.altRight ? 1 : 0;
    this.keyVelY += i.altForward ? 1 : i.altBack ? -1 : 0;
  }

  // orig: 0x00418FE0
  private mouseAndWheel(i: CameraInput): void {
    let pushing = false;
    const atEdge = i.mouseX <= 0 || i.mouseX >= i.viewportW || i.mouseY <= 0 || i.mouseY >= i.viewportH;
    let active = false;
    if (i.windowFocused && i.edgeScrollEnabled && atEdge) {
      const push2 = this.g.pushDistance * this.g.pushDistance;
      if (push2 < i.mouseRelX * i.mouseRelX + i.mouseRelY * i.mouseRelY) this.edgeActive = true;
      active = this.edgeActive;
      if (active) {
        let dx = i.mouseX - i.viewportW * 0.5, dy = i.mouseY - i.viewportH * 0.5;
        const l = Math.hypot(dx, dy);
        if (l !== 0) { dx /= l; dy /= l; }
        const gain = this.dt * this.p.acceleration;
        this.edgeVelX += dx * gain;
        this.edgeVelY += -dy * gain;
        const n = Math.hypot(this.edgeVelX, this.edgeVelY);
        if (this.p.maxVelocity < n) { this.edgeVelX = this.edgeVelX / n * this.p.maxVelocity; this.edgeVelY = this.edgeVelY / n * this.p.maxVelocity; }
        pushing = true;
      }
    }
    if (!active) this.edgeActive = false;
    if (!pushing) { const k = Math.pow(this.p.damping, this.dt); this.edgeVelX *= k; this.edgeVelY *= k; }

    if (i.rotateDrag) this.rotMouse += (-i.mouseRelX / (i.viewportW * 0.1)) * 0.5;

    const w = i.wheel;
    if (!i.fastModifier) {
      if (w !== 0) {
        this.zoomWheel += (w / (1000 / this.g.wheelScale)) * 0.1;
        this.zoomWheel *= this.p.wheelSpeed;
      }
      this.fovScale = this.fovScale < 1 ? Math.min(this.fovScale + 0.5, 1) : 1;
    } else if (w !== 0) {
      this.fovScale = Math.min(Math.max(this.fovScale - w * 0.0005, 0.05), 1);
    }
  }

  // orig: 0x004198A0
  private combine(i: CameraInput): void {
    let kx = this.keyVelX, ky = this.keyVelY, ex = this.edgeVelX, ey = this.edgeVelY;
    if (i.fastModifier) {
      kx *= 3; ky *= 3; ex *= 3; ey *= 3;
      this.zoomKey *= 3; this.zoomWheel *= 3; this.rotKey *= 3; this.rotMouse *= 3;
    }
    this.panInX = this.dt * (ex + kx) * this.fovScale;
    this.panInY = (ey + ky) * this.dt * this.fovScale;
    this.zoomIn = this.dt * this.zoomKey + this.zoomWheel;
    this.rotIn = (this.dt * this.rotKey + this.rotMouse) * this.fovScale;
  }

  // orig: 0x004162C0
  private placeEye(): void {
    const h = this.p.heading;
    let eye = add(sub(this.focus, h), mul(h, this.zoom));
    const fz = this.focus.z - h.z;
    const eyeAbove = eye.z - this.focus.z;
    this.focus.z = 1.6;
    eye.z = Math.pow(eyeAbove / fz, this.p.zoomCurve) * fz + 1.6 - 2.7;
    eye = rotateAbout(eye, this.focus, { x: 0, y: 0, z: 1 }, this.angle);
    const f = Math.min((eye.z - 1.6) * 0.05 + 0.1, 1);
    this.eye = add(mul(sub(eye, this.focus), f), this.focus);
    let s = (this.eye.z - 1.6) / (fz - 1.6);
    s = Math.max(s, 1 - this.fovScale * this.fovScale);
    this.nearLimit = Math.min(Math.max(s * 14 + 1, 1), 15);
  }

  // orig: 0x00414F90
  private updateNear(): void {
    const v = makeView(this.eye, this.focus, this.fov, this.near, this.vw, this.vh);
    const hit = rayToPlane(v, this.vw * 0.5, this.vh, 0);
    let depth = dot(sub(hit, this.eye), normalized(sub(this.focus, this.eye)));
    if (this.nearLimit < depth) depth = this.nearLimit;
    this.nearLimit = Math.max(depth, 0.01);
    this.near = Math.max(this.nearLimit, 0.1);
  }

  // orig: 0x004167B0
  private keepInsideLot(): void {
    this.updateNear();
    const n = normalized(this.view);
    const a = n.z + 1;
    const l2 = Math.hypot(n.x, n.y);
    const ny = l2 !== 0 ? n.y / l2 : n.y;
    const back = 0.5 * Math.max(0, ny * (this.eye.z - 1.6));
    const v = makeView(this.eye, this.focus, this.fov, this.near, this.vw, this.vh);
    const push = { x: 0, y: 0 };
    const rowY = this.vh * (a * 0.25 + 0.75);
    let r = rayToPlane(v, this.vw * (0.5 - a * 0.4), rowY, 1.53);
    clampPush(this.bounds, r.x, r.y, back, push);
    r = rayToPlane(v, this.vw * (a * 0.4 + 0.5), rowY, 1.53);
    clampPush(this.bounds, r.x, r.y, back, push);
    r = rayToPlane(v, this.vw * 0.5, this.vh * a, 0);
    clampPush(this.bounds, r.x, r.y, -1, push);
    this.focus.x += push.x; this.focus.y += push.y;
    this.eye.x += push.x; this.eye.y += push.y;
    this.debug.pushX = push.x; this.debug.pushY = push.y;
  }
}
