import { describe, expect, it } from 'vitest';
import { HOTBAR_SLOTS } from '../../../src/core/player.ts';
import type { ContainerEntity } from '../../../src/sim/blockEntities.ts';
import type { Inventory } from '../../../src/sim/inventory.ts';
import { STACK_RADIUS, sortSlots, stackInto } from '../../../src/sim/tidying.ts';
import { cellKey } from '../../../src/world/coords.ts';
import { registry } from '../../helpers/registry.ts';
import { eventsOf, playerTestSim, rejections } from '../../helpers/simHarness.ts';

/*
 * Inventory comfort (plan v3 « M32 »): sorting merges the stacks and orders them; a quick stack
 * moves the bag's items into the chests nearby that already hold them; a workbench takes its
 * ingredients from the chests near it too.
 */

const stack = (key: string, count: number) => ({ item: `item:${key}`, count });

describe('sorting and stacking', () => {
  it('sorts slots: stacks of a kind merged, the pack’s item order, empty slots last', () => {
    const slots: Inventory = [
      stack('stick', 10),
      null,
      stack('flint', 3),
      stack('stick', 60),
      null,
      stack('flint', 2),
    ];
    expect(sortSlots(registry, slots, 0, slots.length)).toBe(true);
    const order = (key: string) => registry.itemId(`item:${key}`);
    const [first, second] =
      order('stick') < order('flint') ? ['stick', 'flint'] : ['flint', 'stick'];
    const counts: Record<string, number[]> = { stick: [64, 6], flint: [5] };
    expect(slots).toEqual([
      ...counts[first]!.map((n) => stack(first, n)),
      ...counts[second]!.map((n) => stack(second, n)),
      ...new Array(6 - 3).fill(null),
    ]);
    expect(sortSlots(registry, slots, 0, slots.length)).toBe(false);
  });

  it('stacks into a chest only the items it already holds, as far as they fit', () => {
    const bag: Inventory = [stack('stick', 70), stack('flint', 4), stack('dirt', 5)];
    const chest: Inventory = [stack('stick', 60), stack('dirt', 1), null];
    // 4 onto the chest's sticks, 64 into its empty slot: 2 stay; the dirt goes whole.
    expect(stackInto(registry, bag, 0, bag.length, chest)).toBe(4 + 64 + 5);
    expect(bag).toEqual([stack('stick', 2), stack('flint', 4), null]);
    expect(chest).toEqual([stack('stick', 64), stack('dirt', 6), stack('stick', 64)]);
  });

  it('sorts the bag (never the hotbar) or the open chest, and stacks into chests nearby', () => {
    const s = playerTestSim({ seed: 'tidy' });
    const inv = s.player.inventory;
    inv[0] = stack('dirt', 3);
    inv[HOTBAR_SLOTS + 4] = stack('flint', 2);
    inv[HOTBAR_SLOTS + 1] = stack('flint', 5);
    s.send({ type: 'inv.sort', open: false });
    expect(inv[0]).toEqual(stack('dirt', 3));
    expect(inv[HOTBAR_SLOTS]).toEqual(stack('flint', 7));
    expect(inv[HOTBAR_SLOTS + 1]).toBeNull();
    expect(rejections(s.send({ type: 'inv.sort', open: true }))).toEqual(['nothing open']);
    // Two chests: one near holding flint, one beyond the radius.
    s.put(2, 65, 0, 'block:chest');
    s.put(STACK_RADIUS + 3, 65, 0, 'block:chest');
    s.send({ type: 'container.open', x: 2, y: 65, z: 0 });
    s.send({ type: 'screen.close' });
    // The far one opened from beside it (its record made), then back.
    s.send({ type: 'debug.teleport', x: STACK_RADIUS + 1.5, y: 65, z: 0.5 });
    s.send({ type: 'container.open', x: STACK_RADIUS + 3, y: 65, z: 0 });
    s.send({ type: 'screen.close' });
    s.send({ type: 'debug.teleport', x: 0.5, y: 65, z: 0.5 });
    const near = s.sim.blockEntities.get(cellKey(2, 65, 0)) as ContainerEntity;
    const far = s.sim.blockEntities.get(cellKey(STACK_RADIUS + 3, 65, 0)) as ContainerEntity;
    near.slots[3] = stack('flint', 1);
    far.slots[0] = stack('dirt', 1);
    inv[0] = stack('dirt', 3);
    const events = s.send({ type: 'inv.stackNearby' });
    expect(eventsOf(events, 'stackedNearby')).toEqual([
      { type: 'stackedNearby', playerId: 1, count: 7, chests: 1 },
    ]);
    expect(near.slots[3]).toEqual(stack('flint', 8));
    expect(inv[HOTBAR_SLOTS]).toBeNull();
    // The hotbar keeps its dirt; the far chest takes nothing.
    expect(inv[0]).toEqual(stack('dirt', 3));
    expect(far.slots[0]).toEqual(stack('dirt', 1));
  });

  it('crafts at a workbench with ingredients from the chests near it', () => {
    const s = playerTestSim({ seed: 'tidy-bench' });
    s.put(0, 65, -2, 'block:workbench');
    s.put(2, 65, -2, 'block:chest');
    s.send({ type: 'container.open', x: 2, y: 65, z: -2 });
    s.send({ type: 'screen.close' });
    const chest = s.sim.blockEntities.get(cellKey(2, 65, -2)) as ContainerEntity;
    const recipe = registry.crafting.recipe('recipe:chest')!;
    // Its ingredients seen (the recipe revealed), none in the inventory.
    for (const input of recipe.inputs) s.player.seen[input.item] = true;
    s.player.seen['item:planks'] = true;
    for (const [i, input] of recipe.inputs.entries())
      chest.slots[i] = {
        item: input.item.startsWith('tag:') ? 'item:planks' : input.item,
        count: input.count,
      };
    expect(rejections(s.send({ type: 'craft.enqueue', recipe: recipe.key, count: 1 }))).toEqual([
      'station',
    ]);
    s.send({ type: 'container.open', x: 0, y: 65, z: -2 });
    expect(rejections(s.send({ type: 'craft.enqueue', recipe: recipe.key, count: 1 }))).toEqual([]);
    expect(chest.slots.every((slot) => slot === null)).toBe(true);
    // Nothing left anywhere: a second craft is refused.
    expect(rejections(s.send({ type: 'craft.enqueue', recipe: recipe.key, count: 1 }))).toEqual([
      'ingredients',
    ]);
  });
});
