import { describe, expect, it } from 'vitest';
import { WorldJobs } from '../../../src/workers/worldJobs.ts';
import { WORLD_HEIGHT } from '../../../src/world/coords.ts';
import { createGenContext, generateColumn } from '../../../src/world/gen/generateColumn.ts';
import { LightEngine } from '../../../src/world/light/LightEngine.ts';
import { FULL_SKY } from '../../../src/world/light.ts';
import { VoxelWorld } from '../../../src/world/VoxelWorld.ts';
import { addLit, block, edit, litWorld, STONE, sky, stoneBelow } from '../../helpers/lightWorld.ts';
import { registry } from '../../helpers/registry.ts';

const AIR = registry.air;
const TORCH = registry.defaultState('block:torch');
const FOLIAGE = registry.defaultState('block:foliage');
const GLASS = registry.defaultState('block:glass');
const WATER = registry.defaultState('block:fresh_water');
const GATE = registry.defaultState('block:gate');

/** Every cell of a box set to one state. */
function box(
  world: VoxelWorld,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  state: number,
): void {
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) world.setBlock(x, y, z, state);
}

describe('light rules', () => {
  it('a torch gives 14 − distance in a sealed cavity, across a column border, and 0 once removed', () => {
    // Stone up to y 127, with a sealed cavity across the x = 32 border.
    const { world, light } = litWorld(1, (w) => {
      stoneBelow(w, 4);
      box(w, 24, 60, 0, 40, 64, 8, AIR);
    });
    for (let x = 24; x <= 40; x++) expect(sky(world, x, 62, 4)).toBe(0);
    edit(world, light, 31, 60, 4, TORCH);
    expect(block(world, 31, 60, 4)).toBe(14);
    for (let d = 1; d <= 9; d++) expect(block(world, 31 + d, 60, 4)).toBe(14 - d);
    for (let d = 1; d <= 7; d++) expect(block(world, 31 - d, 60, 4)).toBe(14 - d);
    expect(block(world, 32, 61, 5)).toBe(11); // 3 blocks away diagonally (Manhattan)
    expect(block(world, 31, 60, 8)).toBe(10);
    expect(block(world, 31, 65, 4)).toBe(0); // the stone ceiling
    // The engine reports the changed box, deep into the neighbour column.
    expect(light.changed.x1).toBe(40);
    expect(light.changed.x0).toBe(24);
    edit(world, light, 31, 60, 4, AIR);
    for (let x = 24; x <= 40; x++)
      for (let y = 60; y <= 64; y++)
        for (let z = 0; z <= 8; z++) expect(world.getLight(x, y, z)).toBe(0);
  });

  it('lights the ground under an overhang from the side (14 under its edge), across a seam', () => {
    // Floor at y 63, a stone roof at y 70 over x 24…32 (one block into column 1).
    const { world } = litWorld(1, (w) => {
      stoneBelow(w, 2);
      box(w, 24, 70, -8, 32, 70, 8, STONE);
    });
    expect(sky(world, 32, 69, 0)).toBe(14);
    expect(sky(world, 24, 64, 0)).toBe(14);
    expect(sky(world, 31, 64, 0)).toBe(13); // lit from x 33, in the next column
    expect(sky(world, 28, 64, 0)).toBe(10);
    expect(sky(world, 28, 71, 0)).toBe(15);
  });

  it('keeps 15 down a 1-wide shaft, dug or generated, and darkens it when capped', () => {
    const { world, light } = litWorld(1, (w) => {
      stoneBelow(w, 4);
      box(w, 5, 10, 5, 5, 127, 5, AIR);
    });
    expect(sky(world, 5, 10, 5)).toBe(15);
    expect(sky(world, 5, 9, 5)).toBe(0);
    for (let y = 127; y >= 100; y--) edit(world, light, 40, y, 40, AIR);
    expect(sky(world, 40, 100, 40)).toBe(15);
    edit(world, light, 40, 127, 40, STONE);
    expect(sky(world, 40, 126, 40)).toBe(0);
    expect(sky(world, 40, 100, 40)).toBe(0);
    edit(world, light, 40, 127, 40, AIR);
    expect(sky(world, 40, 100, 40)).toBe(15);
  });

  it('filters 1 per foliage or glass block and 2 per water block', () => {
    expect(registry.tables.lightFilter[FOLIAGE]).toBe(1);
    expect(registry.tables.lightFilter[GLASS]).toBe(1);
    expect(registry.tables.lightFilter[WATER]).toBe(2);
    const { world, light } = litWorld(1, (w) => {
      stoneBelow(w, 4);
      box(w, 5, 100, 5, 5, 127, 5, AIR);
      w.setBlock(5, 127, 5, FOLIAGE);
    });
    // A step into the foliage costs 1 + 1; below it, 1 per block.
    expect(sky(world, 5, 127, 5)).toBe(13);
    expect(sky(world, 5, 126, 5)).toBe(12);
    expect(sky(world, 5, 120, 5)).toBe(6);
    edit(world, light, 5, 127, 5, GLASS);
    expect(sky(world, 5, 126, 5)).toBe(12);
    edit(world, light, 5, 127, 5, WATER);
    expect(sky(world, 5, 127, 5)).toBe(12);
    edit(world, light, 5, 127, 5, AIR);
    expect(sky(world, 5, 100, 5)).toBe(15);
  });

  it('a closed gate blocks light, an open one lets it through', () => {
    // A sealed room (x 0…4) with a doorway at x 5 onto an open shaft at x 6.
    const lower = registry.withState(GATE, 'half', 'lower');
    const upper = registry.withState(GATE, 'half', 'upper');
    const open = (state: number, value: string) => registry.withState(state, 'open', value);
    const { world, light } = litWorld(1, (w) => {
      stoneBelow(w, 4);
      box(w, 0, 100, 0, 4, 103, 4, AIR);
      box(w, 6, 100, 2, 6, 127, 2, AIR);
      w.setBlock(5, 100, 2, lower);
      w.setBlock(5, 101, 2, upper);
    });
    expect(sky(world, 6, 100, 2)).toBe(15);
    expect(sky(world, 4, 100, 2)).toBe(0);
    edit(world, light, 5, 100, 2, open(lower, '1'));
    edit(world, light, 5, 101, 2, open(upper, '1'));
    expect(sky(world, 5, 100, 2)).toBe(14);
    expect(sky(world, 4, 101, 2)).toBe(13);
    expect(sky(world, 0, 100, 0)).toBe(7);
    edit(world, light, 5, 100, 2, lower);
    edit(world, light, 5, 101, 2, upper);
    for (let x = 0; x <= 4; x++) expect(sky(world, x, 100, 2)).toBe(0);
  });
});

