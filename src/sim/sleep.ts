import type { SimEvent } from './events.ts';
import { eyeHeight } from './physics.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';
import { enclosedAt } from './shelter.ts';
import { adjustGauges } from './survival.ts';
import { dayOf, hourOf, nextHour, withinHours } from './time.ts';

/*
 * Sleeping on a bedroll (docs « Sommeil »): secondary on it between 19:30 and 05:00, in an
 * enclosed shelter, with no hostile creature within 16 blocks (creatures arrive with M10). The
 * clock skips to 06:00 for a night's hunger and thirst, and the bedroll becomes the player's
 * respawn point until it is broken. In this single-player version one sleeper skips the night.
 */

/** HUD hints of a refused sleep (engine i18n keys). */
export const SLEEP_NIGHT_HINT = 'hint.sleepNight';
export const SLEEP_SHELTER_HINT = 'hint.sleepShelter';

/** A player lies down on the bedroll at a cell: sleeps through the night, or is told why not. */
export function sleepOn(
  sim: Simulation,
  player: PlayerState,
  x: number,
  y: number,
  z: number,
  out: SimEvent[],
): void {
  const b = sim.registry.pack.balance;
  const hint = (key: string) =>
    out.push({ type: 'hint', playerId: player.playerId, key, params: {} });
  if (!withinHours(hourOf(sim.time.ticks), b.sleep.fromHour, b.sleep.toHour)) {
    hint(SLEEP_NIGHT_HINT);
    return;
  }
  const body = player.body;
  const head = Math.floor(body.y + eyeHeight(body));
  const tables = sim.registry.tables;
  if (!enclosedAt(sim.world, tables, Math.floor(body.x), head, Math.floor(body.z), b.shelter)) {
    hint(SLEEP_SHELTER_HINT);
    return;
  }
  sim.time.ticks = nextHour(sim.time.ticks, b.sleep.wakeHour);
  adjustGauges(player.survival, b, -b.sleep.hunger, -b.sleep.thirst, 0, 0);
  // The morning air is sampled again at once.
  player.survival.sampleTicks = 1;
  player.respawn = { x, y, z };
  out.push({ type: 'slept', playerId: player.playerId, day: dayOf(sim.time.ticks) });
}

/** A bedroll broken at a cell: no player comes back there any more. */
export function forgetBed(sim: Simulation, x: number, y: number, z: number): void {
  for (const player of sim.players.values()) {
    const bed = player.respawn;
    if (bed && bed.x === x && bed.y === y && bed.z === z) player.respawn = null;
  }
}
