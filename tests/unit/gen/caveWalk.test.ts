import { describe, expect, it } from 'vitest';
import { FLAG_SOLID } from '../../../src/content/registry.ts';
import { hashUnit } from '../../../src/core/hash.ts';
import type { Column } from '../../../src/world/Column.ts';
import { caveAt } from '../../../src/world/gen/caves.ts';
import { createGenContext, type GenContext } from '../../../src/world/gen/generateColumn.ts';
import { heightAt, LatticeCache } from '../../../src/world/gen/sample.ts';
import { blockIn, generate } from '../../helpers/gen.ts';
import { registry } from '../../helpers/registry.ts';

/*
 * Caves a player can visit (plan v3 « M24 »): tunnels wide enough to walk in, and from nearly every
 * point of dry land an entrance within 96 blocks where a walk (one block up, three down at most,
 * two blocks of headroom) reaches at least 200 cells under the ground, without digging.
 */

/** Points of dry land sampled per seed, and the seeds. */
const POINTS = 12;
const SEEDS = ['a', 'b', 'c'];
const RADIUS = 96;
/** Cells under the ground the walk must reach. */
const DEEP = 200;

/** A world's blocks, its columns generated on demand. */
function blocks(ctx: GenContext) {
  const columns = new Map<string, Column>();
  const block = (x: number, y: number, z: number) => {
    const cx = Math.floor(x / 32);
    const cz = Math.floor(z / 32);
    const key = `${cx},${cz}`;
    let column = columns.get(key);
    if (!column) {
      column = generate(ctx, cx, cz);
      columns.set(key, column);
    }
    return blockIn(column, x - cx * 32, y, z - cz * 32);
  };
  const solid = (x: number, y: number, z: number) =>
    (registry.tables.flags[block(x, y, z)]! & FLAG_SOLID) !== 0;
  return { block, solid };
}

/** Cells under the ground (3 or more blocks under the surface) a walk from (x, z) reaches. */
function walkUnder(ctx: GenContext, cache: LatticeCache, x: number, z: number): number {
  const { solid } = blocks(ctx);
  const fits = (fx: number, fy: number, fz: number) =>
    !solid(fx, fy, fz) && !solid(fx, fy + 1, fz) && solid(fx, fy - 1, fz);
  const h = heightAt(ctx, cache, x, z);
  let start = -1;
  for (let y = h + 1; y > h - 6 && start < 0; y--) if (fits(x, y, z)) start = y;
  if (start < 0) return 0;
  const seen = new Set([`${x},${start},${z}`]);
  const queue: [number, number, number][] = [[x, start, z]];
  let under = 0;
  while (queue.length > 0 && under < DEEP) {
    const [cx, cy, cz] = queue.shift()!;
    if (cy < heightAt(ctx, cache, cx, cz) - 3) under++;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      for (const dy of [1, 0, -1, -2, -3]) {
        const [nx, ny, nz] = [cx + dx, cy + dy, cz + dz];
        // Up: headroom over the start; down: the way down is clear.
        if (dy === 1 && solid(cx, cy + 2, cz)) continue;
        if (!fits(nx, ny, nz)) continue;
        let clear = true;
        for (let k = 0; k > dy; k--)
          if (solid(nx, cy + k, nz) || solid(nx, cy + k + 1, nz)) clear = false;
        if (!clear) continue;
        const key = `${nx},${ny},${nz}`;
        if (!seen.has(key)) {
          seen.add(key);
          queue.push([nx, ny, nz]);
        }
        break;
      }
    }
  }
  return under;
}

describe('caves to visit', () => {
  it('has tunnels a player walks in: 2 blocks of headroom, and mostly a 3×3 section', () => {
    const air = registry.air;
    let cells = 0;
    let headroom = 0;
    let wide = 0;
    for (const seed of SEEDS.slice(0, 2)) {
      const ctx = createGenContext(seed, registry);
      for (let cz = -1; cz <= 1; cz++)
        for (let cx = -1; cx <= 1; cx++) {
          const column = generate(ctx, cx, cz);
          const at = (x: number, y: number, z: number) =>
            x >= 0 && x < 32 && z >= 0 && z < 32 && blockIn(column, x, y, z) === air;
          const run = (lx: number, y: number, lz: number, dx: number, dy: number, dz: number) => {
            let n = 0;
            while (n < 8 && at(lx + (n + 1) * dx, y + (n + 1) * dy, lz + (n + 1) * dz)) n++;
            return n;
          };
          for (let lz = 3; lz < 29; lz += 2)
            for (let lx = 3; lx < 29; lx += 2)
              for (let y = 20; y < 140; y++) {
                if (!at(lx, y, lz) || run(lx, y, lz, 0, 1, 0) >= 8) continue;
                // A cave cell: rock somewhere above it.
                cells++;
                const tall = run(lx, y, lz, 0, 1, 0) + run(lx, y, lz, 0, -1, 0) + 1;
                const across = Math.min(
                  run(lx, y, lz, 1, 0, 0) + run(lx, y, lz, -1, 0, 0) + 1,
                  run(lx, y, lz, 0, 0, 1) + run(lx, y, lz, 0, 0, -1) + 1,
                );
                if (tall >= 2) headroom++;
                if (tall >= 3 && across >= 3) wide++;
              }
        }
    }
    expect(cells).toBeGreaterThan(500);
    expect(headroom / cells).toBeGreaterThanOrEqual(0.95);
    // The rest are the tips of the tunnels, where they close.
    expect(wide / cells).toBeGreaterThanOrEqual(0.75);
  });

  it(`opens a walkable entrance within ${RADIUS} blocks of 90 % of the dry land`, () => {
    let points = 0;
    let reached = 0;
    for (const seed of SEEDS) {
      const ctx = createGenContext(seed, registry);
      const cache = new LatticeCache();
      for (let i = 0; i < POINTS; i++) {
        const px = Math.floor((hashUnit(7, i, 1, 0) - 0.5) * 4000);
        const pz = Math.floor((hashUnit(7, i, 2, 0) - 0.5) * 4000);
        if (heightAt(ctx, cache, px, pz) < ctx.def.seaLevel) continue;
        points++;
        let found = false;
        for (let r = 0; r <= RADIUS && !found; r += 4)
          for (let dz = -r; dz <= r && !found; dz += 4)
            for (let dx = -r; dx <= r && !found; dx += 4) {
              if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
              const [x, z] = [px + dx, pz + dz];
              const h = heightAt(ctx, cache, x, z);
              if (h < ctx.def.seaLevel || !caveAt(ctx, cache, x, h, z)) continue;
              found = walkUnder(ctx, cache, x, z) >= DEEP;
            }
        if (found) reached++;
      }
    }
    expect(points).toBeGreaterThanOrEqual(20);
    expect(reached / points).toBeGreaterThanOrEqual(0.9);
  });
});
