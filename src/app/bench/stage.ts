import type { App } from '../App.ts';
import { clock, freezeTime, setTime, teleport, waitUntil } from '../automation.ts';
import { god } from '../survivalAutomation.ts';

/** The benchmarks' stage (selftests that travel use it too): teleports, a frozen hour, immunity. */

/** Longest wait for a teleport to be applied (the next tick with real ticks). */
const TELEPORT_MS = 5000;

/**
 * Teleports the player (feet at x, y, z; `'surface'` lands on the ground) and waits until the
 * simulation has applied it, so what follows reads the new place. Fixed steps apply it at once,
 * real ticks on the next one: pumped here while the page is hidden, where frames no longer tick.
 */
export async function teleportAndWait(
  app: App,
  x: number,
  y: number | 'surface',
  z: number,
): Promise<void> {
  const session = app.session;
  if (!session) throw new Error('No player');
  const body = session.player.body;
  teleport(app, x, y, z);
  await waitUntil(() => Math.abs(body.x - x) < 0.5 && Math.abs(body.z - z) < 0.5, {
    timeoutMs: TELEPORT_MS,
    label: `the teleport to (${x}, ${y}, ${z}) was not applied`,
    pump: () => session.pumpOnce(document.hidden),
    pollMs: 10,
  });
}

/**
 * Runs `run` with the world clock frozen at `hour` and the player immune, then puts the clock (its
 * hour and freeze flag) and the immunity back, even if it failed.
 */
export async function staged<T>(app: App, hour: number, run: () => Promise<T>): Promise<T> {
  const session = app.session;
  const time = clock(app);
  if (!session || !time) throw new Error('No world session');
  const immune = session.player.survival.god;
  try {
    setTime(app, hour);
    freezeTime(app, true);
    god(app, true);
    return await run();
  } finally {
    god(app, immune);
    setTime(app, time.hour);
    freezeTime(app, time.frozen);
  }
}
