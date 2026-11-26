import { describe, expect, it } from 'vitest';
import { SHAPE_LIQUID } from '../../../src/content/rawTables.ts';
import { isLiquidLayer, liquidLayerMask } from '../../../src/render/liquidLayers.ts';
import { registry } from '../../helpers/registry.ts';

describe('liquid layers (plan v4 « M38 »)', () => {
  it("marks the layers of every liquid's faces, and those only", () => {
    const tables = registry.tables;
    const mask = liquidLayerMask(tables);
    const liquid = new Set<number>();
    for (let state = 0; state < tables.shape.length; state++)
      if (tables.shape[state] === SHAPE_LIQUID)
        for (let face = 0; face < 6; face++) liquid.add(tables.faceLayer[state * 6 + face]!);
    expect(liquid.size).toBeGreaterThan(1);
    for (let layer = 0; layer < registry.textureKeys.length; layer++)
      expect(isLiquidLayer(mask, layer), registry.textureKeys[layer]).toBe(liquid.has(layer));
  });

  it('keeps the high bit of a word as GLSL ints read it', () => {
    const mask = new Int32Array(16);
    mask[0] = 1 << 31;
    expect(isLiquidLayer(mask, 31)).toBe(true);
    expect(isLiquidLayer(mask, 30)).toBe(false);
  });
});
