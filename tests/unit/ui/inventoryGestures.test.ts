import { describe, expect, it } from 'vitest';
import { HOTBAR_SLOTS } from '../../../src/core/player.ts';
import { OPEN_SLOTS_BASE } from '../../../src/sim/commands.ts';
import { INVENTORY_SLOTS, type Inventory } from '../../../src/sim/inventory.ts';
import {
  dropCommand,
  emptySlotNear,
  hotkeyCommand,
  moveCommand,
  quickMoveCommand,
  type SlotContext,
  splitCount,
} from '../../../src/ui/inventoryGestures.ts';

const BAG: SlotContext = { base: INVENTORY_SLOTS, move: 'equip.move' };
const CHEST: SlotContext = { base: OPEN_SLOTS_BASE, move: 'container.move' };
const STATION: SlotContext = { base: OPEN_SLOTS_BASE, move: 'station.move' };
const CHEST_SLOTS = 18;
const DIRT = 'item:dirt';
const stationMove = (from: number, to: number) => ({ type: 'station.move', from, to });

/** The inventory (and `extra` block entity slots after it) with dirt stacks of these counts. */
function slots(stacks: Record<number, number>, extra = 0): Inventory {
  const out: Inventory = new Array(INVENTORY_SLOTS + extra).fill(null);
  for (const [slot, count] of Object.entries(stacks))
    out[Number(slot)] = { item: 'item:dirt', count };
  return out;
}

