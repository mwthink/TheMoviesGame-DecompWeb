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
