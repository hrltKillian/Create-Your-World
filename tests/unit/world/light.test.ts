import { describe, expect, it } from 'vitest';
import { WorldJobs } from '../../../src/workers/worldJobs.ts';
import { columnKey, WORLD_HEIGHT } from '../../../src/world/coords.ts';
import { createGenContext, generateColumn } from '../../../src/world/gen/generateColumn.ts';
import { LightEngine } from '../../../src/world/light/LightEngine.ts';
import { FULL_SKY, skyOf } from '../../../src/world/light.ts';
import { VoxelWorld } from '../../../src/world/VoxelWorld.ts';
import {
  addLit,
  block,
  edit,
  lightErrors,
  litWorld,
  mismatches,
  referenceLight,
  STONE,
  sky,
  stoneBelow,
} from '../../helpers/lightWorld.ts';
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

  it('keeps the full sky above the world over the top layer (y 255) through edits', () => {
    const top = WORLD_HEIGHT - 1;
    const { world, light } = litWorld(1, (w) => stoneBelow(w, 4));
    // One block: the cells below it are lit from the side; full sky again once it is removed.
    edit(world, light, 40, top, 40, STONE);
    expect(sky(world, 40, top - 1, 40)).toBe(14);
    expect(lightErrors(world, 0, 0)).toEqual([]);
    edit(world, light, 40, top, 40, AIR);
    expect(sky(world, 40, top, 40)).toBe(15);
    expect(sky(world, 40, 128, 40)).toBe(15);
    expect(lightErrors(world, 0, 0)).toEqual([]);
    // A 5×5 platform across the x = 32 border: 12 under its centre, 15 down the shaft once removed.
    const platform = (state: number) => {
      for (let x = 30; x <= 34; x++)
        for (let z = 30; z <= 34; z++) edit(world, light, x, top, z, state);
    };
    platform(STONE);
    expect(sky(world, 32, top - 1, 32)).toBe(12);
    expect(lightErrors(world, 0, 0)).toEqual([]);
    platform(AIR);
    for (let y = top; y >= 128; y--) expect(sky(world, 32, y, 32)).toBe(15);
    expect(lightErrors(world, 0, 0)).toEqual([]);
  });

  it('gives a top cell the sky above the world back when its cap is opened (sealed shaft)', () => {
    const top = WORLD_HEIGHT - 1;
    // Solid stone with an open top layer, a 3×3 stone cap at y 255 and a sealed shaft under it.
    const { world, light } = litWorld(1, (w) => {
      stoneBelow(w, 8);
      box(w, -32, top, -32, 63, top, 63, AIR);
      box(w, 39, top, 39, 41, top, 41, STONE);
      box(w, 40, 200, 40, 40, top - 1, 40, AIR);
    });
    expect(sky(world, 40, top - 1, 40)).toBe(0);
    // No neighbour of the opened cell is lit: only the sky above the world can light it.
    edit(world, light, 40, top, 40, AIR);
    expect(sky(world, 40, top, 40)).toBe(15);
    for (let y = top - 1; y >= 200; y--) expect(sky(world, 40, y, 40)).toBe(15);
    expect(sky(world, 40, 199, 40)).toBe(0);
    expect(lightErrors(world, 0, 0)).toEqual([]);
  });

  it('lights a top glass cell from the sky above again when its only lit neighbour closes', () => {
    const top = WORLD_HEIGHT - 1;
    // Glass at y 255 in a stone ring open on +x only, over a sealed air pocket.
    const { world, light } = litWorld(1, (w) => {
      stoneBelow(w, 8);
      box(w, -32, top, -32, 63, top, 63, AIR);
      box(w, 39, top, 39, 41, top, 41, STONE);
      w.setBlock(40, top, 40, GLASS);
      w.setBlock(41, top, 40, AIR);
      w.setBlock(40, top - 1, 40, AIR);
    });
    expect(sky(world, 40, top, 40)).toBe(13);
    expect(sky(world, 40, top - 1, 40)).toBe(12);
    // The removal clears the glass (13 < 15), which then gets its own 13 back from the sky above.
    edit(world, light, 41, top, 40, STONE);
    expect(sky(world, 40, top, 40)).toBe(13);
    expect(sky(world, 40, top - 1, 40)).toBe(12);
    expect(lightErrors(world, 0, 0)).toEqual([]);
  });

  it('lights a closed top layer through its filter, generated or edited', () => {
    const top = WORLD_HEIGHT - 1;
    const { world, light } = litWorld(1, (w) => {
      stoneBelow(w, 4);
      box(w, -32, top, -32, 63, top, 63, GLASS);
    });
    // Full sky through glass gives 13, then 1 less per block down.
    expect(sky(world, 16, top, 16)).toBe(13);
    expect(sky(world, 40, top - 5, 16)).toBe(8);
    expect(lightErrors(world, 0, 0)).toEqual([]);
    edit(world, light, 16, top, 16, AIR);
    expect(sky(world, 16, 128, 16)).toBe(15);
    edit(world, light, 16, top, 16, GLASS);
    expect(sky(world, 16, top, 16)).toBe(13);
    expect(lightErrors(world, 0, 0)).toEqual([]);
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
    expect(mismatches(world, reference, 0, 0, notBrighter)).toEqual([]);
    expect(light.seamBacklog()).toBeGreaterThan(0);
    light.stitch(Number.POSITIVE_INFINITY);
    expect(mismatches(world, reference)).toEqual([]);
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
    expect(mismatches(sliced, referenceLight(whole, 0, 0))).toEqual([]);
  });

  it('takes out the light that came through a column when it goes, and stitches it back the same', () => {
    const world = terrain2x2();
    const light = new LightEngine(registry.tables);
    for (const column of world.columns.values()) addLit(light, column);
    light.stitch(Number.POSITIVE_INFINITY);
    const full = referenceLight(world, 0, 0);
    const gone = world.getColumn(0, 0)!;
    world.columns.delete(columnKey(0, 0));
    light.removeColumn(0, 0);
    light.flush();
    // The others are lit as if the unloaded column were rock, so nothing stale floods back.
    expect(mismatches(world, referenceLight(world, 0, 0))).toEqual([]);
    world.columns.set(columnKey(0, 0), gone);
    addLit(light, gone);
    light.stitch(Number.POSITIVE_INFINITY);
    expect(mismatches(world, full)).toEqual([]);
  });

  it('keeps a neighbour top glass lit from the sky above when a column goes', () => {
    const top = WORLD_HEIGHT - 1;
    // A lone glass cell in the stone top layer of column 1, next to the open top of column 0: it
    // gets 13 from either, and only the sky above the world can light it once column 0 goes.
    const { world, light } = litWorld(1, (w) => {
      stoneBelow(w, 8);
      box(w, -32, top, -32, 31, top, 63, AIR);
      w.setBlock(32, top, 16, GLASS);
    });
    expect(sky(world, 32, top, 16)).toBe(13);
    world.columns.delete(columnKey(0, 0));
    light.removeColumn(0, 0);
    light.flush();
    expect(sky(world, 32, top, 16)).toBe(13);
    expect(lightErrors(world, 0, 0)).toEqual([]);
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
    // Magma lights the deep caves (block light), but no sky light reaches the bottom section.
    const bottom = result.sections[0]!;
    const deep = bottom.light ?? [bottom.uniformLight];
    expect(Array.from(deep).every((packed) => skyOf(packed) === 0)).toBe(true);
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
