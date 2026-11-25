import type { ObjectiveCondition } from '../content/schema.ts';
import { WORLD_HEIGHT } from '../world/coords.ts';
import { withinReach } from './blockEntities.ts';
import { TICKS_PER_SECOND } from './clock.ts';
import type { SimEvent } from './events.ts';
import { bodyHeight } from './physics.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';
import { nightsSurvived } from './time.ts';

/*
 * Objectives (docs « Objectifs jusqu'au fer », tick step 16): once a second, every objective of
 * the pack's chain a living player has not done yet is checked, and each whose condition holds is
 * done, in the order it was done. Items count once seen (so a step done ahead of the chain counts
 * as soon as the player gets there), and so does having drunk once; stations, the shelter and the
 * nights are read from the world and the clock. Nothing is allocated.
 */

/** An objective's station counts within this distance of the player (blocks). */
export const STATION_REACH = 4;

/**
 * Whether a block of a station stands within STATION_REACH of the player, for the objectives (the
 * cells around them are read: placed, generated or filled blocks all count, and nothing is left
 * to keep in sync).
 */
export function stationNear(sim: Simulation, player: PlayerState, station: string): boolean {
  const b = player.body;
  const r = STATION_REACH;
  const y0 = Math.max(0, Math.floor(b.y - r));
  const y1 = Math.min(WORLD_HEIGHT - 1, Math.floor(b.y + bodyHeight(b) + r));
  for (let x = Math.floor(b.x - r); x <= Math.floor(b.x + r); x++) {
    for (let z = Math.floor(b.z - r); z <= Math.floor(b.z + r); z++) {
      for (let y = y0; y <= y1; y++) {
        const def = sim.registry.blockDef(sim.world.getBlock(x, y, z));
        if (def.station === station && withinReach(player, x, y, z, r)) return true;
      }
    }
  }
  return false;
}

/** Whether every part of an objective's condition holds for a player now. */
export function conditionHolds(
  sim: Simulation,
  player: PlayerState,
  condition: ObjectiveCondition,
): boolean {
  const items = condition.items;
  if (items) for (const item of items) if (player.seen[item] !== true) return false;
  if (condition.nights !== undefined && nightsSurvived(sim.time.ticks) < condition.nights)
    return false;
  if (condition.enclosed && player.survival.shelter !== 'enclosed') return false;
  if (condition.drank && !player.drank) return false;
  const stations = condition.stations;
  if (stations)
    for (const station of stations) if (!stationNear(sim, player, station)) return false;
  return true;
}

/** Tick step 16: the objectives each active, living player has just done. */
export function stepObjectives(sim: Simulation, out: SimEvent[]): void {
  const chain = sim.registry.pack.objectives;
  if (!chain || sim.tick % TICKS_PER_SECOND !== 0) return;
  for (const player of sim.players.values()) {
    if (player.survival.dead || !sim.isActive(player)) continue;
    for (const objective of chain) {
      if (player.objectives.includes(objective.key)) continue;
      if (!conditionHolds(sim, player, objective.condition)) continue;
      player.objectives.push(objective.key);
      out.push({ type: 'objectiveDone', playerId: player.playerId, objective: objective.key });
    }
  }
}