/**
 * Reference light of a 64×256×64 box of loaded blocks (outside counts as opaque): one flat-array
 * flood with the rules written out again, independent of the engine.
 */
function referenceLight(world: VoxelWorld, x0: number, z0: number): Uint8Array {
  const W = 64;
  const n = W * W * WORLD_HEIGHT;
  const filter = new Uint8Array(n);
  const levels = [new Uint8Array(n), new Uint8Array(n)]; // sky, block
  const queues: number[][] = [[], []];
  for (let y = 0; y < WORLD_HEIGHT; y++)
    for (let z = 0; z < W; z++)
      for (let x = 0; x < W; x++) {
        const i = x + z * W + y * W * W;
        const state = world.getBlock(x0 + x, y, z0 + z);
        filter[i] = registry.tables.lightFilter[state]!;
        const emit = registry.tables.emit[state]!;
        if (emit > 0) {
          levels[1]![i] = emit;
          queues[1]!.push(i);
        }
      }
  for (let z = 0; z < W; z++)
    for (let x = 0; x < W; x++)
      for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
        const i = x + z * W + y * W * W;
        if (filter[i] !== 0) break;
        levels[0]![i] = 15;
        queues[0]!.push(i);
      }
  for (let channel = 0; channel < 2; channel++) {
    const level = levels[channel]!;
    const queue = queues[channel]!;
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]!;
      const x = i % W;
      const z = Math.floor(i / W) % W;
      const y = Math.floor(i / (W * W));
      const offer = (j: number, down: boolean) => {
        const next =
          channel === 0 && down && level[i] === 15 && filter[j] === 0
            ? 15
            : level[i]! - 1 - filter[j]!;
        if (next > level[j]!) {
          level[j] = next;
          queue.push(j);
        }
      };
      if (x > 0) offer(i - 1, false);
      if (x < W - 1) offer(i + 1, false);
      if (z > 0) offer(i - W, false);
      if (z < W - 1) offer(i + W, false);
      if (y > 0) offer(i - W * W, true);
      if (y < WORLD_HEIGHT - 1) offer(i + W * W, false);
    }
  }
  const packed = new Uint8Array(n);
  for (let i = 0; i < n; i++) packed[i] = (levels[0]![i]! << 4) | levels[1]![i]!;
  return packed;
}

