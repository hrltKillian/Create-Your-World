import { HOTBAR_SLOTS } from '../core/player.ts';
import type { BlockEntityCommand, InventoryCommand } from '../sim/commands.ts';
import type { Slots } from './itemSlot.ts';

/** What a gesture on a slot screen sends: an inventory edit, or a move with the open block entity. */
export type SlotCommand = InventoryCommand | BlockEntityCommand;

/**
 * Slot numbers of a screen: the inventory (hotbar 0–7, then the bag) below `base`, then the slots
 * of the open block entity (a chest or a station), moved with `move` (null: the bag alone).
 */
export interface SlotContext {
  readonly base: number;
  readonly move: 'container.move' | 'station.move' | null;
  /**
   * Whether a slot of the open block entity (`base` and up) takes an item: a station's layout
   * (content/crafting.ts `stationAccepts`). Absent: every slot takes anything (a chest).
   */
  readonly accepts?: (slot: number, item: string) => boolean;
}

/** A right-button drag carries half of the stack (rounded up). */
export function splitCount(count: number): number {
  return Math.ceil(count / 2);
}

/** Part of a slot number: 0 the hotbar, 1 the bag, 2 the open block entity. */
function partOf(context: SlotContext, slot: number): number {
  if (slot < HOTBAR_SLOTS) return 0;
  return slot < context.base ? 1 : 2;
}

/** Whether a slot of a screen takes an item (inventory slots take anything). */
function takes(context: SlotContext, slot: number, item: string): boolean {
  return slot < context.base || context.accepts === undefined || context.accepts(slot, item);
}

/**
 * First empty slot that takes `item` in the same part (hotbar, bag, block entity) as `slot`, else
 * in the inventory, else (from the inventory) in the block entity; −1 when there is none. A stack
 * of a slot that would not take it back (a station's output) never goes into the block entity.
 */
export function emptySlotNear(
  context: SlotContext,
  slots: Slots,
  slot: number,
  item: string,
): number {
  const part = partOf(context, slot);
  const stays = part < 2 || takes(context, slot, item);
  let inventory = -1;
  let opened = -1;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] || !takes(context, i, item)) continue;
    const there = partOf(context, i);
    if (there === part && stays) return i;
    if (there < 2) {
      if (inventory < 0) inventory = i;
    } else if (opened < 0 && part < 2) opened = i;
  }
  return inventory >= 0 ? inventory : opened;
}

/**
 * Moves `count` items (undefined: the whole stack) between two slots: an inventory move, or the
 * open block entity's move when either slot is one of its own (null in the bag alone).
 */
export function moveCommand(
  context: SlotContext,
  from: number,
  to: number,
  count?: number,
): SlotCommand | null {
  const counted = count === undefined ? {} : { count };
  if (from < context.base && to < context.base) return { type: 'inv.move', from, to, ...counted };
  return context.move ? { type: context.move, from, to, ...counted } : null;
}

/**
 * Shift+click: sends a whole stack across, hotbar ⇄ bag in the bag alone, else inventory ⇄ the open
 * block entity.
 */
export function quickMoveCommand(context: SlotContext, slot: number): SlotCommand {
  return context.move ? { type: context.move, from: slot } : { type: 'inv.quickMove', slot };
}

/**
 * The command a drag ends with: `count` items of slot `from` released over slot `to` (−1: over no
 * slot, which cancels). A split released on its own slot goes to the nearest empty slot that takes
 * it (emptySlotNear).
 */
export function dropCommand(
  context: SlotContext,
  slots: Slots,
  from: number,
  to: number,
  count: number,
): SlotCommand | null {
  const stack = slots[from];
  if (!stack) return null;
  const whole = count >= stack.count;
  const target = to === from && !whole ? emptySlotNear(context, slots, from, stack.item) : to;
  if (target < 0 || target === from) return null;
  return moveCommand(context, from, target, whole ? undefined : count);
}

/**
 * A hotbar number key pressed over a slot: swaps (or merges) the hovered stack with that hotbar
 * slot, or brings the hotbar stack to the hovered slot when it is empty.
 */
export function hotkeyCommand(
  context: SlotContext,
  slots: Slots,
  hovered: number,
  hotbarSlot: number,
): SlotCommand | null {
  if (hovered < 0 || hovered === hotbarSlot) return null;
  if (slots[hovered]) return moveCommand(context, hovered, hotbarSlot);
  if (slots[hotbarSlot]) return moveCommand(context, hotbarSlot, hovered);
  return null;
}
