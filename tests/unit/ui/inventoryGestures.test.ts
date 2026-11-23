import { describe, expect, it } from 'vitest';
import { HOTBAR_SLOTS } from '../../../src/core/player.ts';
import { createInventory, type Inventory } from '../../../src/sim/inventory.ts';
import {
  dropCommand,
  emptySlotNear,
  hotkeyCommand,
  splitCount,
} from '../../../src/ui/inventoryGestures.ts';

function inventory(stacks: Record<number, number>): Inventory {
  const slots = createInventory();
  for (const [slot, count] of Object.entries(stacks))
    slots[Number(slot)] = { item: 'item:dirt', count };
  return slots;
}

describe('inventory gestures', () => {
  it('splits half of a stack, rounded up', () => {
    expect(splitCount(1)).toBe(1);
    expect(splitCount(7)).toBe(4);
    expect(splitCount(50)).toBe(25);
  });

  it('moves a whole stack where it is dropped, and nothing when dropped back or outside', () => {
    const slots = inventory({ 0: 10 });
    expect(dropCommand(slots, 0, 12, 10)).toEqual({ type: 'inv.move', from: 0, to: 12 });
    expect(dropCommand(slots, 0, 0, 10)).toBeNull();
    expect(dropCommand(slots, 0, -1, 10)).toBeNull();
    expect(dropCommand(slots, 5, 12, 1)).toBeNull();
  });

  it('moves a split part, to the nearest empty slot when released on its own slot', () => {
    const slots = inventory({ 0: 10, 1: 3, 8: 4 });
    expect(dropCommand(slots, 0, 9, 5)).toEqual({ type: 'inv.move', from: 0, to: 9, count: 5 });
    expect(dropCommand(slots, 0, 0, 5)).toEqual({ type: 'inv.move', from: 0, to: 2, count: 5 });
    expect(dropCommand(slots, 8, 8, 2)).toEqual({ type: 'inv.move', from: 8, to: 9, count: 2 });
  });

  it('finds an empty slot in the same part first, else in the other one', () => {
    const full = inventory(
      Object.fromEntries(Array.from({ length: HOTBAR_SLOTS }, (_, i) => [i, 1])),
    );
    expect(emptySlotNear(full, 3)).toBe(HOTBAR_SLOTS);
    expect(emptySlotNear(inventory({}), 20)).toBe(HOTBAR_SLOTS);
    expect(emptySlotNear(inventory({}), 2)).toBe(0);
  });

  it('swaps the hovered slot with a hotbar slot on a number key', () => {
    const slots = inventory({ 3: 5, 10: 2 });
    expect(hotkeyCommand(slots, 10, 0)).toEqual({ type: 'inv.move', from: 10, to: 0 });
    expect(hotkeyCommand(slots, 12, 3)).toEqual({ type: 'inv.move', from: 3, to: 12 });
    expect(hotkeyCommand(slots, 12, 0)).toBeNull();
    expect(hotkeyCommand(slots, 3, 3)).toBeNull();
    expect(hotkeyCommand(slots, -1, 3)).toBeNull();
  });
});
