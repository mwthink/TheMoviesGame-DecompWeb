// The maths of flying a loading scene's backdrop camera with the mouse and keys (docs/LOADING_SCREENS.md, "The scene editor"). Game coordinates: x, y along the floor, z up. No engine types.

export type Vec3 = [number, number, number];

/** A camera as the scene stores it: where it stands and the point it looks at. */
export interface Cam { eye: Vec3; look: Vec3; }

/** The box a set's geometry fills, in game coordinates. */
export interface Bounds { min: Vec3; max: Vec3; }

const MAX_PITCH = (85 * Math.PI) / 180;
/** The shortest eye-to-look distance kept, so turning stays well defined. */
const MIN_DIST = 1;

/** Which way a camera faces: `yaw` from +y towards +x (so 0 looks along +y, and +x is to the right), `pitch` up from the floor, and the distance to the look point. */
export function aimOf(c: Cam): { yaw: number; pitch: number; dist: number } {
  const dx = c.look[0] - c.eye[0], dy = c.look[1] - c.eye[1], dz = c.look[2] - c.eye[2];
  const flat = Math.hypot(dx, dy);
  return { yaw: Math.atan2(dx, dy), pitch: Math.atan2(dz, flat), dist: Math.max(MIN_DIST, Math.hypot(dx, dy, dz)) };
}

/** The unit vector a camera looks along. */
export function forward(yaw: number, pitch: number): Vec3 {
  return [Math.sin(yaw) * Math.cos(pitch), Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch)];
}

/** The unit vector to the camera's right (level, whatever the pitch). */
export function right(yaw: number): Vec3 {
  return [Math.cos(yaw), -Math.sin(yaw), 0];
}

/** The same camera with its look point placed `dist` along `yaw` and `pitch` from the eye. */
export function lookFrom(eye: Vec3, yaw: number, pitch: number, dist: number): Cam {
  const f = forward(yaw, pitch);
  return { eye: [...eye], look: [eye[0] + f[0] * dist, eye[1] + f[1] * dist, eye[2] + f[2] * dist] };
}

/** Turn the camera on the spot: `dYaw` to the right and `dPitch` up (radians); the eye and the distance to the look point stay. */
export function turn(c: Cam, dYaw: number, dPitch: number): Cam {
  const a = aimOf(c);
  return lookFrom(c.eye, a.yaw + dYaw, Math.min(MAX_PITCH, Math.max(-MAX_PITCH, a.pitch + dPitch)), a.dist);
}

/** Move the camera, look point included (so what it faces is unchanged): `fwd` along the view (level pitch kept), `side` to the right, `up` along z. */
export function move(c: Cam, fwd: number, side: number, up: number): Cam {
  const a = aimOf(c);
  const f = forward(a.yaw, a.pitch), r = right(a.yaw);
  const d: Vec3 = [f[0] * fwd + r[0] * side, f[1] * fwd + r[1] * side, f[2] * fwd + up];
  return { eye: [c.eye[0] + d[0], c.eye[1] + d[1], c.eye[2] + d[2]], look: [c.look[0] + d[0], c.look[1] + d[1], c.look[2] + d[2]] };
}

/** The longest side of a set's box: a scale for how far one mouse step should move the camera. */
export function extent(b: Bounds): number {
  return Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], 1);
}

/** The camera standing at the middle of the set at eye height, looking along +y: a place to start from. */
export function centreView(b: Bounds, eyeHeight = 1.7): Cam & { fovDeg: number } {
  const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
  return { eye: [cx, cy, eyeHeight], look: [cx, cy + 10, eyeHeight], fovDeg: 70 };
}

/**
 * A bird's-eye view from just under the roof of a set's box, over its middle, looking steeply down with a wide lens: a roof or ceiling above the set would hide the inside from
 * anywhere higher. Good for seeing the layout and choosing a place.
 */
export function overview(b: Bounds): Cam & { fovDeg: number } {
  const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, e = extent(b);
  const top = Math.max(b.min[2] + 1, b.max[2] - 0.4);
  return { eye: [cx, cy - e * 0.06, top], look: [cx, cy, b.min[2] + 0.5], fovDeg: 85 };
}
