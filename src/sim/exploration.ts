import { blockToColumn } from '../world/coords.ts';
import { TICKS_PER_SECOND } from './clock.ts';
import { reject } from './commandRules.ts';
import type { WaypointCommand } from './commands.ts';
import type { SimEvent } from './events.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';

/*
 * Exploration (plan v3 « M27 »): the columns a player has explored (within EXPLORE_RADIUS columns
 * of where they stood, noted once a second: the Map page draws them), and the waypoints they mark
 * (the compass shows them).
 */

/** Columns around the player's own that count as explored. */
export const EXPLORE_RADIUS = 2;
/** Most waypoints a player keeps. */
export const MAX_WAYPOINTS = 8;
/** Longest waypoint name. */
export const MAX_WAYPOINT_NAME = 24;

/** A place a player marked. */
export interface Waypoint {
  name: string;
  x: number;
  z: number;
}

/** The key of an explored column (`cx,cz`). */
export function exploredKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

/** Once a second: every living, active player explores the columns around them. */
export function stepExploration(sim: Simulation): void {
  if (sim.tick % TICKS_PER_SECOND !== 0) return;
  for (const player of sim.players.values()) {
    if (player.survival.dead || !sim.isActive(player)) continue;
    const pcx = blockToColumn(player.body.x);
    const pcz = blockToColumn(player.body.z);
    for (let dz = -EXPLORE_RADIUS; dz <= EXPLORE_RADIUS; dz++)
      for (let dx = -EXPLORE_RADIUS; dx <= EXPLORE_RADIUS; dx++) {
        const key = exploredKey(pcx + dx, pcz + dz);
        if (player.explored[key] !== true) player.explored[key] = true;
      }
  }
}

/** `waypoint.add` (at the player's feet, a name of their choice) and `waypoint.remove`. */
export function applyWaypointCommand(
  player: PlayerState,
  command: WaypointCommand,
  out: SimEvent[],
): void {
  if (command.type === 'waypoint.add') {
    const name = typeof command.name === 'string' ? command.name.trim() : '';
    if (player.waypoints.length >= MAX_WAYPOINTS || name.length > MAX_WAYPOINT_NAME) {
      reject(out, player.playerId, command.type, 'invalid');
      return;
    }
    const x = Math.floor(player.body.x);
    const z = Math.floor(player.body.z);
    player.waypoints.push({ name: name || `${x}, ${z}`, x, z });
  } else {
    const index = command.index;
    if (!Number.isInteger(index) || index < 0 || index >= player.waypoints.length) {
      reject(out, player.playerId, command.type, 'invalid');
      return;
    }
    player.waypoints.splice(index, 1);
  }
  out.push({ type: 'waypointsChanged', playerId: player.playerId });
}
