import { hash32, hashUnit } from '../../core/hash.ts';
import { fbm, grain, smooth, stretch, tri, unit, valueNoise, wrapDelta } from './texNoise.ts';
import { HOLE, type PatternContext, type Pixel, ramp, SOLID, SPECIAL, set } from './texPixel.ts';

/**
 * Crafted texture patterns (plan v4 « M36 »): boards, masonry, glass, fittings. Joints and seams
 * are colour 0 and sit low; feature sizes are in 16-texel units (`ctx.s`).
 */

/** Boards with grain lines, streaks, the odd knot, a gap under each and one butt joint. */
export function planks(c: PatternContext, x: number, y: number): Pixel {
  const { seed, size, s } = c;
  const boardH = Math.max(2, size >> 2);
  const board = Math.floor(y / boardH);
  const row = y % boardH;
  if (row === boardH - 1) return set(0, SOLID, 0.05);
  const ux = (x + (hash32(seed, board) % size)) % size;
  if (ux === 0) return set(0, SOLID, 0.05);
  const lines = tri(row / (2.2 * s) + 2 * valueNoise(seed + board, ux, 0, size, 3, 1));
  const streak = valueNoise(seed + 1, x, y, size, 2, 16);
  let v =
    0.25 +
    0.4 * hashUnit(seed, board, 7) +
    0.2 * (lines - 0.5) +
    0.25 * (streak - 0.5) +
    0.12 * (grain(seed, x, y) - 0.5);
  if (hashUnit(seed, board, 9) < 0.35) {
    const kx = wrapDelta(ux, hash32(seed, board, 10) % size, size) / 1.6;
    const ky = row - (boardH - 2) / 2;
    const d = Math.sqrt(kx * kx + ky * ky) / (1.4 * s);
    if (d < 1) v -= 0.3 * (1 - d);
  }
  const edge = Math.min(row, boardH - 2 - row);
  return set(ramp(v, 1, c.n - 1), SOLID, 0.6 + 0.1 * (streak - 0.5) - (edge < 1 ? 0.15 : 0));
}

/** Running-bond bricks of their own shades, recessed mortar (colour 0), chipped edges. */
export function bricks(c: PatternContext, x: number, y: number): Pixel {
  const { seed, size, s } = c;
  const rowH = Math.max(2, size >> 2);
  const brickW = Math.max(4, size >> 1);
  const row = Math.floor(y / rowH);
  const shifted = (x + (row % 2 === 0 ? 0 : brickW >> 1)) % size;
  const mortar = Math.max(1, Math.floor(s));
  const inY = y % rowH;
  const inX = shifted % brickW;
  const g = grain(seed, x, y);
  if (inY < mortar || inX < mortar) return set(0, SOLID, 0.1 + 0.1 * g);
  const brick = Math.floor(shifted / brickW);
  const edge = Math.min(inY - mortar, rowH - 1 - inY, inX - mortar, brickW - 1 - inX);
  const chip = edge < s && valueNoise(seed + 3, x, y, size, 8) < 0.3;
  const surface = fbm(seed + 1, x, y, size, 8, 2);
  const v = 0.35 * hashUnit(seed, brick, row) + 0.35 * surface + 0.3 * g - (chip ? 0.25 : 0);
  const h = chip ? 0.35 : 0.7 + 0.2 * (surface - 0.5) - (edge < 1 ? 0.1 : 0);
  return set(ramp(v, 1, c.n - 1), SOLID, h);
}

/** Square dressed stones with bevelled edges and thin joints (colour 0). */
export function cutStone(c: PatternContext, x: number, y: number): Pixel {
  const { seed, size, s } = c;
  const tile = Math.max(4, size >> 1);
  const ix = x % tile;
  const iy = y % tile;
  if (ix === 0 || iy === 0) return set(0, SOLID, 0.05);
  const edge = Math.min(ix - 1, tile - 1 - ix, iy - 1, tile - 1 - iy);
  const bevel = smooth(unit(edge / (1.5 * s)));
  const id = hashUnit(seed, Math.floor(x / tile), Math.floor(y / tile));
  const v = 0.35 * id + 0.4 * fbm(seed + 1, x, y, size, 6, 3) + 0.25 * grain(seed, x, y);
  return set(ramp(v, 1, c.n - 1), SOLID, 0.25 + 0.6 * bevel + 0.15 * v);
}

