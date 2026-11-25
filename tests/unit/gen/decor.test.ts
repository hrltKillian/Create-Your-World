import { describe, expect, it } from 'vitest';
import { FLAG_OPAQUE, FLAG_SOLID, SHAPE_LIQUID } from '../../../src/content/registry.ts';
import { bankAt } from '../../../src/world/gen/banks.ts';
import { caveAt } from '../../../src/world/gen/caves.ts';
import { columnHash, createGenContext } from '../../../src/world/gen/generateColumn.ts';
import { heightAt, LatticeCache } from '../../../src/world/gen/sample.ts';
import { biomeIndex, blockIn, findColumn, generate } from '../../helpers/gen.ts';
import { registry } from '../../helpers/registry.ts';

const ctx = createGenContext('decor', registry);
const state = (key: `block:${string}`) => registry.defaultState(key);

/** The 3×3 columns around the first column whose centre lies in a biome. */
function groupIn(biome: string) {
  const { cx, cz } = findColumn(ctx, (info) => info.biome === biomeIndex(ctx, biome));
  const coords: [number, number][] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) coords.push([cx + dx, cz + dz]);
  return coords;
}

describe('decoration', () => {
  it('stands every trunk, stem and column on itself or on solid ground', () => {
    const trunks = new Map(
      (
        [
          ['block:broadleaf_log', 'biome:forest'],
          ['block:conifer_log', 'biome:tundra'],
          ['block:mushroom_stem', 'biome:fungal_marsh'],
          ['block:palmthorn', 'biome:ochre_desert'],
        ] as const
      ).map(([block, biome]) => [state(block), { biome, count: 0 }]),
    );
    const ground = FLAG_SOLID | FLAG_OPAQUE;
    for (const [trunk, entry] of trunks) {
      for (const [cx, cz] of groupIn(entry.biome)) {
        const column = generate(ctx, cx, cz);
        for (let cell = 0; cell < 1024; cell++) {
          const lx = cell & 31;
          const lz = cell >> 5;
          for (let y = 1; y < 256; y++) {
            if (blockIn(column, lx, y, lz) !== trunk) continue;
            const below = blockIn(column, lx, y - 1, lz);
            const flags = registry.tables.flags[below]!;
            expect(
              below === trunk || (flags & ground) === ground,
              `${cx} ${cz} ${lx} ${y} ${lz}`,
            ).toBe(true);
            entry.count++;
          }
        }
      }
      expect(entry.count, registry.states[trunk]!.key).toBeGreaterThan(0);
    }
  });

  it('does not depend on the generation order across a 3×3 group', () => {
    const coords = groupIn('biome:forest');
    const forward = coords.map(([cx, cz]) => columnHash(ctx, generate(ctx, cx, cz)));
    const fresh = createGenContext('decor', registry);
    const backward = [...coords]
      .reverse()
      .map(([cx, cz]) => columnHash(fresh, generate(fresh, cx, cz)));
    expect(backward.reverse()).toEqual(forward);
    // The centre alone, with nothing generated before it, matches too.
    const [cx, cz] = coords[4]!;
    const alone = createGenContext('decor', registry);
    expect(columnHash(alone, generate(alone, cx, cz))).toBe(forward[4]);
  });

  it('grows the features of each biome', () => {
    const expected: [string, `block:${string}`][] = [
      ['biome:fungal_marsh', 'block:glowcap'],
      ['biome:ochre_desert', 'block:thornbush'],
      ['biome:highlands', 'block:stone'],
      ['biome:forest', 'block:foliage'],
    ];
    const cache = new LatticeCache();
    for (const [biome, key] of expected) {
      const target = state(key);
      let above = 0;
      for (const [cx, cz] of groupIn(biome)) {
        const column = generate(ctx, cx, cz);
        for (let cell = 0; cell < 1024; cell++) {
          const lx = cell & 31;
          const lz = cell >> 5;
          const h = heightAt(ctx, cache, cx * 32 + lx, cz * 32 + lz);
          for (let y = h + 1; y < Math.min(256, h + 14); y++)
            if (blockIn(column, lx, y, lz) === target) above++;
        }
      }
      expect(above, `${key} in ${biome}`).toBeGreaterThan(0);
    }
  });

  it('puts plants on the bare biome surface only', () => {
    const plants = new Set(ctx.biomes.flatMap((b) => b.plants.map((p) => p.state)));
    let count = 0;
    for (const [cx, cz] of [...groupIn('biome:meadow'), ...groupIn('biome:fungal_marsh')]) {
      const column = generate(ctx, cx, cz);
      for (let cell = 0; cell < 1024; cell++) {
        const lx = cell & 31;
        const lz = cell >> 5;
        for (let y = 1; y < 255; y++) {
          const plant = blockIn(column, lx, y, lz);
          if (!plants.has(plant)) continue;
          const biome = ctx.biomes[column.biomes[cell]!]!;
          const below = blockIn(column, lx, y - 1, lz);
          // Patches (thornbush) may grow on another soil of their feature.
          if (biome.plants.some((p) => p.state === plant)) expect(below).toBe(biome.surface);
          count++;
        }
      }
    }
    expect(count).toBeGreaterThan(50);
  });

  it('lays gravel and clay banks along the shores, where bankAt says', () => {
    const cache = new LatticeCache();
    const seen = new Set<number>();
    const { cx, cz } = findColumn(ctx, (info) => Math.abs(info.height - ctx.def.seaLevel) <= 1, 1);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const column = generate(ctx, cx + dx, cz + dz);
        for (let cell = 0; cell < 1024; cell++) {
          const x = (cx + dx) * 32 + (cell & 31);
          const z = (cz + dz) * 32 + (cell >> 5);
          const h = heightAt(ctx, cache, x, z);
          const bank = bankAt(ctx, x, z, h);
          // A cave (dry, or flooded under a lake bed) may open the bank cell.
          const there = blockIn(column, cell & 31, h, cell >> 5);
          if (
            bank < 0 ||
            caveAt(ctx, cache, x, h, z) ||
            registry.tables.shape[there] === SHAPE_LIQUID
          )
            continue;
          expect(blockIn(column, cell & 31, h, cell >> 5)).toBe(bank);
          seen.add(bank);
        }
      }
    }
    expect(seen.has(state('block:gravel'))).toBe(true);
    expect(seen.has(state('block:clay'))).toBe(true);
  });
});
