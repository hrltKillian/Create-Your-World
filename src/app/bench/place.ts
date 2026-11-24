import type { App } from '../App.ts';
import { teleport, waitUntil } from '../automation.ts';

/** Longest wait for a teleport to be applied (the next tick with real ticks). */
const TELEPORT_MS = 5000;

/**
 * Teleports the player (feet at x, y, z) and waits until the simulation has applied it, so what
 * follows reads the new place (fixed steps apply it at once).
 */
export async function teleportAndWait(app: App, x: number, y: number, z: number): Promise<void> {
  const body = app.session?.player.body;
  if (!body) throw new Error('No player');
  teleport(app, x, y, z);
  await waitUntil(() => Math.abs(body.x - x) < 0.5 && Math.abs(body.z - z) < 0.5, {
    timeoutMs: TELEPORT_MS,
    label: `the teleport to (${x}, ${y}, ${z}) was not applied`,
    pollMs: 10,
  });
}
