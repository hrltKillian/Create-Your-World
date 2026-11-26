import { describe, expect, it } from 'vitest';
import { BY_WORLD, removeBlock } from '../../../src/sim/blockRemoval.ts';
import { noteChanged } from '../../../src/sim/blockUpdates.ts';
import type { SimEvent } from '../../../src/sim/events.ts';
import { liquidTables, noteLiquids, updateLiquid } from '../../../src/sim/liquids.ts';
import { simulated } from '../../../src/sim/stations.ts';
import { columnKey, SECTION_SIZE } from '../../../src/world/coords.ts';
import { eventsOf, playerTestSim } from '../../helpers/simHarness.ts';

/*
 * Flowing liquids (docs plan v2 « M15 — L'eau »): the reference game's rules on the flat world
 * (grass at y 64, so a liquid on the ground is at y 65).
 */

const WATER = 'block:fresh_water';
const FOUL = 'block:foul_water';
const source = (key: string) => `${key}[level=0,falling=0]`;
const level = (key: string, n: number) => `${key}[level=${n},falling=0]`;
const falling = (key: string) => `${key}[level=1,falling=1]`;
const AIR = 'block:air';

/** A flat world with a source poured at a cell (its update scheduled like a player's change). */
function poured(seed: string, x: number, y: number, z: number, key = WATER) {
  const s = playerTestSim({ seed });
  s.put(x, y, z, source(key));
  noteLiquids(s.sim, x, y, z);
  s.events.length = 0;
  return s;
}

/** Enough ticks for a flow of `steps` blocks. */
function settleTicks(s: ReturnType<typeof poured>, steps: number): number {
  const delay = Math.max(...liquidTables(s.sim.registry).kinds.map((kind) => kind?.delay ?? 0));
  return delay * (steps + 2);
}

