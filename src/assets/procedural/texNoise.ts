import { hash32, hashUnit } from '../../core/hash.ts';

/**
 * Tileable noises of the pack textures (plan v4 « M36 »): every function wraps at the tile's
 * `size`, so a texture repeats without a seam. Pure: integer hashes and arithmetic only.
 */

export function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** `v` clamped to [0, 1]. */
export function unit(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** A triangle wave of period 1 in [0, 1]: 1 at whole numbers, 0 halfway. */
export function tri(t: number): number {
  return Math.abs(2 * (t - Math.floor(t)) - 1);
}

/** The shortest signed step from `b` to `a` on a ring of `size`. */
export function wrapDelta(a: number, b: number, size: number): number {
  let d = (a - b) % size;
  if (d > size / 2) d -= size;
  else if (d < -size / 2) d += size;
  return d;
}

/** White grain in [0, 1), one value a texel. */
export function grain(seed: number, x: number, y: number): number {
  return hashUnit(seed, x, y, 77);
}

function lattice(seed: number, x: number, y: number, cx: number, cy: number): number {
  return hashUnit(seed, ((x % cx) + cx) % cx, ((y % cy) + cy) % cy, 101);
}

/** Value noise in [0, 1): `cx` × `cy` lattice cells across the tile (stretched when they differ). */
export function valueNoise(
  seed: number,
  x: number,
  y: number,
  size: number,
  cx: number,
  cy = cx,
): number {
  const fx = (x / size) * cx;
  const fy = (y / size) * cy;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);
  const a = lattice(seed, x0, y0, cx, cy);
  const b = lattice(seed, x0 + 1, y0, cx, cy);
  const c = lattice(seed, x0, y0 + 1, cx, cy);
  const d = lattice(seed, x0 + 1, y0 + 1, cx, cy);
  const top = a + (b - a) * tx;
  return top + (c + (d - c) * tx - top) * ty;
}

/** Fractal noise in [0, 1): `octaves` value noises from `cells` cells, each twice as fine and half as strong. */
export function fbm(
  seed: number,
  x: number,
  y: number,
  size: number,
  cells: number,
  octaves = 3,
): number {
  let sum = 0;
  let weight = 0;
  let amplitude = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * valueNoise(seed + o * 31, x, y, size, cells << o);
    weight += amplitude;
    amplitude *= 0.5;
  }
  return sum / weight;
}

/** `v` pushed away from 0.5 by `k` (a noise's contrast), clamped to [0, 1]. */
export function stretch(v: number, k: number): number {
  return unit(0.5 + (v - 0.5) * k);
}

/** The nearest feature point of a cellular noise (reused: read it before the next call). */
export interface CellHit {
  /** Distances in cells to the nearest and the second nearest point. */
  f1: number;
  f2: number;
  /** Hash of the nearest point's cell. */
  id: number;
  /** The texel's offset from the nearest point, in cells. */
  dx: number;
  dy: number;
}

const hit: CellHit = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };

/** Cellular noise: one jittered point a cell, `cells` cells across the tile (pebbles, leaves). */
export function cellular(seed: number, x: number, y: number, size: number, cells: number): CellHit {
  const fx = ((x + 0.5) / size) * cells;
  const fy = ((y + 0.5) / size) * cells;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  hit.f1 = 9;
  hit.f2 = 9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = (((ix + i) % cells) + cells) % cells;
      const cy = (((iy + j) % cells) + cells) % cells;
      const dx = fx - (ix + i + hashUnit(seed, cx, cy, 3));
      const dy = fy - (iy + j + hashUnit(seed, cx, cy, 5));
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < hit.f1) {
        hit.f2 = hit.f1;
        hit.f1 = d;
        hit.id = hash32(seed, cx, cy, 7);
        hit.dx = dx;
        hit.dy = dy;
      } else if (d < hit.f2) hit.f2 = d;
    }
  }
  return hit;
}
