import { describe, expect, it } from 'vitest';
import { CRAFT_QUEUE, noteSeen, STATION_REACH } from '../../../src/sim/craftQueue.ts';
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
    for (let i = 0; i < CRAFT_QUEUE; i++) expect(rejections(s.enqueue('cord'))).toEqual([]);
    expect(rejections(s.enqueue('cord'))).toEqual(['queue full']);
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
    addItem(s.player.inventory, registry, { item: 'item:stone', count: 50 * 32 });
    s.step(30);
    const drops = [...s.sim.entities.values()].filter(
      (e): e is ItemDropState => e.kind === 'itemDrop',
    );
    expect(drops.map((d) => [d.item, d.count])).toEqual([['item:cord', 1]]);
  });
});
