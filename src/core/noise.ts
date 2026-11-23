import { createNoise2D } from 'simplex-noise';
import { rngFor } from './rng.ts';

/**
 * Seeded noise. The only module allowed to import simplex-noise, and it always passes a seeded
 * PRNG (without one, simplex-noise would fall back to Math.random). Uses only +, −, ×, floor and
 * sqrt, which are identical on every JS engine.
 */

export type Noise2 = (x: number, y: number) => number;

export function noise2(seed: string, salt: string): Noise2 {
  return createNoise2D(rngFor(seed, salt));
}

/** Fractal sum of `octaves` layers (lacunarity 2, gain 0.5), normalised to about [−1, 1]. */
export function fbm2(noise: Noise2, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amplitude = 1;
  let norm = 0;
  let frequency = 1;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * frequency, y * frequency) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / norm;
}
