import type { DebugStat } from '../sim/commands.ts';
import { serializeInventory } from '../sim/inventory.ts';
import type { DeathCause } from '../sim/survival.ts';
import { inBag, shiftClick } from '../sim/testing/slotMoves.ts';
import type { App } from './App.ts';
import { sendAndStep, sendNow } from './automation.ts';

/**
 * Survival automation (M9) shared by the debug hook and the selftests: the gauges, death and
 * immunity by debug command, worn items and what the player's
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

/**
 * The player's survival as automation reads it (null without a player): the gauges, exhaustion,
 * the last environment sample (felt °C, the
 * temperature's target, the air's toxicity per minute), death, immunity, the bedroll, the
 * Abandoned Packs, the quests and the worn items (head to feet).
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
    burning: s.burnTicks > 0,
    exhausted: player.exhausted,
    ambient: s.ambient,
    target: s.target,
    airToxicity: s.airToxicity,
    dead: s.dead,
    cause: s.cause,
    god: s.god,
    respawn: player.respawn && { ...player.respawn },
    graves: player.graves.map((cell) => ({ ...cell })),
    quests: structuredClone(player.quests),
    pinned: player.pinned,
    equipment: serializeInventory(player.equipment),
    bestiary: { ...player.bestiary },
    scan: { id: player.scanId, ticks: player.scanTicks },
  };
}
