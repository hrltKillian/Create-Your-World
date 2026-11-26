import { unit } from './texNoise.ts';

/**
 * Material layers of the pack textures (plan v4 « M36 »), derived from a pattern's relief heights:
 * RGBA = the normal's x and y in tangent space (0.5 is flat; rows bottom-up, so +y is up the
 * texture), the roughness, and the cavity (ambient light a texel keeps, 1 on open ground).
 * Linear values, not colours.
 */

/** Normal tilt per height step between neighbour texels, for relief 1 on a 32-texel tile. */
const NORMAL_SCALE = 4;
/** Ambient light lost per height a texel lies under the mean of its 5 × 5 surroundings. */
const CAVITY = 1.6;
const CAVITY_MIN = 0.45;

function byte(v: number): number {
  return Math.round(unit(v) * 255);
}

/**
 * The material layer of one texture: `heights` and `roughness` are size × size texels (rows
 * bottom-up), the tile wrapping at its edges; `relief` scales the normals and the cavity (0: flat).
 */
export function materialLayer(
  heights: Float32Array,
  roughness: Float32Array,
  size: number,
  relief: number,
): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  // A finer tile has gentler steps between texels for the same shape: scale them back.
  const k = relief * NORMAL_SCALE * (size / 32);
  const at = (x: number, y: number) =>
    heights[(((y % size) + size) % size) * size + (((x % size) + size) % size)]!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * k;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * k;
      const length = Math.sqrt(dx * dx + dy * dy + 1);
      let sum = 0;
      for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) sum += at(x + i, y + j);
      const below = sum / 25 - at(x, y);
      const cavity = Math.max(CAVITY_MIN, 1 - CAVITY * relief * Math.max(0, below));
      const o = (y * size + x) * 4;
      out[o] = byte(0.5 - (0.5 * dx) / length);
      out[o + 1] = byte(0.5 - (0.5 * dy) / length);
      out[o + 2] = byte(roughness[y * size + x]!);
      out[o + 3] = byte(cavity);
    }
  }
  return out;
}
