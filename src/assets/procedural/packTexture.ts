import type { TextureAlpha, TextureDef, TexturePattern } from '../../content/schema.ts';
import { CRACK_CORE, CRACK_RIM, crackAt, fractureCells } from './fracture.ts';
import { materialLayer } from './materialMap.ts';
import { parseHex, writeTone } from './palette.ts';
import * as craft from './patternsCraft.ts';
import * as nature from './patternsNature.ts';
import { HOLE, type PatternContext, type PatternFn, type Pixel, SPECIAL, set } from './texPixel.ts';

/**
 * Pack textures (plan v4 « M36 »): a pattern's tones along the palette (fractional tones blend
 * two colours), its alpha convention, and the material layer of its relief. Pure and deterministic:
 * the same recipe always gives the same bytes (tested by hash). Rows are bottom-up.
 */

/** A texture's recipe: its definition without the key (the title scene's cube uses them too). */
export type TextureRecipe = Omit<TextureDef, 'key'>;

/** A texture's colour layer (sRGB RGBA) and material layer (`materialLayer`). */
export interface PackLayer {
  readonly color: Uint8Array;
  readonly material: Uint8Array;
}

const PATTERNS: Readonly<Record<Exclude<TexturePattern, 'icon' | 'fracture'>, PatternFn>> = {
  speckle: nature.speckle,
  stone: nature.stone,
  gravel: nature.gravel,
  sand: nature.sand,
  soil: nature.soil,
  turf: nature.turf,
  strata: nature.strata,
  ripple: nature.ripple,
  sludge: nature.sludge,
  crystal: nature.crystal,
  ore: nature.ore,
  leaves: nature.leaves,
  cross: nature.cross,
  bark: nature.bark,
  rings: nature.rings,
  turfSide: nature.turfSide,
  planks: craft.planks,
  bricks: craft.bricks,
  cutStone: craft.cutStone,
  glass: craft.glass,
  torch: craft.torch,
  lattice: craft.lattice,
  ladder: craft.ladder,
  furnaceFront: craft.furnaceFront,
  checker: craft.checker,
};

/** Each pattern's relief strength, unless its texture sets `relief`: flat for drawn and thin things. */
const RELIEF: Readonly<Record<TexturePattern, number>> = {
  speckle: 0.8,
  stone: 1.2,
  gravel: 1.6,
  sand: 0.6,
  soil: 1,
  turf: 0.7,
  strata: 1,
  ripple: 0.5,
  sludge: 1,
  crystal: 1.4,
  ore: 1.3,
  leaves: 0.9,
  cross: 0,
  bark: 1.6,
  rings: 0.8,
  turfSide: 1,
  planks: 0.9,
  bricks: 1.6,
  cutStone: 1.3,
  glass: 0,
  torch: 0,
  lattice: 1,
  ladder: 1,
  furnaceFront: 1.4,
  checker: 0,
  icon: 0,
  fracture: 0,
};

/** Roughness of a texture that sets none: matte. */
export const DEFAULT_ROUGHNESS = 0.85;

/** Pixel of an icon mask (rows from the top, scaled to the texture size): whole tones. */
function maskPixel(mask: readonly string[], x: number, y: number, size: number): Pixel {
  const row = mask[Math.floor(((size - 1 - y) * mask.length) / size)] ?? '';
  const ch = row[Math.floor((x * row.length) / size)] ?? '.';
  return ch === '.' ? set(0, HOLE, 0.5) : set(Number(ch), 0, 0.5);
}

/** Pixel of a crack overlay: colour 0 for the crack, 1 for its rim, else a hole. */
function fracturePixel(cells: Uint8Array, x: number, y: number, size: number): Pixel {
  const cell = crackAt(cells, x, y, size);
  return cell === CRACK_CORE ? set(0) : cell === CRACK_RIM ? set(1) : set(0, HOLE);
}

function alphaOf(alpha: TextureAlpha, kind: number): number {
  if (alpha === 'opaque' || alpha === 'tintFull') return 255;
  if (alpha === 'coverage') return kind === HOLE ? 0 : 255;
  return kind === SPECIAL ? 255 : 0;
}

/** Generates one pack texture: its colours, with the alpha convention, and its material. */
export function renderPackTexture(def: TextureRecipe, size: number): PackLayer {
  const colors = def.palette.map(parseHex);
  const accents = def.accents ?? 0;
  const ctx: PatternContext = {
    seed: def.seed,
    size,
    n: colors.length - accents,
    accents,
    s: size / 16,
  };
  const color = new Uint8Array(size * size * 4);
  const heights = new Float32Array(size * size);
  const roughness = new Float32Array(size * size);
  const alpha = def.alpha ?? 'opaque';
  const pattern = def.pattern;
  const cracks = pattern === 'fracture' ? fractureCells(def.seed, def.stage ?? 0) : null;
  const rough = def.roughness ?? DEFAULT_ROUGHNESS;
  const maskRough = def.maskRoughness ?? rough;
  const top = Math.max(1, colors.length - 1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p =
        cracks !== null
          ? fracturePixel(cracks, x, y, size)
          : pattern === 'icon'
            ? maskPixel(def.mask ?? [], x, y, size)
            : PATTERNS[pattern as Exclude<TexturePattern, 'icon' | 'fracture'>](ctx, x, y);
      const i = y * size + x;
      writeTone(colors, p.tone, color, i * 4);
      color[i * 4 + 3] = alphaOf(alpha, p.kind);
      heights[i] = Number.isNaN(p.height) ? p.tone / top : p.height;
      roughness[i] = p.kind === SPECIAL ? maskRough : rough;
    }
  }
  return {
    color,
    material: materialLayer(heights, roughness, size, def.relief ?? RELIEF[pattern]),
  };
}

/** The colour layer alone (icons, map colours, tests). */
export function generatePackTexture(def: TextureRecipe, size: number): Uint8Array {
  return renderPackTexture(def, size).color;
}
