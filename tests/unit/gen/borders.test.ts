import { describe, expect, it } from 'vitest';
import { createGenContext } from '../../../src/world/gen/generateColumn.ts';
import { LatticeCache, pointInfo } from '../../../src/world/gen/sample.ts';
import { registry } from '../../helpers/registry.ts';

/*
 * Clean biome borders (docs plan v2 « M16 »): a smooth field shifts the biome thresholds, so no
 * block column stands alone in a biome none of its 4 neighbours has.
 */

const SIZE = 256;

describe('biome borders', () => {
  it('never leaves a column alone in another biome than its 4 neighbours (5 seeds, 256²)', () => {
    for (const seed of ['1', '7', '42', 'border', 'planet']) {
      const ctx = createGenContext(seed, registry);
      const cache = new LatticeCache();
      const biomes = new Uint8Array((SIZE + 2) * (SIZE + 2));
      const at = (x: number, z: number) => (z + 1) * (SIZE + 2) + x + 1;
      for (let z = -1; z <= SIZE; z++)
        for (let x = -1; x <= SIZE; x++) biomes[at(x, z)] = pointInfo(ctx, x, z, cache).biome;
      const lonely: string[] = [];
      for (let z = 0; z < SIZE; z++)
        for (let x = 0; x < SIZE; x++) {
          const b = biomes[at(x, z)]!;
          if (
            b !== biomes[at(x - 1, z)] &&
            b !== biomes[at(x + 1, z)] &&
            b !== biomes[at(x, z - 1)] &&
            b !== biomes[at(x, z + 1)]
          )
            lonely.push(`${seed}: (${x}, ${z})`);
        }
      expect(lonely).toEqual([]);
    }
  });
});
