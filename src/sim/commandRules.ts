import { HOTBAR_SLOTS } from '../core/player.ts';
import { insideBorder, WORLD_HEIGHT } from '../world/coords.ts';
import type {
  BlockEntityCommand,
  ClientTarget,
  Command,
  InputCommand,
  InventoryCommand,
  ScreenCommand,
  SlotCommand,
} from './commands.ts';
import type { SimEvent } from './events.ts';

/** Rejects non-finite numbers and out-of-range axes or slots (commands may come from a network). */
export function validInput(c: InputCommand): boolean {
  return (
    Number.isFinite(c.forward) &&
    Number.isFinite(c.strafe) &&
    Number.isFinite(c.yaw) &&
    Number.isFinite(c.pitch) &&
    Math.abs(c.forward) <= 1 &&
    Math.abs(c.strafe) <= 1 &&
    Math.abs(c.pitch) <= Math.PI / 2 &&
    Number.isInteger(c.slot) &&
    c.slot >= 0 &&
    c.slot < HOTBAR_SLOTS &&
    (c.target === undefined || validTarget(c.target))
  );
}

/** A client target names a whole block cell inside the world border and a face 0–5. */
function validTarget(t: ClientTarget | null): boolean {
  return (
    typeof t === 'object' &&
    t !== null &&
    Number.isInteger(t.x) &&
    Number.isInteger(t.y) &&
    Number.isInteger(t.z) &&
    insideBorder(t.x, t.z) &&
    Number.isInteger(t.face) &&
    t.face >= 0 &&
    t.face <= 5
  );
}

/**
 * Shape and ranges of an inventory command (a slot of an inventory of `size`): commands may come
 * from a network.
 */
export function validInventoryCommand(c: InventoryCommand, size: number): boolean {
  return whole(c.slot, 0, size - 1) && typeof c.all === 'boolean';
}

/** An integer within [min, max]. */
export const whole = (v: unknown, min: number, max: number): boolean =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** Largest slot number a slot command may name (the open block entity's slots included). */
const MAX_SLOT = 255;

/** Shape of a block entity command: a cell inside the world. */
export function validBlockEntityCommand(c: BlockEntityCommand): boolean {
  return c.type === 'container.open' ? validCell(c) : true;
}

/** Shape of a screen command: the Bag is the only screen a command opens without a cell. */
export function validScreenCommand(c: ScreenCommand): boolean {
  return c.type === 'screen.close' || c.kind === 'bag';
}

/**
 * Shape and ranges of a slot command: a slot number that may name the open screen's slots
 * (checked against them when applied; −1 outside the panel, for a click), a button 0 or 1, a
 * hotbar slot.
 */
export function validSlotCommand(c: SlotCommand): boolean {
  if (c.type === 'slot.hotkey')
    return whole(c.slot, 0, MAX_SLOT) && whole(c.hotbar, 0, HOTBAR_SLOTS - 1);
  return (
    whole(c.slot, -1, MAX_SLOT) &&
    (c.button === 0 || c.button === 1) &&
    typeof c.shift === 'boolean'
  );
}

/** A whole block cell inside the world (container.open, debug.open). */
export function validCell(c: { readonly x: number; readonly y: number; readonly z: number }) {
  return (
    whole(c.x, -Infinity, Infinity) &&
    whole(c.y, 0, WORLD_HEIGHT - 1) &&
    whole(c.z, -Infinity, Infinity) &&
    insideBorder(c.x, c.z)
  );
}

/** A view centre must be finite and inside the world border. */
export function validView(c: Extract<Command, { type: 'client.view' }>): boolean {
  return finite(c.x, c.z, c.radius) && insideBorder(c.x, c.z);
}

export function finite(...values: number[]): boolean {
  for (const v of values) if (!Number.isFinite(v)) return false;
  return true;
}

/** Tells a client that one of its commands was refused, and why. */
export function reject(
  out: SimEvent[],
  playerId: number,
  command: Command['type'],
  reason: string,
): void {
  out.push({ type: 'rejected', playerId, command, reason });
}
