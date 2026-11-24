import { describe, expect, it } from 'vitest';
import { DEFAULT_STACK } from '../../../src/content/items.ts';
import type { WorkbenchEntity } from '../../../src/sim/blockEntities.ts';
import { ticksOf } from '../../../src/sim/clock.ts';
import { type Command, OPEN_SLOTS_BASE } from '../../../src/sim/commands.ts';
import { CRAFT_QUEUE } from '../../../src/sim/craftQueue.ts';
import { createHost } from '../../../src/sim/host.ts';
import { countItem } from '../../../src/sim/inventory.ts';
import type { ItemDropState } from '../../../src/sim/itemDrops.ts';
import { MemoryStorage } from '../../../src/sim/MemoryStorage.ts';
import { persistentHash } from '../../../src/sim/persistence.ts';
import { blockEntityRecord, readBlockEntity } from '../../../src/sim/saveRecords.ts';
import { shiftClick, slotClick } from '../../../src/sim/testing/slotMoves.ts';
import { cellKey, toColumn } from '../../../src/world/coords.ts';
import { registry } from '../../helpers/registry.ts';
import { restoreFrom, saveTo, settle } from '../../helpers/save.ts';
import { eventsOf, playerTestSim, rejections, withPlayer } from '../../helpers/simHarness.ts';

/** The workbench's cell, two blocks north of the player. */
const BENCH = { x: 0, y: 65, z: -2 } as const;
/** First slot number of the open workbench: its outputs. */
const C = OPEN_SLOTS_BASE;
const CHEST_TICKS = ticksOf(registry.crafting.recipe('recipe:chest')!.seconds);
const CUT_TICKS = ticksOf(registry.crafting.recipe('recipe:cut_stone')!.seconds);

const open: Command = { type: 'container.open', ...BENCH };
const enqueue = (recipe: string, count = 1): Command => ({
  type: 'craft.enqueue',
  recipe: `recipe:${recipe}`,
  count,
});
const cancel = (index: number, workbench = true): Command => ({
  type: 'craft.cancel',
  index,
  workbench,
});

/** A flat world, a workbench north of player 1 holding planks and cord; commands through JSON. */
function setup(seed = 'bench') {
  const s = playerTestSim({ seed, serialize: true });
  s.put(BENCH.x, BENCH.y, BENCH.z, 'block:workbench');
  s.give('item:planks', 16);
  s.give('item:cord', 2);
  return {
    ...s,
    bench: () => s.sim.blockEntities.get(cellKey(BENCH.x, BENCH.y, BENCH.z)) as WorkbenchEntity,
  };
}

type Setup = ReturnType<typeof setup>;

const lying = (s: Setup) =>
  [...s.sim.entities.values()]
    .filter((e): e is ItemDropState => e.kind === 'itemDrop')
    .map((d) => [d.item, d.count])
    .sort();

