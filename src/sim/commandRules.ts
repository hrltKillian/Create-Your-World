import { HOTBAR_SLOTS } from '../core/player.ts';
import { insideBorder } from '../world/coords.ts';
import type { ClientTarget, Command, InputCommand, InventoryCommand } from './commands.ts';
import type { SimEvent } from './events.ts';
import { INVENTORY_SLOTS } from './inventory.ts';

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

const slotOk = (slot: number) => Number.isInteger(slot) && slot >= 0 && slot < INVENTORY_SLOTS;

/** Shape and ranges of an inventory command (slots, counts): commands may come from a network. */
export function validInventoryCommand(c: InventoryCommand): boolean {
  switch (c.type) {
    case 'inv.move':
      return (
        slotOk(c.from) &&
        slotOk(c.to) &&
        (c.count === undefined || (Number.isInteger(c.count) && c.count >= 1))
      );
    case 'inv.quickMove':
      return slotOk(c.slot);
    case 'inv.drop':
      return slotOk(c.slot) && typeof c.all === 'boolean';
  }
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
