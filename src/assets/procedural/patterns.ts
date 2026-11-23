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

const PATTERNS: Readonly<Record<Exclude<TexturePattern, 'icon' | 'fracture'>, PatternFn>> = {
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
    // The torch box is 10/16 tall: the flame must sit in rows 7–9 so the sides and the top show it.
    const stickTop = Math.floor(size * 0.6) - 2;
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

/** Pixel of an icon mask (rows from the top, scaled to the texture size). */
function maskPixel(mask: readonly string[], x: number, y: number, size: number): Pixel {
  const row = mask[Math.floor(((size - 1 - y) * mask.length) / size)] ?? '';
  const ch = row[Math.floor((x * row.length) / size)] ?? '.';
  return ch === '.' ? set(0, HOLE) : set(Number(ch));
}

/** The 8 neighbour steps of a crack walk, turning counter-clockwise from +x. */
const STEP_X = [1, 1, 0, -1, -1, -1, 0, 1];
const STEP_Y = [0, 1, 1, 1, 0, -1, -1, -1];
/** Crack grid: walks run on 16 cells whatever the texture size. */
const CRACK_GRID = 16;
const CRACK_CORE = 1;
const CRACK_RIM = 2;

/**
 * Cells of a crack overlay at a stage, on the 16-cell grid: 0 none, CRACK_CORE, CRACK_RIM (the cell
 * under a crack, lighter). Branches walk from the centre with seeded turns; later branches fork
 * off the third cell of earlier ones. Stage s has 2 + s branches of 3 + s cells, and a walk only
 * depends on (seed, branch, step), so every stage contains the cracks of the stages before it.
 */
function fractureCells(seed: number, stage: number): Uint8Array {
  const cells = new Uint8Array(CRACK_GRID * CRACK_GRID);
  const branches = 2 + stage;
  const length = 3 + stage;
  const forkX: number[] = [];
  const forkY: number[] = [];
  const forkD: number[] = [];
  for (let b = 0; b < branches; b++) {
    let x = 7 + (hash32(seed, b, 1) % 2);
    let y = 7 + (hash32(seed, b, 2) % 2);
    let d = (b * 2 + (hash32(seed, b, 3) % 2)) & 7;
    const parent = b - 4;
    if (parent >= 0 && parent < forkX.length) {
      x = forkX[parent]!;
      y = forkY[parent]!;
      d = (forkD[parent]! + (hash32(seed, b, 4) % 2 === 0 ? 1 : 7)) & 7;
    }
    for (let k = 0; k < length; k++) {
      if (x < 0 || y < 0 || x >= CRACK_GRID || y >= CRACK_GRID) break;
      cells[y * CRACK_GRID + x] = CRACK_CORE;
      if (k === 2) {
        forkX.push(x);
        forkY.push(y);
        forkD.push(d);
      }
      const turn = hash32(seed, b, k, 5) % 5;
      if (turn === 0) d = (d + 1) & 7;
      else if (turn === 1) d = (d + 7) & 7;
      x += STEP_X[d]!;
      y += STEP_Y[d]!;
    }
  }
  for (let i = CRACK_GRID; i < cells.length; i++)
    if (cells[i] === CRACK_CORE && cells[i - CRACK_GRID] === 0) cells[i - CRACK_GRID] = CRACK_RIM;
  return cells;
}

/** Pixel of a crack overlay: palette 0 for the crack, 1 for its rim, else a hole. */
function fracturePixel(cells: Uint8Array, x: number, y: number, size: number): Pixel {
  const cell =
    cells[Math.floor((y * CRACK_GRID) / size) * CRACK_GRID + Math.floor((x * CRACK_GRID) / size)];
  return cell === CRACK_CORE ? set(0) : cell === CRACK_RIM ? set(1) : set(0, HOLE);
}

/** Generates one pack texture as RGBA bytes, applying the texture's alpha convention. */
export function generatePackTexture(def: TextureDef, size: number): Uint8Array {
  const colors = def.palette.map(parseHex);
  const out = new Uint8Array(size * size * 4);
  const alpha = def.alpha ?? 'opaque';
  const pattern = def.pattern;
  const cracks = pattern === 'fracture' ? fractureCells(def.seed, def.stage ?? 0) : null;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p =
        pattern === 'fracture'
          ? fracturePixel(cracks!, x, y, size)
          : pattern === 'icon'
            ? maskPixel(def.mask ?? [], x, y, size)
            : PATTERNS[pattern](def.seed, colors.length, x, y, size);
      const color = colors[Math.min(colors.length - 1, Math.max(0, p.index))]!;
      const o = (y * size + x) * 4;
      out[o] = color[0];
      out[o + 1] = color[1];
      out[o + 2] = color[2];
      out[o + 3] =
        alpha === 'opaque' || alpha === 'tintFull'
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
