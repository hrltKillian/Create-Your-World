import type { ObjectiveCondition } from '../content/schema.ts';
import { TICKS_PER_SECOND } from './clock.ts';
import { stationNear } from './craftQueue.ts';
import type { SimEvent } from './events.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';
import { nightsSurvived } from './time.ts';

/*
 * Objectives (docs « Objectifs jusqu'au fer », tick step 16): once a second, every objective of
 * the pack's chain a living player has not done yet is checked, and each whose condition holds is
 * done, in the order it was done. Items count once seen (so a step done ahead of the chain counts
 * as soon as the player gets there); stations, the shelter and the nights are read from the world
 * and the clock. Nothing is allocated.
 */

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
