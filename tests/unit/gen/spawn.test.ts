import { describe, expect, it } from 'vitest';
import { FLAG_SOLID } from '../../../src/content/registry.ts';
import { topBlockAt } from '../../../src/world/gen/banks.ts';
import { findBiome } from '../../../src/world/gen/find.ts';
import { createGenContext, type GenContext } from '../../../src/world/gen/generateColumn.ts';
import { LatticeCache, pointInfo } from '../../../src/world/gen/sample.ts';
import { findSpawn } from '../../../src/world/gen/spawn.ts';
import { blockIn, generate } from '../../helpers/gen.ts';
import { registry } from '../../helpers/registry.ts';

const SEEDS = Array.from({ length: 20 }, (_, i) => String(i + 1));
const GRAVEL = registry.defaultState('block:gravel');
const isSolid = (state: number) => (registry.tables.flags[state]! & FLAG_SOLID) !== 0;

function contexts(): [string, GenContext][] {
  return SEEDS.map((seed) => [seed, createGenContext(seed, registry)]);
}

describe('spawn point', () => {
  it('has every dangerous biome within 1 km for seeds 1–20', () => {
    for (const [seed, ctx] of contexts()) {
      const spawn = findSpawn(ctx);
      const rule = ctx.def.spawn!;
      expect(rule.far.length).toBe(3);
      expect(rule.farRadius).toBe(1000);
      for (const key of rule.far) {
        const hit = findBiome(ctx, key, spawn, rule.farRadius);
        expect(hit, `seed ${seed}: ${key}`).not.toBeNull();
        expect(hit!.distance).toBeLessThanOrEqual(1000);
      }
    }
  });

  it('stands on dry land of a spawn biome with water and gravel within 40 blocks', () => {
    for (const [seed, ctx] of contexts()) {
      const spawn = findSpawn(ctx);
      const x = Math.floor(spawn.x);
      const z = Math.floor(spawn.z);
      const cache = new LatticeCache();
      const info = pointInfo(ctx, x, z, cache);
      expect(info.height, seed).toBeGreaterThan(ctx.def.seaLevel);
      expect(ctx.spawnBiomes.has(info.biome), seed).toBe(true);
      expect(spawn.y).toBe(info.height + 1);
      const liquid = ctx.biomes[info.biome]!.liquid;
      let water = false;
      let gravel = false;
      for (let dz = -40; dz <= 40; dz++) {
        for (let dx = -40; dx <= 40; dx++) {
          if (dx * dx + dz * dz > 1600) continue;
          const at = pointInfo(ctx, x + dx, z + dz, cache);
          const biome = ctx.biomes[at.biome]!;
          if (at.height < ctx.def.seaLevel && biome.liquid === liquid) water = true;
          if (topBlockAt(ctx, x + dx, z + dz, at.height, biome) === GRAVEL) gravel = true;
        }
      }
      expect([seed, water, gravel]).toEqual([seed, true, true]);
    }
  });

  it('is free to stand on: solid ground, no trunk, boulder or canopy at the feet or head', () => {
    // Seeds 1–300 and three more whose spawn stood in a feature before the search checked it.
    const seeds = [
      ...Array.from({ length: 300 }, (_, i) => String(i + 1)),
      ...['667', '852', 'bfmhs8'],
    ];
    const blocked: string[] = [];
    for (const seed of seeds) {
      const ctx = createGenContext(seed, registry);
      const spawn = findSpawn(ctx);
      const x = Math.floor(spawn.x);
      const z = Math.floor(spawn.z);
      const column = generate(ctx, x >> 5, z >> 5);
      const solid = (y: number) => isSolid(blockIn(column, x & 31, y, z & 31));
      if (!solid(spawn.y - 1) || solid(spawn.y) || solid(spawn.y + 1)) blocked.push(seed);
    }
    expect(blocked).toEqual([]);
  }, 120_000);

  it('has gravel and water really generated nearby', () => {
    for (const seed of ['1', '7', '42']) {
      const ctx = createGenContext(seed, registry);
      const spawn = findSpawn(ctx);
      const x = Math.floor(spawn.x);
      const z = Math.floor(spawn.z);
      const liquid = ctx.biomes[pointInfo(ctx, x, z).biome]!.liquid;
      const columns = new Map<string, ReturnType<typeof generate>>();
      const at = (bx: number, y: number, bz: number) => {
        const key = `${bx >> 5},${bz >> 5}`;
        let column = columns.get(key);
        if (!column) {
          column = generate(ctx, bx >> 5, bz >> 5);
          columns.set(key, column);
        }
        return blockIn(column, bx & 31, y, bz & 31);
      };
      let water = false;
      let gravel = false;
      for (let dz = -40; dz <= 40 && !(water && gravel); dz++) {
        for (let dx = -40; dx <= 40; dx++) {
          if (dx * dx + dz * dz > 1600) continue;
          for (let y = ctx.def.seaLevel - 4; y <= ctx.def.seaLevel + 2; y++) {
            const state = at(x + dx, y, z + dz);
            if (state === liquid) water = true;
            if (state === GRAVEL) gravel = true;
          }
        }
      }
      expect([seed, water, gravel]).toEqual([seed, true, true]);
    }
  });
});
