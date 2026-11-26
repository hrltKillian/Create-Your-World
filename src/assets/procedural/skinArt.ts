import { MASK_INDEX, SKIN_SIZE, type SkinDef } from '../../content/schema.ts';
import { NORMAL_SCALE } from './materialMap.ts';
import { DEFAULT_ROUGHNESS } from './packTexture.ts';
import { parseHex } from './palette.ts';

/** Alpha of a glowing texel in a skin layer (the box shader draws it at full brightness). */
export const GLOW_ALPHA = 128;

/**
 * A skin atlas as a texture layer (plan v5 « M52 »): SKIN_SIZE² RGBA texels, rows from the top as
 * the mask draws them; empty texels clear, glowing ones at GLOW_ALPHA, the others opaque.
 */
export function skinPixels(def: SkinDef): Uint8Array {
  const out = new Uint8Array(SKIN_SIZE * SKIN_SIZE * 4);
  const colours = def.palette.map(parseHex);
  const glow = new Set(def.glow ?? []);
  def.mask.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const index = MASK_INDEX.indexOf(row[x]!);
      const colour = colours[index];
      if (!colour) continue;
      const o = (y * SKIN_SIZE + x) * 4;
      out.set(colour, o);
      out[o + 3] = glow.has(index) ? GLOW_ALPHA : 255;
    }
  });
  return out;
}

/**
 * A skin's relief (plan v4 « M41 » on the creatures of plan v5 « M52 »): its material layer, rows
 * from the top like its colours. Each texel's height is its brightness (a lit tone stands out, a
 * seam sinks, an empty texel lies low), tilting the normal as a block tile's relief 1 does; matte,
 * no cavity (the tones are drawn shaded). Only the rows the mask draws are computed.
 */
export function skinMaterial(def: SkinDef): Uint8Array {
  const out = new Uint8Array(SKIN_SIZE * SKIN_SIZE * 4);
  const bright = def.palette.map((hex) => {
    const [r, g, b] = parseHex(hex);
    return (0.3 * r + 0.59 * g + 0.11 * b) / 255;
  });
  const heights = new Float32Array((SKIN_SIZE + 2) * (SKIN_SIZE + 2)).fill(EMPTY_HEIGHT);
  const at = (x: number, y: number) => (y + 1) * (SKIN_SIZE + 2) + x + 1;
  def.mask.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const index = MASK_INDEX.indexOf(row[x]!);
      if (index >= 0 && index < bright.length) heights[at(x, y)] = bright[index]!;
    }
  });
  const rough = Math.round(DEFAULT_ROUGHNESS * 255);
  def.mask.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '.') continue;
      const dx = (heights[at(x + 1, y)]! - heights[at(x - 1, y)]!) * 0.5 * NORMAL_SCALE;
      // Up the skin is a row up.
      const dy = (heights[at(x, y - 1)]! - heights[at(x, y + 1)]!) * 0.5 * NORMAL_SCALE;
      const length = Math.sqrt(dx * dx + dy * dy + 1);
      const o = (y * SKIN_SIZE + x) * 4;
      out[o] = Math.round((0.5 - (0.5 * dx) / length) * 255);
      out[o + 1] = Math.round((0.5 - (0.5 * dy) / length) * 255);
      out[o + 2] = rough;
      out[o + 3] = 255;
    }
  });
  return out;
}

/** The height of an empty texel: the edges of a part's faces bevel down to it. */
const EMPTY_HEIGHT = 0.2;
