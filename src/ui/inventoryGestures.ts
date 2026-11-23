import { HOTBAR_SLOTS } from '../core/player.ts';
import type { InventoryCommand } from '../sim/commands.ts';
import type { Slots } from './itemSlot.ts';

/** A right-button drag carries half of the stack (rounded up). */
export function splitCount(count: number): number {
  return Math.ceil(count / 2);
}

/** First empty slot in the same part (hotbar or bag) as `slot`, else in the other part, or −1. */
export function emptySlotNear(slots: Slots, slot: number): number {
  const inHotbar = slot < HOTBAR_SLOTS;
  let other = -1;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i]) continue;
    if (i < HOTBAR_SLOTS === inHotbar) return i;
    if (other < 0) other = i;
  }
  return other;
}

/**
 * The command a drag ends with: `count` items of slot `from` released over slot `to` (−1: over no
 * slot, which cancels). A split released on its own slot goes to the nearest empty slot.
 */
export function dropCommand(
  slots: Slots,
  from: number,
  to: number,
  count: number,
): InventoryCommand | null {
  const stack = slots[from];
  if (!stack) return null;
  const whole = count >= stack.count;
  const target = to === from && !whole ? emptySlotNear(slots, from) : to;
  if (target < 0 || target === from) return null;
  return whole
    ? { type: 'inv.move', from, to: target }
    : { type: 'inv.move', from, to: target, count };
}

/**
 * A hotbar number key pressed over a slot: swaps (or merges) the hovered stack with that hotbar
 * slot, or brings the hotbar stack to the hovered slot when it is empty.
 */
export function hotkeyCommand(
  slots: Slots,
  hovered: number,
  hotbarSlot: number,
): InventoryCommand | null {
  if (hovered < 0 || hovered === hotbarSlot) return null;
  if (slots[hovered]) return { type: 'inv.move', from: hovered, to: hotbarSlot };
  if (slots[hotbarSlot]) return { type: 'inv.move', from: hotbarSlot, to: hovered };
  return null;
}