describe('inventory gestures', () => {
  it('splits half of a stack, rounded up', () => {
    expect(splitCount(1)).toBe(1);
    expect(splitCount(7)).toBe(4);
    expect(splitCount(50)).toBe(25);
  });

  it('moves a whole stack where it is dropped, and nothing when dropped back or outside', () => {
    const inv = slots({ 0: 10 });
    expect(dropCommand(BAG, inv, 0, 12, 10)).toEqual({ type: 'inv.move', from: 0, to: 12 });
    expect(dropCommand(BAG, inv, 0, 0, 10)).toBeNull();
    expect(dropCommand(BAG, inv, 0, -1, 10)).toBeNull();
    expect(dropCommand(BAG, inv, 5, 12, 1)).toBeNull();
  });

  it('moves a split part, to the nearest empty slot when released on its own slot', () => {
    const inv = slots({ 0: 10, 1: 3, 8: 4 });
    const split = (from: number, to: number, n: number) => dropCommand(BAG, inv, from, to, n);
    expect(split(0, 9, 5)).toEqual({ type: 'inv.move', from: 0, to: 9, count: 5 });
    expect(split(0, 0, 5)).toEqual({ type: 'inv.move', from: 0, to: 2, count: 5 });
    expect(split(8, 8, 2)).toEqual({ type: 'inv.move', from: 8, to: 9, count: 2 });
  });

  it('finds an empty slot in the same part first, else in another one', () => {
    const full = slots(Object.fromEntries(Array.from({ length: HOTBAR_SLOTS }, (_, i) => [i, 1])));
    expect(emptySlotNear(BAG, full, 3, DIRT)).toBe(HOTBAR_SLOTS);
    expect(emptySlotNear(BAG, slots({}), 20, DIRT)).toBe(HOTBAR_SLOTS);
    expect(emptySlotNear(BAG, slots({}), 2, DIRT)).toBe(0);
    // A chest slot's split stays in the chest.
    const chest = slots({ [OPEN_SLOTS_BASE]: 6 }, CHEST_SLOTS);
    expect(emptySlotNear(CHEST, chest, OPEN_SLOTS_BASE, DIRT)).toBe(OPEN_SLOTS_BASE + 1);
  });

  it('releases a station split on its own slot only where the station takes it', () => {
    // A kiln's layout: inputs 0–1, fuel 2 (logs), output 3.
    const c = OPEN_SLOTS_BASE;
    const kiln: SlotContext = {
      ...STATION,
      accepts: (slot, item) => slot < c + 2 || (slot === c + 2 && item === 'item:log'),
    };
    const all = Object.fromEntries(Array.from({ length: INVENTORY_SLOTS }, (_, i) => [i, 1]));
    // Ore split in the first input: the other input, never the fuel or output slot.
    const ore = slots({ [c]: 4 }, 4);
    ore[c] = { item: 'item:ore', count: 4 };
    expect(dropCommand(kiln, ore, c, c, 2)).toEqual({ ...stationMove(c, c + 1), count: 2 });
    ore[c + 1] = { item: 'item:ore', count: 1 };
    // Both inputs taken: the fuel slot refuses ore, so the split goes to the inventory.
    expect(emptySlotNear(kiln, ore, c, 'item:ore')).toBe(0);
    // An output's split never goes back into the inputs: the inventory, else nowhere.
    const out = slots({}, 4);
    out[c + 3] = { item: 'item:ingot', count: 6 };
    expect(dropCommand(kiln, out, c + 3, c + 3, 3)).toEqual({ ...stationMove(c + 3, 0), count: 3 });
    const packed = slots(all, 4);
    packed[c + 3] = { item: 'item:ingot', count: 6 };
    expect(dropCommand(kiln, packed, c + 3, c + 3, 3)).toBeNull();
    // From a full inventory, a split goes to an input that takes it, never to the output.
    const bag = slots(all, 4);
    bag[c] = { item: 'item:ore', count: 1 };
    bag[c + 1] = { item: 'item:ore', count: 1 };
    expect(emptySlotNear(kiln, bag, 3, DIRT)).toBe(-1);
    expect(emptySlotNear(kiln, bag, 3, 'item:log')).toBe(c + 2);
  });

  it('swaps the hovered slot with a hotbar slot on a number key', () => {
    const inv = slots({ 3: 5, 10: 2 });
    expect(hotkeyCommand(BAG, inv, 10, 0)).toEqual({ type: 'inv.move', from: 10, to: 0 });
    expect(hotkeyCommand(BAG, inv, 12, 3)).toEqual({ type: 'inv.move', from: 3, to: 12 });
    expect(hotkeyCommand(BAG, inv, 12, 0)).toBeNull();
    expect(hotkeyCommand(BAG, inv, 3, 3)).toBeNull();
    expect(hotkeyCommand(BAG, inv, -1, 3)).toBeNull();
  });

  it('moves between the inventory and an open chest or station with their own command', () => {
    const c = OPEN_SLOTS_BASE;
    const inv = slots({ 2: 8, [c + 4]: 6 }, CHEST_SLOTS);
    const chestMove = (from: number, to: number) => ({ type: 'container.move', from, to });
    expect(dropCommand(CHEST, inv, 2, c + 1, 8)).toEqual(chestMove(2, c + 1));
    expect(dropCommand(CHEST, inv, c + 4, 9, 3)).toEqual({ ...chestMove(c + 4, 9), count: 3 });
    expect(dropCommand(STATION, inv, 2, c, 8)).toEqual({ type: 'station.move', from: 2, to: c });
    // Inside the inventory it stays an inventory move; in the Bag the worn items are past it.
    expect(dropCommand(CHEST, inv, 2, 9, 8)).toEqual({ type: 'inv.move', from: 2, to: 9 });
    expect(moveCommand(BAG, 2, c, 1)).toEqual({ type: 'equip.move', from: 2, to: c, count: 1 });
    // A number key over a chest slot swaps it with the hotbar.
    expect(hotkeyCommand(CHEST, inv, c + 4, 0)).toEqual(chestMove(c + 4, 0));
    expect(hotkeyCommand(CHEST, inv, c + 5, 2)).toEqual(chestMove(2, c + 5));
  });

  it('sends a stack across on Shift+click: put on or off in the Bag, else to the other side', () => {
    expect(quickMoveCommand(BAG, 4)).toEqual({ type: 'equip.move', from: 4 });
    expect(quickMoveCommand(CHEST, 4)).toEqual({ type: 'container.move', from: 4 });
    expect(quickMoveCommand(STATION, OPEN_SLOTS_BASE)).toEqual({
      type: 'station.move',
      from: OPEN_SLOTS_BASE,
    });
  });
});
