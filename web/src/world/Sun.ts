/**
 * A movable sun for the world view (docs/LIGHTING.md). The original has no dynamic light: everything is lit by baked lightmaps, so with the sun off the world looks as it
 * always did. With it on, each lit surface gets
 *
 *     colour = diffuse * (baked * lightmap + ambient + intensity * max(0, normal . toSun))
 *
 * where `lightmap` is the baked one (1 for surfaces that have none: the ground, most props). This is a first experiment for the dev menu: no shadows yet.
 */
export interface SunSettings {
  enabled: boolean;
  /** Compass direction of the sun in degrees: 0 = north (+y in the game), 90 = east (+x). */
  azimuth: number;
  /** Height above the horizon in degrees. */
  elevation: number;
  /** How strongly the sun lights surfaces that face it. */
  intensity: number;
  /** Light that reaches every surface whatever its direction. */
  ambient: number;
  /** How much of the baked lightmap is kept (1 = as the game looked). */
  baked: number;
}

export const DEFAULT_SUN: Readonly<SunSettings> = { enabled: false, azimuth: 135, elevation: 50, intensity: 0.6, ambient: 0.15, baked: 1 };

/**
 * The unit vector from the ground toward the sun, in the scene's coordinates. The game is x east, y north, z up; the scene is the mirror (game x, y, z -> scene x, z, y),
 * so game (x, y, z) = (sin az cos el, cos az cos el, sin el) becomes scene (x, y, z) = (sin az cos el, sin el, cos az cos el).
 */
export function sunDirection(azimuthDeg: number, elevationDeg: number): { x: number; y: number; z: number } {
  const az = (azimuthDeg * Math.PI) / 180, el = (elevationDeg * Math.PI) / 180;
  return { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: Math.cos(az) * Math.cos(el) };
}

/** Read a sun from untrusted values: out-of-range numbers are clamped. */
export function normalizeSun(s: Partial<SunSettings>): SunSettings {
  const n = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const d = DEFAULT_SUN;
  return {
    enabled: typeof s.enabled === "boolean" ? s.enabled : d.enabled,
    azimuth: ((n(s.azimuth, -1e6, 1e6, d.azimuth) % 360) + 360) % 360,
    elevation: n(s.elevation, 2, 90, d.elevation),
    intensity: n(s.intensity, 0, 3, d.intensity),
    ambient: n(s.ambient, 0, 1.5, d.ambient),
    baked: n(s.baked, 0, 2, d.baked),
  };
}

export interface Vec3 { x: number; y: number; z: number; }

/**
 * The matrix that maps scene positions into the sun's shadow map (docs/LIGHTING.md): an orthographic box around `box` seen along the sun's direction, so that a point
 * inside the box gets (u, v, depth) in 0..1 (u and v across the map, depth increasing away from the sun). Row-vector layout as Babylon matrices (p * M); in a shader it is
 * `matrix * vec4(p, 1.0)`. Also returns the depth range in world units (to turn a bias in units into a bias in depth) and the width of the box (for the texel size).
 */
export function shadowMatrix(toSun: Vec3, box: { min: Vec3; max: Vec3 }): { m: number[]; depthRange: number; width: number; height: number } {
  const f = { x: -toSun.x, y: -toSun.y, z: -toSun.z }; // the light travels this way
  const ref = Math.abs(toSun.y) > 0.99 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
  const right = norm(cross(ref, f));
  const up = cross(f, right);
  const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = { x, y, z };
    const lx = dot(p, right), ly = dot(p, up), lz = dot(p, f);
    minX = Math.min(minX, lx); maxX = Math.max(maxX, lx);
    minY = Math.min(minY, ly); maxY = Math.max(maxY, ly);
    minZ = Math.min(minZ, lz); maxZ = Math.max(maxZ, lz);
  }
  const sx = maxX - minX || 1, sy = maxY - minY || 1, sz = maxZ - minZ || 1;
  const m = [
    right.x / sx, up.x / sy, f.x / sz, 0,
    right.y / sx, up.y / sy, f.y / sz, 0,
    right.z / sx, up.z / sy, f.z / sz, 0,
    -minX / sx, -minY / sy, -minZ / sz, 1,
  ];
  return { m, depthRange: sz, width: sx, height: sy };
}

export interface ShadowSettings {
  enabled: boolean;
  /** How dark a fully shadowed surface gets, 0 (no change) to 1 (black). */
  darkness: number;
  /** Depth bias in world units: how far a surface must be behind the stored depth to count as shadowed (stops surfaces shadowing themselves). */
  bias: number;
  /** Shadow map size in texels: 2048 or 4096. */
  size: 2048 | 4096;
}

export const DEFAULT_SHADOWS: Readonly<ShadowSettings> = { enabled: false, darkness: 0.5, bias: 0.4, size: 4096 };

export function normalizeShadows(s: Partial<ShadowSettings>): ShadowSettings {
  const n = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const d = DEFAULT_SHADOWS;
  return {
    enabled: typeof s.enabled === "boolean" ? s.enabled : d.enabled,
    darkness: n(s.darkness, 0, 1, d.darkness),
    bias: n(s.bias, 0, 3, d.bias),
    size: s.size === 2048 ? 2048 : 4096,
  };
}
