import { describe, expect, it } from 'vitest';
import { BY_WORLD, removeBlock } from '../../../src/sim/blockRemoval.ts';
import { noteChanged } from '../../../src/sim/blockUpdates.ts';
import { liquidTables, noteLiquids, updateLiquid } from '../../../src/sim/liquids.ts';
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
});