describe('workbenches', () => {
  it('queues its recipes only while open, reserving from the player, into its own queue', () => {
    const s = setup();
    expect(rejections(s.send(enqueue('chest')))).toEqual(['station']);
    expect(eventsOf(s.send(open), 'blockEntityOpened')).toEqual([
      { type: 'blockEntityOpened', playerId: 1, kind: 'workbench', ...BENCH },
    ]);
    expect(s.player.screen).toEqual({ kind: 'block', ...BENCH });
    s.give('item:plant_fiber', 3);
    // A hand recipe still goes to the player's own queue.
    expect(rejections(s.send(enqueue('chest', 2), enqueue('cord')))).toEqual([]);
    expect(s.player.craft.map((entry) => entry.recipe)).toEqual(['recipe:cord']);
    const bench = s.bench();
    expect(bench.craft).toEqual([
      {
        recipe: 'recipe:chest',
        count: 2,
        progressTicks: 1,
        reserved: [
          { item: 'item:planks', count: 16 },
          { item: 'item:cord', count: 2 },
        ],
      },
    ]);
    expect(countItem(s.player.inventory, 'item:planks')).toBe(0);
    s.events.length = 0;
    s.step(CHEST_TICKS - 2);
    expect(bench.slots).toEqual([null, null, null, null]);
    s.step(1);
    expect(bench.slots[0]).toEqual({ item: 'item:chest', count: 1 });
    expect(eventsOf(s.events, 'workbenchCrafted')).toEqual([
      { type: 'workbenchCrafted', ...BENCH, recipe: 'recipe:chest', item: 'item:chest', count: 1 },
    ]);
    // Its outputs only give: a click takes, nothing goes in.
    s.give('item:dirt', 1);
    const dirt = s.player.inventory.findIndex((stack) => stack?.item === 'item:dirt');
    expect(rejections(s.send(slotClick(dirt), slotClick(C + 1), slotClick(dirt)))).toEqual([
      'slot',
    ]);
    expect(rejections(s.send(shiftClick(dirt)))).toEqual(['slot']);
    s.send(shiftClick(C));
    expect(countItem(s.player.inventory, 'item:chest')).toBe(1);
    s.step(CHEST_TICKS);
    expect(bench.craft).toEqual([]);
    expect(bench.slots[0]).toEqual({ item: 'item:chest', count: 1 });
  });

  it('merges a recipe queued again into its entry: five ×1 make what one ×5 makes', () => {
    const queued = (commands: Command[]) => {
      const s = setup();
      s.give('item:planks', 24);
      s.give('item:cord', 3);
      s.send(open);
      expect(rejections(s.send(...commands))).toEqual([]);
      return { queue: s.bench().craft, inventory: s.player.inventory };
    };
    const five = queued([enqueue('chest', 5)]);
    expect(queued(new Array(5).fill(enqueue('chest')))).toEqual(five);
    expect(five.queue).toHaveLength(1);
    expect(five.queue[0]).toMatchObject({ count: 5 });
  });

  it('cancels an entry for whoever cancels it, the bench open', () => {
    const s = setup();
    s.send(open, enqueue('chest'), enqueue('gate'));
    s.give('item:stick', 2);
    s.send(enqueue('gate'));
    expect(s.bench().craft.map((entry) => [entry.recipe, entry.count])).toEqual([
      ['recipe:chest', 1],
      ['recipe:gate', 1],
    ]);
    s.send({ type: 'screen.close' });
    expect(rejections(s.send(cancel(1)))).toEqual(['not open']);
    // Another player opens the bench and cancels the chest: its ingredients go to them.
    s.sim.addPlayer(2, 2);
    const other = createHost(s.sim, 2, true);
    s.step(10);
    other.send(open);
    other.send(cancel(0));
    other.send(cancel(5));
    s.events.length = 0;
    s.step(1);
    expect(rejections(s.events)).toEqual(['no such entry']);
    const second = s.sim.players.get(2)!.inventory;
    expect([countItem(second, 'item:planks'), countItem(second, 'item:cord')]).toEqual([8, 1]);
    expect(s.bench().craft.map((entry) => entry.recipe)).toEqual(['recipe:gate']);
  });

  it('pauses while its outputs are full, and goes on once one is taken', () => {
    const s = setup();
    s.give('item:stone', 2);
    s.send(open);
    const bench = s.bench();
    for (let i = 0; i < bench.slots.length; i++)
      bench.slots[i] = { item: 'item:dirt', count: DEFAULT_STACK };
    s.send(enqueue('cut_stone', 2));
    s.step(3 * CUT_TICKS);
    expect(bench.craft).toEqual([
      {
        recipe: 'recipe:cut_stone',
        count: 2,
        progressTicks: 0,
        reserved: [{ item: 'item:stone', count: 2 }],
      },
    ]);
    s.send(shiftClick(C + 2));
    s.step(CUT_TICKS - 1);
    expect(bench.slots[2]).toEqual({ item: 'item:cut_stone', count: 1 });
    s.step(CUT_TICKS);
    expect(bench.slots[2]).toEqual({ item: 'item:cut_stone', count: 2 });
    expect(bench.craft).toEqual([]);
  });

  it('spills its outputs and every queued ingredient when broken', () => {
    const s = setup();
    s.send(open, enqueue('chest', 2));
    s.step(CHEST_TICKS + 10);
    expect(s.bench().slots[0]).toEqual({ item: 'item:chest', count: 1 });
    const fill = { x0: 0, y0: 65, z0: -2, x1: 0, y1: 65, z1: -2, state: 'block:air' };
    const events = s.send({ type: 'debug.fill', ...fill });
    expect(eventsOf(events, 'blockEntityClosed')).toHaveLength(1);
    expect(s.bench()).toBeUndefined();
    expect(lying(s)).toEqual([
      ['item:chest', 1],
      ['item:cord', 1],
      ['item:planks', 8],
    ]);
  });

  it('makes its crafts with nobody near, catching up when a player comes back', () => {
    const away = setup();
    const stay = setup();
    for (const s of [away, stay]) s.send(open, enqueue('chest', 2), { type: 'screen.close' });
    away.send({ type: 'debug.teleport', x: 40 * 32, y: 'surface', z: 0.5 });
    stay.send({ type: 'debug.freezeTime', frozen: false });
    away.step(100);
    expect(away.sim.columnState(0, toColumn(BENCH.z))).toBe(0);
    const tick = away.bench().tick;
    away.step(400);
    // Out of the simulation radius, it waits.
    expect([away.bench().tick, away.bench().slots[0]]).toEqual([tick, null]);
    away.send({ type: 'debug.teleport', x: 0.5, y: 65, z: 0.5 });
    stay.step(501);
    away.step(100);
    stay.step(100);
    expect(away.sim.tick).toBe(stay.sim.tick);
    expect(away.bench().tick).toBe(away.sim.tick);
    expect(blockEntityRecord(away.bench())).toEqual(blockEntityRecord(stay.bench()));
    expect(away.bench().slots[0]).toEqual({ item: 'item:chest', count: 2 });
  });

  it('round-trips its queue and outputs through a save, then runs on as if never saved', async () => {
    const s = setup('bench-save');
    s.give('item:planks', 8);
    s.give('item:cord', 1);
    s.send(open, enqueue('chest', 3));
    s.step(CHEST_TICKS + 20);
    expect(s.bench().slots[0]).toEqual({ item: 'item:chest', count: 1 });
    const storage = new MemoryStorage();
    await saveTo(storage, s.sim);
    const r = withPlayer(await restoreFrom(storage));
    const restored = r.sim.blockEntities.get(cellKey(BENCH.x, BENCH.y, BENCH.z));
    expect(blockEntityRecord(restored!)).toEqual(blockEntityRecord(s.bench()));
    expect(persistentHash(r.sim)).toBe(persistentHash(s.sim));
    settle(r.sim);
    s.step(2 * CHEST_TICKS);
    r.step(2 * CHEST_TICKS);
    expect(blockEntityRecord(restored!)).toEqual(blockEntityRecord(s.bench()));
    expect(restored!.slots[0]).toEqual({ item: 'item:chest', count: 3 });
  });

  it('reads a malformed workbench record with defaults, its queue cut to 5 entries', () => {
    const entry = { recipe: 'recipe:chest', count: 1, progressTicks: 4, reserved: [] };
    const saved = {
      kind: 'workbench',
      station: 'station:workbench',
      ...BENCH,
      slots: [{ item: 'item:chest', count: 2 }, 'x'],
      craft: [...new Array(CRAFT_QUEUE + 2).fill(entry), { count: 1 }],
    };
    expect(readBlockEntity(saved, registry, 7)).toEqual({
      kind: 'workbench',
      station: 'station:workbench',
      ...BENCH,
      slots: [{ item: 'item:chest', count: 2 }, null, null, null],
      craft: new Array(CRAFT_QUEUE).fill(entry),
      tick: 7,
    });
    expect(readBlockEntity({ ...saved, craft: 'x' }, registry, 7)).toMatchObject({ craft: [] });
    expect(readBlockEntity({ ...saved, station: 3 }, registry, 7)).toBeNull();
  });
});
