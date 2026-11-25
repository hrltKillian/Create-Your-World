import type { Registry } from '../../content/registry.ts';
import type { Command, SlotCommand } from '../commands.ts';
import { type ItemStack, sameStack } from '../inventory.ts';

/*
 * The clicks bots, walks and automation send to move items on a slot screen as a player does
 * (sim/slotClicks.ts has the rules): every slot command needs a screen open, so a move in the
 * inventory alone goes through the Bag (`inBag`).
 */

/** A click on a slot of the open screen (left by default). */
export function slotClick(slot: number, button: 0 | 1 = 0, shift = false): SlotCommand {
  return { type: 'slot.click', slot, button, shift };
}

/** Shift+click: sends a slot's stack across (the rules of slotClicks.ts `quickMoveFrom`). */
export function shiftClick(slot: number): SlotCommand {
  return slotClick(slot, 0, true);
}

/**
 * The clicks that move `count` items (default: the whole stack) of the stack `stack` of slot
 * `from` to slot `to`, which holds `there` (empty, or the same item for part of a stack): a whole
 * stack is taken and put down, and what did not fit, or the stack it swapped with, goes back to
 * `from`; part of one is put down one item at a time, the rest put back.
 */
export function moveClicks(
  registry: Registry,
  from: number,
  to: number,
  stack: Readonly<ItemStack>,
  there: Readonly<ItemStack> | null | undefined,
  count = stack.count,
): SlotCommand[] {
  if (count < stack.count) {
    const clicks = [slotClick(from)];
    for (let i = 0; i < count; i++) clicks.push(slotClick(to, 1));
    clicks.push(slotClick(from));
    return clicks;
  }
  const room = registry.maxStack(stack.item) - (there?.count ?? 0);
  const whole = !there || (sameStack(there, stack) && stack.count <= room);
  return whole
    ? [slotClick(from), slotClick(to)]
    : [slotClick(from), slotClick(to), slotClick(from)];
}

/** Commands run with the Bag open: it opens first and closes last. */
export function inBag(...commands: Command[]): Command[] {
  return [{ type: 'screen.open', kind: 'bag' }, ...commands, { type: 'screen.close' }];
}
