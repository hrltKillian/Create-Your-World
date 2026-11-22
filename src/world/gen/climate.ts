import type { WorldgenDef } from '../../content/schema.ts';
import { fbm2, type Noise2, noise2 } from '../../core/noise.ts';

/** Climate at one point. All fields are roughly in [−1, 1]. */
export interface ClimateSample {
  C: number;
  E: number;
  M: number;
  T: number;
  H: number;
  X: number;
  detail: number;
}

export function emptySample(): ClimateSample {
  return { C: 0, E: 0, M: 0, T: 0, H: 0, X: 0, detail: 0 };
}

/** Triangle wave of period 1: −1 at u = −0.25, 0 at u = 0, +1 at u = 0.25. */
export function triangle(u: number): number {
  const v = u + 0.25;
  const frac = v - Math.floor(v);
  return 1 - 4 * Math.abs(frac - 0.5);
}

/**
 * Raw climate noise. World generation never samples it per block: it samples a lattice anchored
 * to the world grid (every `climateStep` blocks) and interpolates, so a point query and a whole
 * column give exactly the same values.
 */
export class Climate {
  private readonly def: WorldgenDef;
  private readonly c: Noise2;
  private readonly e: Noise2;
  private readonly m: Noise2;
  private readonly t: Noise2;
  private readonly h: Noise2;
  private readonly x: Noise2;
  private readonly d: Noise2;

  constructor(seed: string, def: WorldgenDef) {
    this.def = def;
    this.c = noise2(seed, 'climate.continental');
    this.e = noise2(seed, 'climate.erosion');
    this.m = noise2(seed, 'climate.ridges');
    this.t = noise2(seed, 'climate.temperature');
    this.h = noise2(seed, 'climate.humidity');
    this.x = noise2(seed, 'climate.toxicity');
    this.d = noise2(seed, 'climate.detail');
  }

  /** Samples the raw fields at a world position (used for lattice points only). */
  raw(x: number, z: number, out: ClimateSample): void {
    const s = this.def.scales;
    out.C = fbm2(this.c, x / s.continental, z / s.continental, 4);
    out.E = fbm2(this.e, x / s.erosion, z / s.erosion, 3);
    out.M = fbm2(this.m, x / s.ridges, z / s.ridges, 3);
    const band = this.def.latitude.amplitude * triangle(z / this.def.latitude.period);
    out.T =
      fbm2(this.t, x / s.temperature, z / s.temperature, 3) * (1 - this.def.latitude.amplitude) +
      band;
    out.H = fbm2(this.h, x / s.humidity, z / s.humidity, 3);
    out.X = fbm2(this.x, x / s.toxicity, z / s.toxicity, 2);
    out.detail = fbm2(this.d, x / s.detail, z / s.detail, 2);
  }
}

/** Bilinear interpolation in a fixed order (keeps point queries and bulk generation identical). */
export function bilerp(
  v00: number,
  v10: number,
  v01: number,
  v11: number,
  tx: number,
  tz: number,
): number {
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * tz;
}

const FIELDS = ['C', 'E', 'M', 'T', 'H', 'X', 'detail'] as const;

/** Interpolates four lattice samples into `out`. */
export function interpolateSample(
  s00: ClimateSample,
  s10: ClimateSample,
  s01: ClimateSample,
  s11: ClimateSample,
  tx: number,
  tz: number,
  out: ClimateSample,
): void {
  for (const f of FIELDS) out[f] = bilerp(s00[f], s10[f], s01[f], s11[f], tx, tz);
}
