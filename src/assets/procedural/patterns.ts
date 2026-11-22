import type { TextureDef, TexturePattern } from '../../content/schema.ts';
import { hash32, hashUnit } from '../../core/hash.ts';
import { parseHex } from './textureGen.ts';

/**
 * Pattern library for pack textures. Each pattern returns a palette index and a pixel class:
 * SOLID, HOLE (transparent for coverage textures) or SPECIAL (mask pixels: ore flecks, glowing
 * embers, the grass part of a turf side). Rows are bottom-up (y = 0 is the bottom row).
 */

const SOLID = 0;
const HOLE = 1;
const SPECIAL = 2;

interface Pixel {
  index: number;
  kind: number;
}

const px: Pixel = { index: 0, kind: SOLID };

/** 4×4 ordered-dither matrix, normalised to [-0.5, 0.5). */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5);

function dither(x: number, y: number): number {
  return BAYER4[(y & 3) * 4 + (x & 3)]!;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Tileable value noise in [0, 1). */
function tileNoise(seed: number, x: number, y: number, size: number, cells: number): number {
  const fx = (x / size) * cells;
  const fy = (y / size) * cells;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);
  const at = (ix: number, iy: number) =>
    hashUnit(seed, ((ix % cells) + cells) % cells, ((iy % cells) + cells) % cells, 101);
  const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
  const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
  return top + (bottom - top) * ty;
}

function pick(value: number, from: number, count: number): number {
  return from + Math.min(count - 1, Math.max(0, Math.floor(value * count)));
}

function set(index: number, kind = SOLID): Pixel {
  px.index = index;
  px.kind = kind;
  return px;
}

type PatternFn = (seed: number, n: number, x: number, y: number, size: number) => Pixel;

