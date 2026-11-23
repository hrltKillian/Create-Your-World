import { describe, expect, it } from 'vitest';
import { Rng } from '../../../src/core/rng.ts';
import {
  addItem,
  addToRange,
  countItem,
  createInventory,
  deserializeInventory,
  INVENTORY_SLOTS,
  type Inventory,
  moveInto,
  moveItems,
  moveStack,
  quickMove,
  sameStack,
  serializeInventory,
  takeFromSlot,
} from '../../../src/sim/inventory.ts';
import { registry } from '../../helpers/registry.ts';

const counts = (inventory: Inventory) => inventory.map((s) => s?.count ?? 0);

describe('inventory', () => {
  it('splits 70 blocks into stacks of 50 and 20, hotbar first', () => {
    const inventory = createInventory();
    expect(inventory).toHaveLength(INVENTORY_SLOTS);
    expect(addItem(inventory, registry, { item: 'item:dirt', count: 70 })).toBe(0);
    expect(counts(inventory).slice(0, 3)).toEqual([50, 20, 0]);
    expect(addItem(inventory, registry, { item: 'item:dirt', count: 35 })).toBe(0);
    expect(counts(inventory).slice(0, 3)).toEqual([50, 50, 5]);
  });

  it('returns what does not fit and keeps tools apart', () => {
    const inventory = createInventory();
    expect(
      addItem(inventory, registry, { item: 'item:stone', count: 50 * INVENTORY_SLOTS + 7 }),
    ).toBe(7);
    const tools = createInventory();
    expect(addItem(tools, registry, { item: 'item:flint_pickaxe', count: 2, durability: 60 })).toBe(
      0,
    );
    expect(tools.slice(0, 2)).toEqual([
      { item: 'item:flint_pickaxe', count: 1, durability: 60 },
      { item: 'item:flint_pickaxe', count: 1, durability: 60 },
    ]);
  });

  it('moves, merges, swaps and quick-moves between the hotbar and the bag', () => {
    const inventory = createInventory();
    addItem(inventory, registry, { item: 'item:dirt', count: 60 });
    addItem(inventory, registry, { item: 'item:sand', count: 5 });
    // Slots: 0 dirt 50, 1 dirt 10, 2 sand 5.
    expect(moveItems(inventory, registry, 1, 0)).toBe(false); // slot 0 is full
    expect(moveItems(inventory, registry, 0, 9, 20)).toBe(true);
    expect(counts(inventory).slice(0, 10)).toEqual([30, 10, 5, 0, 0, 0, 0, 0, 0, 20]);
    expect(moveItems(inventory, registry, 1, 0)).toBe(true);
    expect(inventory[0]).toEqual({ item: 'item:dirt', count: 40 });
    expect(moveItems(inventory, registry, 2, 0, 1)).toBe(false); // part of a stack cannot swap
    expect(moveItems(inventory, registry, 2, 0)).toBe(true);
    expect(inventory[0]?.item).toBe('item:sand');
    expect(inventory[2]?.item).toBe('item:dirt');
    expect(quickMove(inventory, registry, 2)).toBe(true); // 40 dirt join the 20 in the bag
    expect(counts(inventory).slice(8, 11)).toEqual([10, 50, 0]);
    expect(inventory[8]?.item).toBe('item:dirt');
    expect(quickMove(inventory, registry, 9)).toBe(true);
    expect(inventory[1]).toEqual({ item: 'item:dirt', count: 50 });
    expect(takeFromSlot(inventory, 1, 60)).toEqual({ item: 'item:dirt', count: 50 });
    expect(inventory[1]).toBeNull();
  });

  it('keeps item totals through 1000 random operations', () => {
    const rng = Rng.fromSeed('inventory', 'ops');
    const keys = ['item:dirt', 'item:stone', 'item:torch', 'item:flint_hatchet'];
    const inventory = createInventory();
    const expected = new Map(keys.map((k) => [k, 0]));
    const slot = () => rng.int(INVENTORY_SLOTS);
    for (let i = 0; i < 1000; i++) {
      const op = rng.int(4);
      if (op === 0) {
        const item = keys[rng.int(keys.length)]!;
        const count = rng.intRange(1, 80);
        const stack =
          item === 'item:flint_hatchet' ? { item, count, durability: 60 } : { item, count };
        const left = addItem(inventory, registry, stack);
        expected.set(item, expected.get(item)! + count - left);
      } else if (op === 1) {
        moveItems(
          inventory,
          registry,
          slot(),
          slot(),
          rng.chance(0.5) ? rng.intRange(1, 60) : undefined,
        );
      } else if (op === 2) {
        quickMove(inventory, registry, slot());
      } else {
        const taken = takeFromSlot(inventory, slot(), rng.intRange(1, 30));
        if (taken) expected.set(taken.item, expected.get(taken.item)! - taken.count);
      }
      for (const stack of inventory) {
        if (!stack) continue;
        expect(stack.count).toBeGreaterThan(0);
        expect(stack.count).toBeLessThanOrEqual(registry.maxStack(stack.item));
      }
    }
    for (const key of keys) expect(countItem(inventory, key), key).toBe(expected.get(key));
  });

  it('keeps item totals through 1000 random moves between the inventory and a chest', () => {
    const rng = Rng.fromSeed('inventory', 'chest');
    const keys = ['item:dirt', 'item:torch', 'item:flint_hatchet', 'item:plant_fiber'];
    const inventory = createInventory();
    const chest: Inventory = new Array(18).fill(null);
    for (const key of keys)
      addItem(inventory, registry, { item: key, count: key === 'item:torch' ? 60 : 7 });
    addToRange(chest, registry, 0, 18, { item: 'item:dirt', count: 90 });
    const total = (key: string) => countItem(inventory, key) + countItem(chest, key);
    const before = keys.map(total);
    const pick = (): [Inventory, number] =>
      rng.chance(0.5) ? [inventory, rng.int(INVENTORY_SLOTS)] : [chest, rng.int(18)];
    for (let i = 0; i < 1000; i++) {
      const [source, from] = pick();
      if (rng.chance(0.3)) {
        const target = source === chest ? inventory : chest;
        moveInto(registry, source, from, target, 0, target.length);
      } else {
        const [target, to] = pick();
        const count = rng.chance(0.5) ? rng.intRange(1, 40) : undefined;
        moveStack(registry, source, from, target, to, count);
      }
      for (const stack of [...inventory, ...chest]) {
        if (!stack) continue;
        expect(stack.count).toBeGreaterThan(0);
        expect(stack.count).toBeLessThanOrEqual(registry.maxStack(stack.item));
      }
    }
    expect(keys.map(total)).toEqual(before);
  });

  it('round-trips through JSON and repairs malformed saves', () => {
    const inventory = createInventory();
    addItem(inventory, registry, { item: 'item:dirt', count: 70 });
    addItem(inventory, registry, { item: 'item:flint_pickaxe', count: 1, durability: 12 });
    const saved = JSON.parse(JSON.stringify(serializeInventory(inventory)));
    expect(deserializeInventory(saved, registry)).toEqual(inventory);
    expect(deserializeInventory(undefined, registry)).toEqual(createInventory());
    const repaired = deserializeInventory(
      [{ item: 'item:dirt', count: 0 }, { count: 3 }, null],
      registry,
    );
    expect(repaired).toEqual(createInventory());
  });

  it('loads an item the pack lacks as the unknown item, saved back with its own key', () => {
    const [stack] = deserializeInventory([{ item: 'item:retired', count: 3 }], registry);
    expect(stack).toEqual({ item: registry.unknownItem, count: 3, original: 'item:retired' });
    expect(serializeInventory([stack!])).toEqual([{ item: 'item:retired', count: 3 }]);
    // It keeps its key through pickups and moves: it stacks only with items of that same key.
    const inventory = createInventory();
    expect(addItem(inventory, registry, { ...stack!, count: 2 })).toBe(0);
    expect(addItem(inventory, registry, { ...stack!, original: 'item:gone' })).toBe(0);
    expect(addItem(inventory, registry, stack!)).toBe(0);
    expect(inventory.slice(0, 3)).toEqual([
      { item: registry.unknownItem, count: 5, original: 'item:retired' },
      { item: registry.unknownItem, count: 3, original: 'item:gone' },
      null,
    ]);
    expect(moveItems(inventory, registry, 1, 0)).toBe(true); // a swap, not a merge
    expect(inventory[0]).toMatchObject({ count: 3, original: 'item:gone' });
    inventory[8] = { ...stack!, count: 1 };
    expect(quickMove(inventory, registry, 8)).toBe(true);
    expect(inventory[1]).toMatchObject({ count: 6, original: 'item:retired' });
  });

  it('stacks the same item under the same key, never items that wear', () => {
    const dirt = { item: 'item:dirt', count: 1 };
    const pick = { item: 'item:flint_pickaxe', count: 1, durability: 60 };
    const unknown = { item: registry.unknownItem, count: 1, original: 'item:retired' };
    expect(sameStack(dirt, { item: 'item:dirt', count: 7 })).toBe(true);
    expect(sameStack(dirt, { item: 'item:sand', count: 1 })).toBe(false);
    expect(sameStack(pick, { ...pick })).toBe(false);
    expect(sameStack(unknown, { ...unknown, count: 4 })).toBe(true);
    expect(sameStack(unknown, { ...unknown, original: 'item:gone' })).toBe(false);
    expect(sameStack(unknown, { item: registry.unknownItem, count: 1 })).toBe(false);
  });
});
