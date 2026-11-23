import { describe, expect, it } from 'vitest';
import { Rng } from '../../../src/core/rng.ts';
import {
  addItem,
  countItem,
  createInventory,
  deserializeInventory,
  INVENTORY_SLOTS,
  type Inventory,
  moveItems,
  quickMove,
  serializeInventory,
  takeFromSlot,
} from '../../../src/sim/inventory.ts';
import { registry } from '../../helpers/registry.ts';

const counts = (inventory: Inventory) => inventory.map((s) => s?.count ?? 0);

describe('inventory', () => {
  it('splits 70 blocks into stacks of 50 and 20, hotbar first', () => {
    const inventory = createInventory();
    expect(inventory).toHaveLength(INVENTORY_SLOTS);
    expect(addItem(inventory, registry, 'item:dirt', 70)).toBe(0);
    expect(counts(inventory).slice(0, 3)).toEqual([50, 20, 0]);
    expect(addItem(inventory, registry, 'item:dirt', 35)).toBe(0);
    expect(counts(inventory).slice(0, 3)).toEqual([50, 50, 5]);
  });

  it('returns what does not fit and keeps tools apart', () => {
    const inventory = createInventory();
    expect(addItem(inventory, registry, 'item:stone', 50 * INVENTORY_SLOTS + 7)).toBe(7);
    const tools = createInventory();
    expect(addItem(tools, registry, 'item:flint_pickaxe', 2, 60)).toBe(0);
    expect(tools.slice(0, 2)).toEqual([
      { item: 'item:flint_pickaxe', count: 1, durability: 60 },
      { item: 'item:flint_pickaxe', count: 1, durability: 60 },
    ]);
  });

  it('moves, merges, swaps and quick-moves between the hotbar and the bag', () => {
    const inventory = createInventory();
    addItem(inventory, registry, 'item:dirt', 60);
    addItem(inventory, registry, 'item:sand', 5);
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
        const wear = item === 'item:flint_hatchet' ? 60 : undefined;
        const left = addItem(inventory, registry, item, count, wear);
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

  it('round-trips through JSON and repairs malformed saves', () => {
    const inventory = createInventory();
    addItem(inventory, registry, 'item:dirt', 70);
    addItem(inventory, registry, 'item:flint_pickaxe', 1, 12);
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
    // It keeps its key through moves and pickups (never stacking: its maximum is 1).
    const inventory = createInventory();
    expect(addItem(inventory, registry, stack!.item, 2, undefined, stack!.original)).toBe(0);
    expect(inventory.slice(0, 3)).toEqual([
      { item: registry.unknownItem, count: 1, original: 'item:retired' },
      { item: registry.unknownItem, count: 1, original: 'item:retired' },
      null,
    ]);
  });
});