/** A frame (colour 0) round clear glass with a diagonal glint. */
export function glass(c: PatternContext, x: number, y: number): Pixel {
  const { size, s } = c;
  const frame = Math.max(1, Math.floor(s));
  if (x < frame || y < frame || x >= size - frame || y >= size - frame) return set(0, SOLID, 0.8);
  const streak = (x + y) % size;
  if (streak >= 4 * s && streak < 6 * s && x > 2 * s && x < size - 3 * s)
    return set(Math.min(1, c.n - 1), SOLID, 0.5);
  return set(0, HOLE);
}

/**
 * A stick (colours 0–1) under a flame (2–3) inside the torch's box: 2/16 wide, 10/16 tall, so the
 * flame (rows 7–9 of 16) shows on the sides and the top.
 */
export function torch(c: PatternContext, x: number, y: number): Pixel {
  const { seed, s } = c;
  const lo = 7 * s;
  const hi = 9 * s;
  const stickTop = 7 * s;
  if (x >= lo && x < hi && y < stickTop) return set(ramp(grain(seed, x, y), 0, 2));
  if (x >= lo - s && x < hi + s && y >= stickTop && y < stickTop + 3 * s) {
    const core = x >= lo && x < hi && y < stickTop + 2 * s;
    return set(Math.min(c.n - 1, core ? 3 : 2));
  }
  return set(0, HOLE);
}

/** A frame (colour 0) with crossed slats over a panel (a gate, a workbench side). */
export function lattice(c: PatternContext, x: number, y: number): Pixel {
  const { seed, size, s } = c;
  const border = 2 * s;
  const wood = valueNoise(seed, x, y, size, 2, 12);
  if (x < border || y < border || x >= size - border || y >= size - border)
    return set(ramp(0.4 * wood, 0, 2), SOLID, 0.8);
  const step = 6 * s;
  if ((x + y) % step < s || (x - y + size) % step < s) return set(Math.min(1, c.n - 1), SOLID, 0.9);
  return set(ramp(0.3 + 0.4 * grain(seed, x, y) + 0.3 * wood, 1, c.n - 1), SOLID, 0.4);
}

/** Two rails and a rung every half tile over holes (a ladder's box is 1–15 of 16). */
export function ladder(c: PatternContext, x: number, y: number): Pixel {
  const { seed, size } = c;
  const q = size >> 3;
  const rail = (x >= q && x < q * 2) || (x >= size - q * 2 && x < size - q);
  const step = y % (size >> 1);
  const rung = x >= q && x < size - q && step >= q && step < q * 2;
  if (!rail && !rung) return set(0, HOLE);
  const wood = rail ? valueNoise(seed, x, y, size, 4, 1) : valueNoise(seed, x, y, size, 1, 8);
  const v = 0.6 * wood + 0.4 * grain(seed, x, y);
  return set(ramp(v, rail ? 0 : 1, c.n - (rail ? 1 : 2)), SOLID, rail ? 0.85 : 0.7);
}

/** Bricks round a mouth; with five colours or more, its embers glow (SPECIAL, colours 3–4). */
export function furnaceFront(c: PatternContext, x: number, y: number): Pixel {
  const { seed, size } = c;
  const mouth = x >= size * 0.25 && x < size * 0.75 && y >= size * 0.15 && y < size * 0.5;
  if (!mouth) return bricks({ ...c, n: Math.min(3, c.n) }, x, y);
  if (c.n <= 4) return set(Math.min(3, c.n - 1), SOLID, 0.1);
  const ember = fbm(seed, x, y, size, 8, 2) + 0.3 * (grain(seed, x, y) - 0.5);
  return set(ramp(stretch(ember, 3), 3, 2), SPECIAL, 0.1 + 0.2 * ember);
}

/** The missing texture's checks: 4 × 4 squares of colours 0 and 1. */
export function checker(c: PatternContext, x: number, y: number): Pixel {
  const square = Math.floor((x * 4) / c.size) + Math.floor((y * 4) / c.size);
  return set(square % 2 === 0 ? 0 : Math.min(1, c.n - 1), SOLID, 0.5);
}
