import { hash32, hashUnit } from '../../core/hash.ts';

/**
 * Procedural pixel-art textures. Pure and deterministic: the same recipe always yields the
 * same bytes, so outputs are tested by hash. Rows are stored bottom-up (row 0 = bottom),
 * which is what WebGL expects for data textures.
 */

export type TexturePattern = 'speckle' | 'planks' | 'ore';

export interface TextureRecipe {
  readonly pattern: TexturePattern;
  /** sRGB colours, darkest first ('#rrggbb'). Ore recipes: rock colours, then ore colours. */
  readonly palette: readonly string[];
  readonly seed: number;
}

/** 4×4 ordered-dither matrix, normalised to [-0.5, 0.5). */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5);

export function parseHex(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Generates `size × size` RGBA bytes for one texture layer. */
export function generateTexture(recipe: TextureRecipe, size = 16): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const colors = recipe.palette.map(parseHex);
  if (colors.length === 0) throw new Error('Texture palette is empty');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = paletteIndex(recipe, colors.length, x, y, size);
      const color = colors[Math.min(colors.length - 1, Math.max(0, index))]!;
      const o = (y * size + x) * 4;
      out[o] = color[0];
      out[o + 1] = color[1];
      out[o + 2] = color[2];
      out[o + 3] = 255;
    }
  }
  return out;
}

function paletteIndex(
  recipe: TextureRecipe,
  n: number,
  x: number,
  y: number,
  size: number,
): number {
  const dither = BAYER4[(y & 3) * 4 + (x & 3)]!;
  switch (recipe.pattern) {
    case 'speckle': {
      const v = 0.65 * tileNoise(recipe.seed, x, y, size, 4) + 0.35 * hashUnit(recipe.seed, x, y);
      return Math.floor((v + dither * 0.35) * n);
    }
    case 'planks': {
      const boardHeight = Math.max(2, size >> 2);
      const board = Math.floor(y / boardHeight);
      const row = y % boardHeight;
      if (row === boardHeight - 1) return 0; // dark seam between boards
      const offset = hash32(recipe.seed, board) % size;
      const joint = (x + offset) % size === 0;
      if (joint) return 0;
      const shade = hashUnit(recipe.seed, board, 7);
      const grain = hashUnit(recipe.seed, (x + offset) % size, board) < 0.18 ? -0.25 : 0;
      return Math.floor((0.35 + shade * 0.45 + grain + dither * 0.2) * n);
    }
    case 'ore': {
      const rockColors = Math.max(1, n - 2);
      if (isOrePixel(recipe.seed, x, y, size)) {
        return rockColors + (hashUnit(recipe.seed, x, y, 3) < 0.5 ? 0 : 1);
      }
      const v = 0.6 * tileNoise(recipe.seed, x, y, size, 4) + 0.4 * hashUnit(recipe.seed, x, y);
      return Math.floor((v + dither * 0.3) * rockColors);
    }
  }
}

/** Ore flecks: a few small clusters around hashed centres (wrapping, so the tile is seamless). */
function isOrePixel(seed: number, x: number, y: number, size: number): boolean {
  for (let i = 0; i < 4; i++) {
    const cx = hash32(seed, i, 11) % size;
    const cy = hash32(seed, i, 13) % size;
    const dx = wrapDistance(x, cx, size);
    const dy = wrapDistance(y, cy, size);
    if (dx * dx + dy * dy <= 2 && hashUnit(seed, x, y, i) < 0.85) return true;
  }
  return false;
}

function wrapDistance(a: number, b: number, size: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, size - d);
}

/** Tileable value noise in [0, 1): `cells` lattice cells across the tile, smooth interpolation. */
function tileNoise(seed: number, x: number, y: number, size: number, cells: number): number {
  const fx = (x / size) * cells;
  const fy = (y / size) * cells;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);
  const v00 = lattice(seed, x0, y0, cells);
  const v10 = lattice(seed, x0 + 1, y0, cells);
  const v01 = lattice(seed, x0, y0 + 1, cells);
  const v11 = lattice(seed, x0 + 1, y0 + 1, cells);
  const top = v00 + (v10 - v00) * tx;
  const bottom = v01 + (v11 - v01) * tx;
  return top + (bottom - top) * ty;
}

function lattice(seed: number, x: number, y: number, cells: number): number {
  return hashUnit(seed, ((x % cells) + cells) % cells, ((y % cells) + cells) % cells, 101);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
