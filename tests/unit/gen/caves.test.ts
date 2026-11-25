import { describe, expect, it } from 'vitest';
import { SHAPE_LIQUID } from '../../../src/content/registry.ts';
import { localIndex } from '../../../src/world/coords.ts';
import { caveAt, tunnelsAt } from '../../../src/world/gen/caves.ts';
import { createGenContext } from '../../../src/world/gen/generateColumn.ts';
import { heightAt, LatticeCache } from '../../../src/world/gen/sample.ts';
import { generate } from '../../helpers/gen.ts';
import { registry } from '../../helpers/registry.ts';

/*
 * Caves of plan v2 (docs « M16 »): many openings on dry land, tunnel families that cross, large
 * halls, caves flooded under lake beds. The seal between liquids and dry caves is checked in
 * underground.test.ts.
 */

const SEEDS = ['1', '2', '3', '7', '11', '42', '99', 'cave', 'planet', 'colony'];
const air = registry.air;

/** A few columns of a seed, spread over its map. */
function columnsOf(seed: string) {
  const ctx = createGenContext(seed, registry);
  return {
    ctx,
    columns: [0, 1, 2, 3, 4, 5].map((i) => {
      const cx = i * 11 - 30;
      const cz = i * 7 - 20;
      return { cx, cz, column: generate(ctx, cx, cz) };
    }),
  };
}

/** Whether the 5×5×5 cube centred on a cell (2 blocks inside the column) is all air. */
function cube(
  at: (lx: number, y: number, lz: number) => number,
  lx: number,
  y: number,
  lz: number,
): boolean {
  for (let dy = -2; dy <= 2; dy++)
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) if (at(lx + dx, y + dy, lz + dz) !== air) return false;
  return true;
}

describe('caves of the planet', () => {
  it('opens between 1 % and 6 % of the dry land to the surface', () => {
    for (const seed of ['1', '7', '42']) {
      const ctx = createGenContext(seed, registry);
      const cache = new LatticeCache();
      let land = 0;
      let open = 0;
      for (let z = -1200; z < 1200; z += 11)
        for (let x = -1200; x < 1200; x += 11) {
          const h = heightAt(ctx, cache, x, z);
          if (h < ctx.def.seaLevel) continue;
          land++;
          if (caveAt(ctx, cache, x, h, z)) open++;
        }
      const share = open / land;
      expect(share, seed).toBeGreaterThanOrEqual(0.01);
      expect(share, seed).toBeLessThanOrEqual(0.06);
    }
  });

  it('crosses its tunnel families and opens halls on every one of 10 seeds', () => {
    for (const seed of SEEDS) {
      const { ctx, columns } = columnsOf(seed);
      let crossings = 0;
      let halls = 0;
      for (const { cx, cz, column } of columns) {
        const at = (lx: number, y: number, lz: number) =>
          column.sections[y >> 5]!.getBlock(localIndex(lx, y & 31, lz));
        for (let lz = 2; lz < 30; lz += 3)
          for (let lx = 2; lx < 30; lx += 3)
            for (let y = 6; y < 110; y += 2) {
              if (at(lx, y, lz) !== air) continue;
              if (tunnelsAt(ctx, cx * 32 + lx, y, cz * 32 + lz) === 3) crossings++;
              // A hall: a 5×5×5 cube of air.
              if (y >= 8 && cube(at, lx, y, lz)) halls++;
            }
      }
      expect(crossings, seed).toBeGreaterThan(0);
      expect(halls, seed).toBeGreaterThan(0);
    }
  });

  it('floods caves under lake beds on some seeds, within floodedDepth of the bed', () => {
    let flooded = 0;
    for (const seed of SEEDS) {
      const { ctx, columns } = columnsOf(seed);
      const cache = new LatticeCache();
      for (const { cx, cz, column } of columns)
        for (let cell = 0; cell < 1024; cell++) {
          const lx = cell & 31;
          const lz = cell >> 5;
          const h = heightAt(ctx, cache, cx * 32 + lx, cz * 32 + lz);
          for (let y = 1; y <= h; y++) {
            const state = column.sections[y >> 5]!.getBlock(localIndex(lx, y & 31, lz));
            // Water only: the lava under magmaBelowY is the deep caves' own fill.
            if (registry.tables.shape[state] !== SHAPE_LIQUID || state === ctx.magma) continue;
            expect(h).toBeLessThan(ctx.def.seaLevel);
            expect(y).toBeGreaterThan(h - ctx.caves.def.floodedDepth);
            flooded++;
          }
        }
    }
    expect(flooded).toBeGreaterThan(0);
  });
});