describe('flowing liquids', () => {
  it('spreads a source on flat ground into a diamond seven levels wide', () => {
    const s = poured('flow-diamond', 0, 65, 0);
    s.step(settleTicks(s, 9));
    for (let dz = -9; dz <= 9; dz++)
      for (let dx = -9; dx <= 9; dx++) {
        const d = Math.abs(dx) + Math.abs(dz);
        const expected = d === 0 ? source(WATER) : d <= 7 ? level(WATER, d) : AIR;
        expect(s.block(dx, 65, dz), `(${dx}, ${dz})`).toBe(expected);
      }
    expect(s.sim.blockUpdates.size).toBe(0);
  });

  it('flows only towards the nearest drop, then falls into it', () => {
    const s = poured('flow-hole', 0, 65, 0);
    s.put(2, 64, 0, AIR);
    noteLiquids(s.sim, 0, 65, 0);
    s.step(settleTicks(s, 6));
    expect(s.block(1, 65, 0)).toBe(level(WATER, 1));
    expect(s.block(2, 65, 0)).toBe(level(WATER, 2));
    expect(s.block(2, 64, 0)).toBe(falling(WATER));
    for (const [x, z] of [
      [-1, 0],
      [0, 1],
      [0, -1],
      [3, 0],
    ] as const)
      expect(s.block(x, 65, z), `(${x}, ${z})`).toBe(AIR);
  });

  it('makes a new source between two sources of fresh water, never of foul water', () => {
    const fresh = poured('flow-infinite', 0, 65, 0);
    fresh.put(2, 65, 0, source(WATER));
    noteLiquids(fresh.sim, 2, 65, 0);
    fresh.step(settleTicks(fresh, 2));
    expect(fresh.block(1, 65, 0)).toBe(source(WATER));
    const foul = poured('flow-finite', 0, 65, 0, FOUL);
    foul.put(2, 65, 0, source(FOUL));
    noteLiquids(foul.sim, 2, 65, 0);
    foul.step(settleTicks(foul, 2));
    expect(foul.block(1, 65, 0)).toBe(level(FOUL, 1));
  });

  it('dries up once its source is gone', () => {
    const s = poured('flow-dry', 0, 65, 0);
    s.step(settleTicks(s, 9));
    removeBlock(s.sim, BY_WORLD, 0, 65, 0, false, s.events);
    s.step(settleTicks(s, 10));
    for (let dz = -8; dz <= 8; dz++)
      for (let dx = -8; dx <= 8; dx++) expect(s.block(dx, 65, dz), `(${dx}, ${dz})`).toBe(AIR);
    expect(s.sim.blockUpdates.size).toBe(0);
  });

  it('falls first, a source in the air spilling once around, then spreads where it lands', () => {
    const s = poured('flow-fall', 0, 70, 0);
    s.step(settleTicks(s, 14));
    for (let y = 65; y <= 69; y++) expect(s.block(0, y, 0), `y ${y}`).toBe(falling(WATER));
    // The source spills one block around (each a falling column), no farther.
    expect(s.block(1, 70, 0)).toBe(level(WATER, 1));
    expect(s.block(1, 69, 0)).toBe(falling(WATER));
    expect(s.block(2, 70, 0)).toBe(AIR);
    // A landed column holds 8: one thinner beside it, seven blocks out at most.
    expect(s.block(2, 65, 0)).toBe(level(WATER, 1));
    expect(s.block(8, 65, 0)).toBe(level(WATER, 7));
    expect(s.block(9, 65, 0)).toBe(AIR);
  });

  it('washes plants away with their drops', () => {
    const s = playerTestSim({ seed: 'flow-plant' });
    s.put(1, 65, 0, 'block:tall_grass');
    s.put(0, 65, 0, source(WATER));
    noteLiquids(s.sim, 0, 65, 0);
    s.events.length = 0;
    s.step(settleTicks(s, 2));
    expect(s.block(1, 65, 0)).toBe(level(WATER, 1));
    const washed = eventsOf(s.events, 'blockBroken').filter((e) => e.x === 1 && e.z === 0);
    expect(washed).toHaveLength(1);
    expect(washed[0]!.playerId).toBe(BY_WORLD);
  });

  it('takes a new course around a block placed in its way', () => {
    const s = poured('flow-block', 0, 65, 0);
    s.step(settleTicks(s, 9));
    s.put(1, 65, 0, 'block:fieldstone');
    noteChanged(s.sim, 1, 65, 0);
    s.step(settleTicks(s, 4));
    // (2, 0) is now fed from (2, ±1), three blocks from the source: one more.
    expect(s.block(2, 65, 0)).toBe(level(WATER, 4));
  });

  it('never flows into an unloaded column', () => {
    // Simulated columns always have loaded neighbours: one is dropped by hand, between two ticks.
    const s = playerTestSim({ seed: 'flow-edge' });
    const edge = SECTION_SIZE - 1;
    s.put(edge, 65, 0, source(WATER));
    s.sim.world.columns.delete(columnKey(1, 0));
    updateLiquid(s.sim, edge, 65, 0, s.events);
    expect(s.block(edge - 1, 65, 0)).toBe(level(WATER, 1));
    expect(s.sim.world.getBlock(edge + 1, 65, 0)).toBe(s.sim.world.outside);
  });

  it('finds nothing to flow in a generated world: lakes, rivers and flooded caves stay still', () => {
    let liquids = 0;
    for (const seed of ['7', '42', 'planet']) {
      const s = playerTestSim({ seed, worldType: 'default', viewRadius: 3 });
      const { world, registry } = s.sim;
      const out: SimEvent[] = [];
      const kinds = liquidTables(registry).kinds;
      for (const column of world.columns.values()) {
        if (!simulated(s.sim, column.cx, column.cz)) continue;
        for (let lz = 0; lz < SECTION_SIZE; lz++)
          for (let lx = 0; lx < SECTION_SIZE; lx++)
            for (let y = 1; y < 140; y++) {
              const x = column.cx * SECTION_SIZE + lx;
              const z = column.cz * SECTION_SIZE + lz;
              if (!kinds[registry.tables.blockOf[column.getBlock(lx, y, lz)]!]) continue;
              liquids++;
              updateLiquid(s.sim, x, y, z, out);
              expect(out, `${seed}: (${x}, ${y}, ${z})`).toEqual([]);
            }
      }
    }
    expect(liquids).toBeGreaterThan(1000);
  }, 60_000);
});

describe('lava (plan v3 « M29 »)', () => {
  const LAVA = 'block:lava';

  it('flows slowly, two levels a block: three blocks from a source', () => {
    const s = poured('lava-flow', 0, 65, 0, LAVA);
    const lava = liquidTables(s.sim.registry).kinds.find((k) => k?.step === 2)!;
    // Nothing moves before its delay, five times the water's.
    s.step(lava.delay - 1);
    expect(s.block(1, 65, 0)).toBe(AIR);
    s.step(lava.delay * 6);
    for (let d = 1; d <= 4; d++) {
      const expected = d <= 3 ? level(LAVA, 2 * d) : AIR;
      expect(s.block(d, 65, 0), `${d}`).toBe(expected);
    }
    expect(s.sim.blockUpdates.size).toBe(0);
  });

  it('hardens where water touches it: a source into dark stone, a flow into stone, hissing', () => {
    const s = poured('lava-water', 0, 65, 0, LAVA);
    s.put(3, 65, 0, level(LAVA, 2));
    s.put(1, 65, 0, source(WATER));
    noteLiquids(s.sim, 1, 65, 0);
    s.put(4, 65, 0, source(WATER));
    noteLiquids(s.sim, 4, 65, 0);
    const lava = liquidTables(s.sim.registry).kinds.find((k) => k?.step === 2)!;
    s.step(lava.delay + 1);
    expect(s.block(0, 65, 0)).toBe('block:darkstone');
    expect(s.block(3, 65, 0)).toBe('block:stone');
    const hiss = s.sim.registry.pack.sounds!.hardens;
    expect(eventsOf(s.events, 'sound').filter((e) => e.sfx === hiss).length).toBeGreaterThan(0);
  });
});
