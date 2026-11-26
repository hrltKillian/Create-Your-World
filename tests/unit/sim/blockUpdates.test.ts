import { describe, expect, it } from 'vitest';
import { LEAF_DECAY } from '../../../src/content/packs/base/blocks.ts';
import { BY_WORLD, removeBlock } from '../../../src/sim/blockRemoval.ts';
import {
  BLOCK_UPDATES,
  BlockUpdateQueue,
  stepBlockUpdates,
  UPDATE_DECAY,
  UPDATE_SUPPORT,
} from '../../../src/sim/blockUpdates.ts';
import { ticksOf } from '../../../src/sim/clock.ts';
import { checkDecay } from '../../../src/sim/leafDecay.ts';
import { MemoryStorage } from '../../../src/sim/MemoryStorage.ts';
import { restoreFrom, saveTo, settle } from '../../helpers/save.ts';
import { eventsOf, playerTestSim } from '../../helpers/simHarness.ts';

/*
 * Block updates (tick step 10): the queue's order, merging and saving; supports and leaf decay
 * (docs « Feuilles », « Torches », M14).
 */

const popped = [0, 0, 0, 0, 0];
function drain(queue: BlockUpdateQueue, tick: number): number[][] {
  const rows: number[][] = [];
  while (queue.pop(tick, popped)) rows.push([...popped]);
  return rows;
}

describe('the block update queue', () => {
  it('pops by due tick then by order of scheduling, each cell and kind once, earliest kept', () => {
    const queue = new BlockUpdateQueue();
    queue.schedule(1, 65, 1, UPDATE_DECAY, 20);
    queue.schedule(2, 65, 2, UPDATE_SUPPORT, 10);
    queue.schedule(3, 65, 3, UPDATE_SUPPORT, 10);
    queue.schedule(1, 65, 1, UPDATE_DECAY, 30); // later: ignored
    queue.schedule(2, 65, 2, UPDATE_SUPPORT, 5); // earlier: wins
    queue.schedule(1, 65, 1, UPDATE_SUPPORT, 15); // another kind of the same cell
    expect(queue.size).toBe(4);
    expect(drain(queue, 9)).toEqual([[2, 65, 2, UPDATE_SUPPORT, 5]]);
    expect(drain(queue, 100)).toEqual([
      [3, 65, 3, UPDATE_SUPPORT, 10],
      [1, 65, 1, UPDATE_SUPPORT, 15],
      [1, 65, 1, UPDATE_DECAY, 20],
    ]);
    expect(queue.size).toBe(0);
    // Outside the world height: nothing.
    queue.schedule(0, -1, 0, UPDATE_SUPPORT, 0);
    expect(queue.size).toBe(0);
  });

  it('keeps hundreds of updates in order (heap)', () => {
    const queue = new BlockUpdateQueue();
    const dues = Array.from({ length: 500 }, (_, i) => (i * 7919) % 613);
    dues.forEach((due, i) => {
      queue.schedule(i, 70, 0, UPDATE_DECAY, due);
    });
    const order = drain(queue, 1000).map((row) => row[4]!);
    expect(order).toEqual([...dues].sort((a, b) => a - b));
  });

  it('saves its updates (queued and waiting) relative to the tick, and restores them', () => {
    const queue = new BlockUpdateQueue();
    queue.schedule(5, 66, -2, UPDATE_DECAY, 140);
    queue.schedule(4, 66, -2, UPDATE_SUPPORT, 100);
    queue.wait(900, 66, 900, UPDATE_DECAY, 160);
    const saved = queue.serialize(100);
    expect(saved).toEqual([4, 66, -2, 0, 0, 5, 66, -2, 1, 40, 900, 66, 900, 1, 60]);
    const restored = new BlockUpdateQueue();
    restored.restore([...saved, 1, 2], 1000); // a cut row is skipped
    expect(drain(restored, 2000)).toEqual([
      [4, 66, -2, UPDATE_SUPPORT, 1000],
      [5, 66, -2, UPDATE_DECAY, 1040],
      [900, 66, 900, UPDATE_DECAY, 1060],
    ]);
  });

  it('wakes the updates of a column once it is simulated again', () => {
    const queue = new BlockUpdateQueue();
    queue.wait(40, 66, 40, UPDATE_SUPPORT, 7);
    queue.wake(() => false);
    expect(drain(queue, 100)).toEqual([]);
    queue.wake(() => true);
    expect(drain(queue, 100)).toEqual([[40, 66, 40, UPDATE_SUPPORT, 7]]);
  });
});

/** A small tree near the player: a log column at (3, 65…68, -3), leaves around its top. */
function tree(seed: string) {
  const s = playerTestSim({ seed });
  s.fill(3, 65, -3, 3, 68, -3, 'block:broadleaf_log');
  s.fill(1, 68, -5, 5, 69, -1, 'block:foliage');
  s.put(3, 68, -3, 'block:broadleaf_log');
  s.put(3, 69, -3, 'block:foliage');
  s.events.length = 0;
  return s;
}

