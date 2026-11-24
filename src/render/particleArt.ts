import { CUTOUT_ALPHA } from './shaders/voxel.glsl.ts';

/** A chip or a puff shows a 2 × 2 texel patch of its block. */
export const PATCH_TEXELS = 2;
/** Coverage alpha (0–255) of a texel that is not a hole (the shaders' cutout threshold). */
const COVERED = Number(CUTOUT_ALPHA) * 255;

/** What particles look like: the chunks' tints and the texture array's pixels. */
export interface ParticleArt {
  /** `boxTint` of each chunk tint index (`tintIndex`: a tint channel in a biome). */
  readonly tints: readonly number[];
  /** RGBA bytes of every texture layer, one after another, `size` × `size` texels each. */
  readonly texels: Uint8Array;
  readonly size: number;
}

/**
 * The palest fully opaque texel of the texture array (its layer, column and row): the colour of
 * the attack trail, found without naming content.
 */
export function palestTexel(
  texels: Uint8Array,
  size: number,
): { layer: number; x: number; y: number } {
  let best = -1;
  let at = 0;
  for (let o = 0; o + 3 < texels.length; o += 4) {
    if (texels[o + 3] !== 255) continue;
    const luma = 2126 * texels[o]! + 7152 * texels[o + 1]! + 722 * texels[o + 2]!;
    if (luma > best) {
      best = luma;
      at = o / 4;
    }
  }
  const area = size * size;
  return { layer: Math.floor(at / area), x: at % size, y: Math.floor((at % area) / size) };
}

/**
 * The corner texel (row × size + column) of a particle's patch of `layer`: `pick` (0…1) picks one
 * of every corner whose patch fits in the texture; for a cutout layer, the first from there (row by
 * row, wrapping) whose patch has no hole, if the texture has one.
 */
export function patchCorner(
  art: ParticleArt,
  layer: number,
  cutout: boolean,
  pick: number,
): number {
  const starts = art.size - PATCH_TEXELS + 1;
  const count = starts * starts;
  let corner = Math.floor(pick * count);
  for (let n = 0; cutout && n < count; n++) {
    const c = (corner + n) % count;
    if (covered(art, layer, c % starts, Math.floor(c / starts))) {
      corner = c;
      break;
    }
  }
  return Math.floor(corner / starts) * art.size + (corner % starts);
}

/** The patch of `layer` from texel (px, py) (column, row) has no hole. */
function covered(art: ParticleArt, layer: number, px: number, py: number): boolean {
  const size = art.size;
  for (let dy = 0; dy < PATCH_TEXELS; dy++) {
    for (let dx = 0; dx < PATCH_TEXELS; dx++) {
      const o = ((layer * size + py + dy) * size + px + dx) * 4 + 3;
      if ((art.texels[o] ?? 0) < COVERED) return false;
    }
  }
  return true;
}