const PATTERNS: Readonly<Record<TexturePattern, PatternFn>> = {
  speckle: (seed, n, x, y, size) => {
    const v = 0.65 * tileNoise(seed, x, y, size, 4) + 0.35 * hashUnit(seed, x, y);
    return set(pick(v + dither(x, y) * 0.35, 0, n));
  },
  strata: (seed, n, x, y, size) => {
    const wobble = Math.floor(tileNoise(seed, x, 0, size, 2) * 3);
    const band = Math.floor((y + wobble) / 3);
    const v =
      0.5 * hashUnit(seed, band, 3) +
      0.3 * tileNoise(seed, x, y, size, 4) +
      0.2 * hashUnit(seed, x, y);
    return set(pick(v + dither(x, y) * 0.25, 0, n));
  },
  planks: (seed, n, x, y, size) => {
    const boardHeight = Math.max(2, size >> 2);
    const board = Math.floor(y / boardHeight);
    if (y % boardHeight === boardHeight - 1) return set(0);
    const offset = hash32(seed, board) % size;
    if ((x + offset) % size === 0) return set(0);
    const shade = hashUnit(seed, board, 7);
    const grain = hashUnit(seed, (x + offset) % size, board) < 0.18 ? -0.25 : 0;
    return set(pick(0.35 + shade * 0.45 + grain + dither(x, y) * 0.2, 0, n));
  },
  bark: (seed, n, x, y, size) => {
    const column = 0.6 * hashUnit(seed, x, 1) + 0.4 * tileNoise(seed, x, y, size, 2);
    const crack = hashUnit(seed, x, Math.floor(y / 4)) < 0.12;
    return set(crack ? 0 : pick(column + dither(x, y) * 0.3, 0, n));
  },
  rings: (seed, n, x, y, size) => {
    const c = (size - 1) / 2;
    const d = Math.sqrt((x - c) * (x - c) + (y - c) * (y - c));
    if (d > c - 0.2) return set(0);
    const ring = Math.floor(d / 1.6 + hashUnit(seed, x, y) * 0.4);
    return set(1 + (ring % Math.max(1, n - 1)));
  },
  leaves: (seed, n, x, y, size) => {
    const v = 0.55 * tileNoise(seed, x, y, size, 4) + 0.45 * hashUnit(seed, x, y);
    if (v < 0.3) return set(0, HOLE);
    return set(pick((v - 0.3) / 0.7 + dither(x, y) * 0.3, 0, n));
  },
  turfSide: (seed, n, x, y, size) => {
    const soil = Math.max(1, n - 2);
    const fringe = size - 3 - (hash32(seed, x, 5) % 3);
    if (y >= fringe) return set(soil + (hashUnit(seed, x, y) < 0.5 ? 0 : 1), SPECIAL);
    const v = 0.6 * tileNoise(seed, x, y, size, 4) + 0.4 * hashUnit(seed, x, y);
    return set(pick(v + dither(x, y) * 0.3, 0, soil));
  },
  ore: (seed, n, x, y, size) => {
    const rock = Math.max(1, n - 2);
    for (let i = 0; i < 4; i++) {
      const cx = hash32(seed, i, 11) % size;
      const cy = hash32(seed, i, 13) % size;
      const dx = Math.min(Math.abs(x - cx), size - Math.abs(x - cx));
      const dy = Math.min(Math.abs(y - cy), size - Math.abs(y - cy));
      if (dx * dx + dy * dy <= 2 && hashUnit(seed, x, y, i) < 0.85) {
        return set(rock + (hashUnit(seed, x, y, 3) < 0.5 ? 0 : 1), SPECIAL);
      }
    }
    const v = 0.6 * tileNoise(seed, x, y, size, 4) + 0.4 * hashUnit(seed, x, y);
    return set(pick(v + dither(x, y) * 0.3, 0, rock));
  },
  bricks: (seed, n, x, y, size) => {
    const rowHeight = Math.max(2, size >> 2);
    const row = Math.floor(y / rowHeight);
    const brickWidth = Math.max(4, size >> 1);
    const shifted = (x + (row % 2 === 0 ? 0 : brickWidth >> 1)) % size;
    if (y % rowHeight === 0 || shifted % brickWidth === 0) return set(0);
    const brick = Math.floor(shifted / brickWidth);
    const v = 0.5 * hashUnit(seed, brick, row) + 0.5 * hashUnit(seed, x, y);
    return set(pick(v + dither(x, y) * 0.2, 1, n - 1));
  },
  cutStone: (seed, n, x, y, size) => {
    const tile = Math.max(4, size >> 1);
    if (x % tile === 0 || y % tile === 0) return set(0);
    const v =
      0.5 * hashUnit(seed, Math.floor(x / tile), Math.floor(y / tile)) + 0.5 * hashUnit(seed, x, y);
    return set(pick(v + dither(x, y) * 0.25, 1, n - 1));
  },
  ripple: (seed, n, x, y, size) => {
    const wave = Math.floor((y + Math.floor(tileNoise(seed, x, y, size, 2) * 4)) / 2);
    const v = 0.5 * (wave % 2) + 0.5 * hashUnit(seed, x, y);
    return set(pick(v + dither(x, y) * 0.2, 0, n));
  },
  glass: (seed, n, x, y, size) => {
    if (x === 0 || y === 0 || x === size - 1 || y === size - 1) return set(0);
    const streak = (x + y) % size;
    if ((streak === 4 || streak === 5) && x > 2 && x < size - 3) return set(Math.min(1, n - 1));
    void seed;
    return set(0, HOLE);
  },
  cross: (seed, n, x, y, size) => {
    const height = Math.floor(size * (0.45 + 0.55 * hashUnit(seed, x, 9)));
    const blade = hashUnit(seed, x, 4) < 0.6;
    if (!blade || y >= height) return set(0, HOLE);
    return set(pick(y / height + hashUnit(seed, x, y) * 0.3 - 0.15, 0, n));
  },
  torch: (seed, n, x, y, size) => {
    const lo = (size >> 1) - 1;
    const hi = size >> 1;
    const stickTop = Math.floor(size * 0.6);
    if (x >= lo && x <= hi && y < stickTop)
      return set(hashUnit(seed, x, y) < 0.5 ? 0 : Math.min(1, n - 1));
    if (x >= lo - 1 && x <= hi + 1 && y >= stickTop && y < stickTop + 3) {
      const core = x >= lo && x <= hi && y < stickTop + 2;
      return set(Math.min(n - 1, core ? 3 : 2));
    }
    return set(0, HOLE);
  },
  lattice: (seed, n, x, y, size) => {
    if (x < 2 || y < 2 || x >= size - 2 || y >= size - 2) return set(0);
    const slat = (x + y) % 6 === 0 || (x - y + size) % 6 === 0;
    return set(slat ? Math.min(1, n - 1) : pick(hashUnit(seed, x, y), 1, n - 1));
  },
  furnaceFront: (seed, n, x, y, size) => {
    const mouth = x >= size * 0.25 && x < size * 0.75 && y >= size * 0.15 && y < size * 0.5;
    if (mouth) {
      if (n > 4) {
        const ember = hashUnit(seed, x, y) < 0.55;
        return set(ember ? 4 : 3, SPECIAL);
      }
      return set(Math.min(3, n - 1));
    }
    return PATTERNS.bricks(seed, Math.min(3, n), x, y, size);
  },
  checker: (_seed, n, x, y) => set(((x >> 2) + (y >> 2)) % 2 === 0 ? 0 : Math.min(1, n - 1)),
};

/** Generates one pack texture as RGBA bytes, applying the texture's alpha convention. */
export function generatePackTexture(def: TextureDef, size: number): Uint8Array {
  const colors = def.palette.map(parseHex);
  const out = new Uint8Array(size * size * 4);
  const fn = PATTERNS[def.pattern];
  const alpha = def.alpha ?? 'opaque';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = fn(def.seed, colors.length, x, y, size);
      const color = colors[Math.min(colors.length - 1, Math.max(0, p.index))]!;
      const o = (y * size + x) * 4;
      out[o] = color[0];
      out[o + 1] = color[1];
      out[o + 2] = color[2];
      out[o + 3] =
        alpha === 'opaque'
          ? 255
          : alpha === 'coverage'
            ? p.kind === HOLE
              ? 0
              : 255
            : p.kind === SPECIAL
              ? 255
              : 0;
    }
  }
  return out;
}
