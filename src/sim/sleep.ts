import { hostileNear } from './creatures.ts';
import type { SimEvent } from './events.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';
import { shelterOfBody } from './shelter.ts';
import { adjustGauges } from './survival.ts';
import { dayOf, hourOf, nextHour, withinHours } from './time.ts';

/*
 * Sleeping on a bedroll (docs « Sommeil »): secondary on it between 19:30 and 05:00, in an
 * enclosed shelter, with no hostile creature within 16 blocks (`sleep.hostileRadius`). The
 * player then lies on it (`sleeping`); the rule is `allPlayersSleeping`: once every living,
 * active player lies on a bedroll, the clock skips to 06:00, each sleeper pays a night's hunger
 * and thirst and wakes with that bedroll as their respawn point (until it is broken). Moving,
 * taking damage, dying, leaving the shelter, a hostile coming near or the end of the night gets
 * a sleeper up again.
 */

/** HUD hints of a refused or pending sleep (engine i18n keys). */
export const SLEEP_NIGHT_HINT = 'hint.sleepNight';
export const SLEEP_SHELTER_HINT = 'hint.sleepShelter';
export const SLEEP_WAIT_HINT = 'hint.sleepWait';
export const SLEEP_HOSTILES_HINT = 'hint.sleepHostiles';

/** Whether the clock stands within the sleeping hours. */
function sleepingHours(sim: Simulation): boolean {
  const b = sim.registry.pack.balance.sleep;
  return withinHours(hourOf(sim.time.ticks), b.fromHour, b.toHour);
}

/** A player lies down on the bedroll at a cell: sleeps, or is told why not. */
export function sleepOn(
  sim: Simulation,
  player: PlayerState,
  x: number,
  y: number,
  z: number,
  out: SimEvent[],
): void {
  const hint = (key: string) =>
    out.push({ type: 'hint', playerId: player.playerId, key, params: {} });
  player.sleeping = null;
  if (!sleepingHours(sim)) {
    hint(SLEEP_NIGHT_HINT);
    return;
  }
  const rules = sim.registry.pack.balance.shelter;
  if (shelterOfBody(sim.world, sim.registry.tables, player.body, rules) !== 'enclosed') {
    hint(SLEEP_SHELTER_HINT);
    return;
  }
  if (hostileNearBody(sim, player)) {
    hint(SLEEP_HOSTILES_HINT);
    return;
  }
  player.sleeping = { x, y, z, health: player.survival.health };
  // The shelter is sampled again this tick, before the sleepers are checked: stepSleep alone ends
  // the night, once the other sleepers' commands of this tick have been applied too.
  player.survival.sampleTicks = 1;
  if (!allPlayersSleeping(sim)) hint(SLEEP_WAIT_HINT);
}

/** Whether a hostile creature stands within the sleep radius of a player. */
function hostileNearBody(sim: Simulation, player: PlayerState): boolean {
  const body = player.body;
  return hostileNear(sim, body.x, body.y, body.z, sim.registry.pack.balance.sleep.hostileRadius);
}

/** Whether a player takes part in the sleep rule: alive and in a lit column. */
function counts(sim: Simulation, player: PlayerState): boolean {
  return !player.survival.dead && player.survival.health > 0 && sim.isActive(player);
}

/** `allPlayersSleeping`: someone sleeps and every living, active player does. */
export function allPlayersSleeping(sim: Simulation): boolean {
  let sleepers = 0;
  for (const player of sim.players.values()) {
    if (!counts(sim, player)) continue;
    if (!player.sleeping) return false;
    sleepers++;
  }
  return sleepers > 0;
}

/** The night passes: the clock skips to the wake hour and every sleeper wakes up. */
function wake(sim: Simulation, out: SimEvent[]): void {
  const b = sim.registry.pack.balance;
  sim.time.ticks = nextHour(sim.time.ticks, b.sleep.wakeHour);
  const day = dayOf(sim.time.ticks);
  for (const player of sim.players.values()) {
    const bed = player.sleeping;
    if (!bed) continue;
    player.sleeping = null;
    adjustGauges(player.survival, b, -b.sleep.hunger, -b.sleep.thirst, 0, 0);
    // The morning air is sampled again at once.
    player.survival.sampleTicks = 1;
    player.respawn = { x: bed.x, y: bed.y, z: bed.z };
    out.push({ type: 'slept', playerId: player.playerId, day });
  }
}

/** Whether something got a sleeper up: moving, damage, death, the shelter, a hostile, morning. */
function disturbed(sim: Simulation, player: PlayerState): boolean {
  const bed = player.sleeping!;
  const s = player.survival;
  const input = player.input;
  if (s.dead || s.health < bed.health) return true;
  if (input.forward !== 0 || input.strafe !== 0 || input.jump) return true;
  return s.shelter !== 'enclosed' || !sleepingHours(sim) || hostileNearBody(sim, player);
}

/**
 * Tick step 14, after the deaths: sleepers that were disturbed get up, and the night passes once
 * every living, active player sleeps (one of them died, left or got up meanwhile).
 */
export function stepSleep(sim: Simulation, out: SimEvent[]): void {
  let any = false;
  for (const player of sim.players.values()) {
    const bed = player.sleeping;
    if (!bed) continue;
    if (disturbed(sim, player)) player.sleeping = null;
    else {
      bed.health = player.survival.health;
      any = true;
    }
  }
  if (any && allPlayersSleeping(sim)) wake(sim, out);
}

/** A bedroll broken at a cell: no player comes back, nor lies, there any more. */
export function forgetBed(sim: Simulation, x: number, y: number, z: number): void {
  for (const player of sim.players.values()) {
    const bed = player.respawn;
    if (bed && bed.x === x && bed.y === y && bed.z === z) player.respawn = null;
    const lying = player.sleeping;
    if (lying && lying.x === x && lying.y === y && lying.z === z) player.sleeping = null;
  }
}
