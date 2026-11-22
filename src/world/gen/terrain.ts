import type { Spline, WorldgenDef } from '../../content/schema.ts';
import type { ClimateSample } from './climate.ts';

/** Evaluates a piecewise-linear spline (clamped at both ends). */
export function evalSpline(spline: Spline, x: number): number {
  const first = spline[0]!;
  if (x <= first[0]) return first[1];
  for (let i = 1; i < spline.length; i++) {
    const [x1, y1] = spline[i]!;
    if (x <= x1) {
      const [x0, y0] = spline[i - 1]!;
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return spline[spline.length - 1]![1];
}

/**
 * Surface height (y of the top solid block) from the climate:
 * sea level + continental offset + erosion-scaled ridges + small detail. Independent of biomes,
 * so biome borders never create cliffs.
 */
export function surfaceHeight(sample: ClimateSample, def: WorldgenDef): number {
  const ridge = 1 - Math.abs(sample.M);
  const h =
    def.seaLevel +
    evalSpline(def.continentalSpline, sample.C) +
    evalSpline(def.erosionSpline, sample.E) * ridge * ridge +
    sample.detail * def.detailAmplitude;
  return Math.max(4, Math.min(240, Math.floor(h)));
}