function leaves(s: ReturnType<typeof tree>): number {
  let n = 0;
  for (let y = 68; y <= 69; y++)
    for (let z = -5; z <= -1; z++)
      for (let x = 1; x <= 5; x++) if (s.block(x, y, z).startsWith('block:foliage')) n++;
  return n;
}

describe('leaf decay', () => {
  it('keeps leaves a log holds, and drops a whole canopy within its delay once the trunk goes', () => {
    const s = tree('decay');
    const before = leaves(s);
    expect(before).toBe(49);
    s.step(ticksOf(LEAF_DECAY.seconds[1]) + 5);
    expect(leaves(s)).toBe(before);
    for (let y = 65; y <= 68; y++) removeBlock(s.sim, BY_WORLD, 3, y, -3, true, s.events);
    s.step(ticksOf(LEAF_DECAY.seconds[0]) - 2);
    expect(leaves(s)).toBe(before);
    s.step(ticksOf(LEAF_DECAY.seconds[1] - LEAF_DECAY.seconds[0]) + 4);
    expect(leaves(s)).toBe(0);
    const fallen = eventsOf(s.events, 'blockBroken').filter((e) => e.playerId === BY_WORLD);
    expect(fallen).toHaveLength(before + 4);
    expect(s.sim.blockUpdates.size).toBe(0);
  });

  it('never drops leaves a player placed, nor leaves another log still holds', () => {
    const s = tree('decay-kept');
    s.put(1, 69, -5, 'block:foliage[placed=1]');
    s.put(5, 69, -1, 'block:broadleaf_log');
    for (let y = 65; y <= 68; y++) removeBlock(s.sim, BY_WORLD, 3, y, -3, true, s.events);
    s.step(ticksOf(LEAF_DECAY.seconds[1]) + 5);
    expect(s.block(1, 69, -5)).toBe('block:foliage[placed=1]');
    // Leaves within 5 steps of the other log (through leaves) stay.
    expect(s.block(5, 68, -1)).toBe('block:foliage[placed=0]');
    expect(checkDecay(s.sim, 5, 68, -1)).toBe(false);
  });

  it('places leaves as a player’s', () => {
    const s = playerTestSim({ seed: 'decay-place' });
    s.give('item:foliage', 1);
    s.tick(1, { secondary: true, target: { x: 0, y: 64, z: -2, face: 2 } });
    expect(s.block(0, 65, -2)).toBe('block:foliage[placed=1]');
  });

  it('runs at most BLOCK_UPDATES.perTick updates a tick, the rest on the next ticks', () => {
    const s = playerTestSim({ seed: 'budget' });
    const tick = s.sim.tick;
    for (let i = 0; i < BLOCK_UPDATES.perTick + 44; i++)
      s.sim.blockUpdates.schedule(i % 20, 80 + Math.floor(i / 20), 0, UPDATE_SUPPORT, tick);
    stepBlockUpdates(s.sim, s.events);
    expect(s.sim.blockUpdates.size).toBe(44);
    stepBlockUpdates(s.sim, s.events);
    expect(s.sim.blockUpdates.size).toBe(0);
  });

  it('keeps pending decays across a save and reload, then drops the leaves', async () => {
    const s = tree('decay-save');
    for (let y = 65; y <= 68; y++) removeBlock(s.sim, BY_WORLD, 3, y, -3, true, s.events);
    s.step(2);
    const pending = s.sim.blockUpdates.size;
    expect(pending).toBeGreaterThan(0);
    const storage = new MemoryStorage();
    await saveTo(storage, s.sim);
    const resumed = await restoreFrom(storage);
    settle(resumed.sim);
    expect(resumed.sim.blockUpdates.size).toBe(pending);
    resumed.step(ticksOf(LEAF_DECAY.seconds[1]) + 5);
    let left = 0;
    for (let y = 68; y <= 69; y++)
      for (let z = -5; z <= -1; z++)
        for (let x = 1; x <= 5; x++)
          if (
            resumed.sim.registry.states[resumed.sim.world.getBlock(x, y, z)]!.key.startsWith(
              'block:foliage',
            )
          )
            left++;
    expect(left).toBe(0);
  });
});

describe('generated trees', () => {
  it('hold every leaf they grow: each one reaches a log within its radius', () => {
    for (const seed of ['trees-1', 'trees-2', 'trees-3']) {
      const s = playerTestSim({ seed, worldType: 'default', viewRadius: 3 });
      const decaying = new Set(
        s.sim.registry.pack.blocks.filter((b) => b.decay).map((b) => b.key as string),
      );
      let checked = 0;
      for (const column of s.sim.world.columns.values()) {
        for (let lz = 0; lz < 32; lz++)
          for (let lx = 0; lx < 32; lx++)
            for (let y = 60; y < 140; y++) {
              const x = column.cx * 32 + lx;
              const z = column.cz * 32 + lz;
              const state = s.sim.world.getBlock(x, y, z);
              const key = s.sim.registry.blockDef(state).key;
              if (!decaying.has(key)) continue;
              checked++;
              expect(checkDecay(s.sim, x, y, z), `${seed} ${key} at ${x},${y},${z}`).toBe(false);
            }
      }
      expect(checked).toBeGreaterThan(0);
    }
  }, 60_000);
});
