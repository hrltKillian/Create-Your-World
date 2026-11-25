import type { DebugStat } from '../sim/commands.ts';
import { serializeInventory } from '../sim/inventory.ts';
import { type Shelter, shelterOfBody } from '../sim/shelter.ts';
import type { DeathCause } from '../sim/survival.ts';
import { inBag, shiftClick } from '../sim/testing/slotMoves.ts';
import type { App } from './App.ts';
import { sendAndStep, sendNow } from './automation.ts';
import { hudEffects } from './hudModel.ts';

/**
 * Survival automation (M9) shared by the debug hook and the selftests: the gauges, death and
 * immunity by debug command, worn items, the shelter test at the player and what the player's
 * survival state reads.
 */

/** Sets a gauge (stamina or a survival gauge), clamped to its range, now, without a tick. */
export function setStat(app: App, stat: DebugStat, value: number): void {
  sendNow(app, { type: 'debug.setStat', stat, value });
}

/** Takes all the player's health for a cause; fixed-step sessions apply it now, death included. */
export function kill(app: App, cause: DeathCause): void {
  sendAndStep(app, { type: 'debug.kill', cause });
}

/** Makes the player immune to damage (the gauges still move), or mortal again, now. */
export function god(app: App, on: boolean): void {
  sendNow(app, { type: 'debug.god', on });
}

/**
 * Shift+click of a slot in the Bag, opened for it in the simulation when no screen is: puts a
 * wearable on (swapping what was worn), takes a worn item (slots 64–68) off; fixed-step sessions
 * apply it now.
 */
export function equip(app: App, slot: number): void {
  const click = shiftClick(slot);
  sendAndStep(app, ...(app.session?.player.screen ? [click] : inBag(click)));
}

/** The shelter test of docs « Abri » at the player's head, now (null without a player). */
export function shelterHere(app: App): Shelter | null {
  const session = app.session;
  if (!session) return null;
  const { world, registry } = session.host.view;
  return shelterOfBody(world, registry.tables, session.player.body, registry.pack.balance.shelter);
}

/**
 * The player's survival as automation reads it (null without a player): the gauges, the statuses
 * and timed effects as the HUD lists them, the last environment sample (shelter, felt °C, the
 * temperature's target, the air's toxicity per minute), death, immunity, the bedroll, the
 * Abandoned Packs, the objectives done and the worn items (head to feet).
 */
export function playerStats(app: App) {
  const session = app.session;
  if (!session) return null;
  const player = session.player;
  const s = player.survival;
  return {
    health: s.health,
    hunger: s.hunger,
    thirst: s.thirst,
    stamina: player.stamina,
    temperature: s.temperature,
    toxicity: s.toxicity,
    breath: s.breath,
    effects: hudEffects(player, session.host.view.registry.pack.balance, []),
    shelter: s.shelter,
    ambient: s.ambient,
    target: s.target,
    airToxicity: s.airToxicity,
    dead: s.dead,
    cause: s.cause,
    god: s.god,
    respawn: player.respawn && { ...player.respawn },
    graves: player.graves.map((cell) => ({ ...cell })),
    objectives: [...player.objectives],
    equipment: serializeInventory(player.equipment),
    bestiary: { ...player.bestiary },
    scan: { id: player.scanId, ticks: player.scanTicks },
  };
}
