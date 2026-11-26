import { type RawTables, SHAPE_LIQUID } from '../content/rawTables.ts';

/** Words of the liquid layer mask: one bit a texture layer, up to 512 layers. */
export const LIQUID_MASK_WORDS = 16;

/**
 * The texture layers of liquid faces (plan v4 « M38 »), one bit each (`layer >> 5`, `layer & 31`):
 * the chunk shader draws them as water (waves, the sky's reflection) or, in the opaque pass, as
 * drifting lava. Signed words, as GLSL `int`s read them.
 */
export function liquidLayerMask(tables: RawTables): Int32Array {
  const mask = new Int32Array(LIQUID_MASK_WORDS);
  for (let state = 0; state < tables.shape.length; state++) {
    if (tables.shape[state] !== SHAPE_LIQUID) continue;
    for (let face = 0; face < 6; face++) {
      const layer = tables.faceLayer[state * 6 + face]!;
      mask[layer >> 5] = mask[layer >> 5]! | (1 << (layer & 31));
    }
  }
  return mask;
}

/** Whether `layer` is set in a liquid layer mask. */
export function isLiquidLayer(mask: Int32Array, layer: number): boolean {
  return ((mask[layer >> 5]! >> (layer & 31)) & 1) !== 0;
}