/** Cells (up to 5) where `compare(world light, reference)` fails, as readable strings. */
function mismatches(
  world: VoxelWorld,
  reference: Uint8Array,
  compare: (actual: number, expected: number) => boolean,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < reference.length && out.length < 5; i++) {
    const x = i % 64;
    const z = Math.floor(i / 64) % 64;
    const y = Math.floor(i / 4096);
    const actual = world.getLight(x, y, z);
    if (!compare(actual, reference[i]!)) out.push(`${x},${y},${z}: ${actual} vs ${reference[i]}`);
  }
  return out;
}

const ctx = createGenContext('light-2x2', registry);

/** Terrain of columns [0, 1]², with a roof, foliage, glass, a cavity and torches across seams. */
function terrain2x2(): VoxelWorld {
  const world = new VoxelWorld(AIR, registry.unknownBlock);
  let top = 0;
  for (let cx = 0; cx <= 1; cx++)
    for (let cz = 0; cz <= 1; cz++) {
      const column = world.ensureColumn(cx, cz);
      generateColumn(ctx, column);
      for (const h of column.heightmap) top = Math.max(top, h);
    }
  const roof = Math.min(top + 8, 240);
  box(world, 20, roof, 20, 44, roof, 44, STONE);
  box(world, 30, roof, 24, 34, roof, 26, FOLIAGE);
  box(world, 24, roof, 33, 26, roof, 35, GLASS);
  world.setBlock(31, roof - 3, 31, TORCH);
  world.setBlock(40, roof - 1, 33, TORCH);
  box(world, 28, 30, 10, 36, 34, 14, AIR);
  world.setBlock(33, 30, 12, TORCH);
  return world;
}

describe('seams', () => {
  it('a stitched 2×2 group equals one flood over the whole group, never darker before', () => {
    const world = terrain2x2();
    const reference = referenceLight(world, 0, 0);
    const light = new LightEngine(registry.tables);
    for (const column of world.columns.values()) addLit(light, column);
    // Each column alone is never brighter than the truth, in either channel.
    const notBrighter = (a: number, e: number) => a >> 4 <= e >> 4 && (a & 15) <= (e & 15);
    expect(mismatches(world, reference, notBrighter)).toEqual([]);
    expect(light.seamBacklog()).toBeGreaterThan(0);
    light.stitch(Number.POSITIVE_INFINITY);
    expect(mismatches(world, reference, (a, e) => a === e)).toEqual([]);
    for (const column of world.columns.values())
      expect(light.stitched(column.cx, column.cz)).toBe(false); // outer seams have no neighbour
  });

  it('gives the same light when the work is sliced by a small budget and columns come in another order', () => {
    const whole = terrain2x2();
    const one = new LightEngine(registry.tables);
    for (const column of whole.columns.values()) addLit(one, column);
    one.stitch(Number.POSITIVE_INFINITY);

    const sliced = terrain2x2();
    const many = new LightEngine(registry.tables);
    let slices = 0;
    for (const column of [...sliced.columns.values()].reverse()) {
      addLit(many, column);
      many.stitch(37);
      slices++;
    }
    while (many.seamBacklog() > 0) {
      expect(many.stitch(37)).toBeLessThanOrEqual(37);
      slices++;
    }
    expect(slices).toBeGreaterThan(10);
    expect(mismatches(sliced, referenceLight(whole, 0, 0), (a, e) => a === e)).toEqual([]);
  });
});

describe('generation light', () => {
  it('comes with the generated column: open sky above, darkness deep below', () => {
    const jobs = new WorldJobs(registry);
    const result = jobs.gen({
      kind: 'gen',
      seed: 'light-gen',
      worldType: 'default',
      cx: 3,
      cz: -2,
    });
    const top = result.sections[7]!;
    expect(top.light).toBeNull();
    expect(top.uniformLight).toBe(FULL_SKY);
    const bottom = result.sections[0]!;
    expect(bottom.light).toBeNull();
    expect(bottom.uniformLight).toBe(0);
    expect(result.sections.some((s) => s.light !== null)).toBe(true);
  });

  it('lights the flat world: 15 above the grass, 0 in the ground', () => {
    const jobs = new WorldJobs(registry);
    const result = jobs.gen({ kind: 'gen', seed: 'light-flat', worldType: 'flat', cx: 0, cz: 0 });
    const surface = result.sections[2]!; // y 64…95, grass at y 64
    expect(surface.light![1 << 10]).toBe(FULL_SKY); // y 65
    expect(surface.light![0]).toBe(0);
    expect(result.sections[1]!.uniformLight).toBe(0);
  });
});
