import { describe, expect, it } from 'vitest';
import { BIOME_STEP, findBiome, spiral } from '../../../src/world/gen/find.ts';
import { createGenContext } from '../../../src/world/gen/generateColumn.ts';
import { LatticeCache, pointInfo } from '../../../src/world/gen/sample.ts';
import { registry } from '../../helpers/registry.ts';

const ctx = createGenContext('find', registry);

describe('world searches', () => {
  it('walks a square spiral ring by ring, each offset once', () => {
    const seen: string[] = [];
    const rings: number[] = [];
    spiral(3, (dx, dz, ring) => {
      seen.push(`${dx},${dz}`);
      rings.push(ring);
      expect(Math.max(Math.abs(dx), Math.abs(dz))).toBe(ring);
      return false;
    });
    expect(new Set(seen).size).toBe(49);
    expect(rings).toEqual([...rings].sort((a, b) => a - b));
    let visits = 0;
    expect(spiral(3, () => ++visits === 5)).toBe(true);
    expect(visits).toBe(5);
  });

  it('finds the nearest sampled column of every biome', () => {
    const from = { x: 100, z: -50 };
    const cache = new LatticeCache();
    ctx.biomes.forEach((biome, index) => {
      const hit = findBiome(ctx, biome.def.key, from, 2500);
      expect(hit, biome.def.key).not.toBeNull();
      if (!hit) return;
      expect(pointInfo(ctx, hit.x, hit.z, cache).biome).toBe(index);
      expect(hit.distance).toBeCloseTo(Math.sqrt((hit.x - from.x) ** 2 + (hit.z - from.z) ** 2));
      // No sample of the grid nearer to the origin lies in that biome.
      const reach = Math.ceil(hit.distance / BIOME_STEP) + 1;
      const gx = Math.round(from.x / BIOME_STEP);
      const gz = Math.round(from.z / BIOME_STEP);
      for (let dz = -reach; dz <= reach; dz++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const x = (gx + dx) * BIOME_STEP;
          const z = (gz + dz) * BIOME_STEP;
          if (Math.sqrt((x - from.x) ** 2 + (z - from.z) ** 2) >= hit.distance) continue;
          expect(pointInfo(ctx, x, z, cache).biome, `${biome.def.key} ${x} ${z}`).not.toBe(index);
        }
      }
    });
  });

  it('gives up beyond the radius and refuses unknown biomes', () => {
    const from = { x: 0, z: 0 };
    const here = ctx.biomes[pointInfo(ctx, 0, 0).biome]!.def.key;
    expect(findBiome(ctx, here, from, 0)).toEqual({ x: 0, z: 0, distance: 0 });
    const other = ctx.biomes.find((b) => b.def.key !== here)!.def.key;
    expect(findBiome(ctx, other, from, 0)).toBeNull();
    expect(() => findBiome(ctx, 'biome:nope', from, 100)).toThrow(/Unknown biome/);
  });
});
