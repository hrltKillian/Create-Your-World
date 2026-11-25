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

/** The 3×3 columns around the first column whose centre lies on dry land of a biome. */
function groupIn(biome: string) {
  const { cx, cz } = findColumn(
    ctx,
    (info) => info.biome === biomeIndex(ctx, biome) && info.height > ctx.def.seaLevel,
  );
  const coords: [number, number][] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) coords.push([cx + dx, cz + dz]);
  return coords;
}

describe('decoration', () => {
  it('grows every species of each biome, trunks standing on themselves or on ground', () => {
    const ground = FLAG_SOLID | FLAG_OPAQUE;
    for (const biome of ctx.biomes) {
      // Giants are rare: their own test looks farther.
      const grown = biome.features.filter(
        (f) => f.feature.trunk === 1 && f.feature.kind !== 'patch',
      );
      const counts = new Map<number, number>();
      for (const [cx, cz] of groupIn(biome.def.key)) {
        const column = generate(ctx, cx, cz);
        for (let cell = 0; cell < 1024; cell++) {
          const lx = cell & 31;
          const lz = cell >> 5;
          for (let y = 1; y < 256; y++) {
            const block = blockIn(column, lx, y, lz);
            counts.set(block, (counts.get(block) ?? 0) + 1);
            if (!grown.some((f) => f.feature.block === block && f.feature.kind !== 'boulder'))
              continue;
            const below = blockIn(column, lx, y - 1, lz);
            const flags = registry.tables.flags[below]!;
            expect(below === block || (flags & ground) === ground, `${cx} ${cz} ${lx} ${y}`).toBe(
              true,
            );
          }
        }
      }
      for (const { feature } of grown)
        for (const block of [feature.block, feature.crown].filter((b) => b >= 0))
          expect(
            counts.get(block) ?? 0,
            `${registry.states[block]!.key} in ${biome.def.key}`,
          ).toBeGreaterThan(0);
      // Every plant of the biome too (plan v3 « M23 »: 3 or more, one useful).
      expect(biome.plants.length, biome.def.key).toBeGreaterThanOrEqual(2);
      for (const plant of biome.plants)
        expect(
          counts.get(plant.state) ?? 0,
          `${registry.states[plant.state]!.key} in ${biome.def.key}`,
        ).toBeGreaterThan(0);
    }
  });

  it('grows the rare giants, their 2×2 trunks standing on ground', () => {
    for (const biome of ctx.biomes) {
      for (const { feature } of biome.features.filter((f) => f.feature.trunk === 2)) {
        const { cx, cz } = findColumn(ctx, (info) => info.biome === biomeIndex(ctx, biome.def.key));
        let tall = 0;
        for (let dz = -5; dz <= 5 && tall === 0; dz++)
          for (let dx = -5; dx <= 5 && tall === 0; dx++) {
            const column = generate(ctx, cx + dx, cz + dz);
            for (let cell = 0; cell < 1024 && tall === 0; cell++) {
              const lx = cell & 31;
              const lz = cell >> 5;
              if (lx === 31 || lz === 31) continue;
              let run = 0;
              for (let y = 1; y < 256; y++) {
                const quad =
                  blockIn(column, lx, y, lz) === feature.block &&
                  blockIn(column, lx + 1, y, lz) === feature.block &&
                  blockIn(column, lx, y, lz + 1) === feature.block &&
                  blockIn(column, lx + 1, y, lz + 1) === feature.block;
                run = quad ? run + 1 : 0;
                if (run >= feature.size0) tall = run;
              }
            }
          }
        expect(
          tall,
          `a giant of ${registry.states[feature.block]!.key} in ${biome.def.key}`,
        ).toBeGreaterThanOrEqual(feature.size0);
      }
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
