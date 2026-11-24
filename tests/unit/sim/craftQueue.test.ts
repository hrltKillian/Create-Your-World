import { describe, expect, it } from 'vitest';
import { DEFAULT_STACK } from '../../../src/content/items.ts';
import {
  CRAFT_QUEUE,
  entryCrafts,
  noteSeen,
  queueRoom,
  STATION_REACH,
} from '../../../src/sim/craftQueue.ts';
import { addItem, countItem } from '../../../src/sim/inventory.ts';
import type { ItemDropState } from '../../../src/sim/itemDrops.ts';
import { registry } from '../../helpers/registry.ts';
import { eventsOf, playerTestSim, rejections } from '../../helpers/simHarness.ts';

/** A flat world (grass at y 64) with the player at (0.5, 65, 0.5); commands go through JSON. */
function setup() {
  const s = playerTestSim({ seed: 'craft', serialize: true });
  const enqueue = (recipe: string, count = 1) =>
    s.send({ type: 'craft.enqueue', recipe: `recipe:${recipe}`, count });
  return { ...s, enqueue };
}

describe('craft queue', () => {
  it('reserves the ingredients when queued and makes the Flint Hatchet in 2 s', () => {
    const s = setup();
    s.give('item:flint', 2);
    s.give('item:stick', 2);
    s.give('item:cord', 1);
    expect(rejections(s.enqueue('flint_hatchet'))).toEqual([]);
    const inv = s.player.inventory;
    expect([countItem(inv, 'item:flint'), countItem(inv, 'item:stick')]).toEqual([1, 0]);
    expect(s.player.craft[0]).toMatchObject({ recipe: 'recipe:flint_hatchet', count: 1 });
    s.events.length = 0;
    s.step(58);
    expect(countItem(inv, 'item:flint_hatchet')).toBe(0);
    s.step(1);
    expect(eventsOf(s.events, 'crafted')).toEqual([
      {
        type: 'crafted',
        playerId: 1,
        recipe: 'recipe:flint_hatchet',
        item: 'item:flint_hatchet',
        count: 1,
      },
    ]);
    expect(inv.find((stack) => stack?.item === 'item:flint_hatchet')).toEqual({
      item: 'item:flint_hatchet',
      count: 1,
      durability: 60,
    });
    expect(s.player.craft).toEqual([]);
  });

  it('refunds the ingredients of a cancelled entry, and crafts several in a row', () => {
    const s = setup();
    s.give('item:stick', 3);
    s.give('item:plant_fiber', 6);
    expect(rejections(s.enqueue('torch', 3))).toEqual([]);
    expect(countItem(s.player.inventory, 'item:plant_fiber')).toBe(0);
    s.step(30);
    expect(countItem(s.player.inventory, 'item:torch')).toBe(2);
    expect(s.player.craft[0]?.count).toBe(2);
    s.send({ type: 'craft.cancel', index: 0 });
    expect(s.player.craft).toEqual([]);
    expect(countItem(s.player.inventory, 'item:stick')).toBe(2);
    expect(countItem(s.player.inventory, 'item:plant_fiber')).toBe(4);
    expect(rejections(s.send({ type: 'craft.cancel', index: 0 }))).toEqual(['no such entry']);
  });

  it('refuses missing ingredients, a full queue and malformed commands', () => {
    const s = setup();
    s.give('item:plant_fiber', 20);
    expect(rejections(s.enqueue('cord', 7))).toEqual(['ingredients']);
    expect(countItem(s.player.inventory, 'item:plant_fiber')).toBe(20);
    // A tool stacks to 1: one craft per entry, so 5 knives fill the queue.
    s.give('item:flint', 6);
    s.give('item:stick', 6);
    for (let i = 0; i < CRAFT_QUEUE; i++) expect(rejections(s.enqueue('flint_knife'))).toEqual([]);
    expect(s.player.craft).toHaveLength(CRAFT_QUEUE);
    expect(rejections(s.enqueue('flint_knife'))).toEqual(['queue full']);
    expect(rejections(s.enqueue('cord'))).toEqual(['queue full']);
    expect(countItem(s.player.inventory, 'item:flint')).toBe(1);
    expect(
      rejections(
        s.send(
          { type: 'craft.enqueue', recipe: 'recipe:cord', count: 0 },
          { type: 'craft.enqueue', recipe: 'recipe:cord', count: 1.5 },
          { type: 'craft.enqueue', recipe: 'recipe:nope', count: 1 },
          { type: 'craft.cancel', index: -1 },
        ),
      ),
    ).toEqual(['invalid', 'invalid', 'unknown recipe', 'invalid']);
  });

  it('adds a recipe already queued to its entry: five ×1 make what one ×5 makes', () => {
    const queued = (batches: readonly number[]) => {
      const s = setup();
      s.give('item:stick', 7);
      s.give('item:plant_fiber', 11);
      // Sent in one tick, so both queues have run the same ticks.
      const commands = batches.map((count) => ({
        type: 'craft.enqueue' as const,
        recipe: 'recipe:torch',
        count,
      }));
      expect(rejections(s.send(...commands))).toEqual([]);
      return { queue: s.player.craft, inventory: s.player.inventory };
    };
    const ones = queued([1, 1, 1, 1, 1]);
    const five = queued([5]);
    expect(ones).toEqual(five);
    expect(five.queue).toEqual([
      {
        recipe: 'recipe:torch',
        count: 5,
        progressTicks: 1,
        reserved: [
          { item: 'item:stick', count: 5 },
          { item: 'item:plant_fiber', count: 10 },
        ],
      },
    ]);
    // Cancelling the entry gives every reserved ingredient back.
    const s = setup();
    s.give('item:stick', 5);
    s.give('item:plant_fiber', 10);
    for (let i = 0; i < 5; i++) s.enqueue('torch');
    s.send({ type: 'craft.cancel', index: 0 });
    expect(s.player.craft).toEqual([]);
    expect(countItem(s.player.inventory, 'item:stick')).toBe(5);
    expect(countItem(s.player.inventory, 'item:plant_fiber')).toBe(10);
  });

  it('caps an entry at one stack of its output, then opens a new entry', () => {
    const s = setup();
    // Planks: 4 per craft, so an entry holds 16 crafts (64 planks).
    const cap = entryCrafts(registry, registry.crafting.recipe('recipe:planks')!);
    expect(cap).toBe(DEFAULT_STACK / 4);
    s.give('item:broadleaf_log', cap + 4);
    expect(rejections(s.enqueue('planks', cap - 2))).toEqual([]);
    expect(rejections(s.enqueue('planks', 6))).toEqual([]);
    expect(s.player.craft.map((entry) => entry.count)).toEqual([cap, 4]);
    expect(s.player.craft[1]!.reserved).toEqual([{ item: 'item:broadleaf_log', count: 4 }]);
    expect(queueRoom(registry, s.player.craft, registry.crafting.recipe('recipe:planks')!)).toBe(
      (CRAFT_QUEUE - 1) * cap - 4,
    );
  });

  it('needs a workbench within 4 blocks for workbench recipes, checked when queued', () => {
    const s = setup();
    s.give('item:planks', 16);
    s.give('item:cord', 2);
    expect(rejections(s.enqueue('chest'))).toEqual(['station']);
    const at = (x: number, z: number, state: string) =>
      s.send({ type: 'debug.fill', x0: x, y0: 65, z0: z, x1: x, y1: 65, z1: z, state });
    at(STATION_REACH + 2, 0, 'block:workbench');
    expect(s.host.view.stationNear('station:workbench')).toBe(false);
    expect(rejections(s.enqueue('chest'))).toEqual(['station']);
    at(3, 0, 'block:workbench');
    expect(s.host.view.stationNear('station:workbench')).toBe(true);
    expect(rejections(s.enqueue('chest'))).toEqual([]);
    // Taking the workbench away does not stop what is queued.
    at(3, 0, 'block:air');
    s.step(90);
    expect(countItem(s.player.inventory, 'item:chest')).toBe(1);
  });

  it('reveals a recipe once one of its ingredients has been seen (tags included)', () => {
    const s = setup();
    expect(rejections(s.enqueue('stone_shard'))).toEqual(['not revealed']);
    s.give('item:stone', 1);
    expect(s.player.seen['item:stone']).toBe(true);
    expect(rejections(s.enqueue('stone_shard'))).toEqual([]);
    const crafting = registry.crafting;
    const planksUnknown = { ...crafting.recipe('recipe:planks')!, known: undefined };
    const seen: Record<string, true> = {};
    expect(crafting.revealed(planksUnknown, seen)).toBe(false);
    noteSeen(registry, seen, 'item:conifer_log');
    expect(seen['tag:log']).toBe(true);
    expect(crafting.revealed(planksUnknown, seen)).toBe(true);
  });

  it('drops the output at the feet when the bag is full', () => {
    const s = setup();
    s.give('item:plant_fiber', 3);
    s.enqueue('cord');
    const full = DEFAULT_STACK * s.player.inventory.length;
    addItem(s.player.inventory, registry, { item: 'item:stone', count: full });
    s.step(30);
    const drops = [...s.sim.entities.values()].filter(
      (e): e is ItemDropState => e.kind === 'itemDrop',
    );
    expect(drops.map((d) => [d.item, d.count])).toEqual([['item:cord', 1]]);
  });
});
