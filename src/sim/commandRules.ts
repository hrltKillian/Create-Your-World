import { HOTBAR_SLOTS } from '../core/player.ts';
import { insideBorder } from '../world/coords.ts';
import type { Command, InputCommand } from './commands.ts';
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
    c.slot < HOTBAR_SLOTS
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
