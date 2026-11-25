import { WAYPOINT_COLOURS, WAYPOINT_ICONS, type WaypointIcon } from '../core/waypoints.ts';
import { blockToColumn, insideBorder } from '../world/coords.ts';

export { WAYPOINT_COLOURS, WAYPOINT_ICONS, type WaypointIcon };

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

/** A place a player marked: its name, block column, symbol and colour (an index). */
export interface Waypoint {
  name: string;
  x: number;
  z: number;
  icon: WaypointIcon;
  colour: number;
}

/** Whether a value is a waypoint's symbol. */
export function isWaypointIcon(value: unknown): value is WaypointIcon {
  return WAYPOINT_ICONS.includes(value as WaypointIcon);
}

/** Whether a value is a waypoint's colour index. */
export function isWaypointColour(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < WAYPOINT_COLOURS;
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

/**
 * `waypoint.add` (a name, a symbol and a colour of the player's choice, at a block column they
 * picked on the map or at their feet) and `waypoint.remove`.
 */
export function applyWaypointCommand(
  player: PlayerState,
  command: WaypointCommand,
  out: SimEvent[],
): void {
  if (command.type === 'waypoint.add') {
    const name = typeof command.name === 'string' ? command.name.trim() : '';
    const x = command.x === undefined ? Math.floor(player.body.x) : command.x;
    const z = command.z === undefined ? Math.floor(player.body.z) : command.z;
    if (
      player.waypoints.length >= MAX_WAYPOINTS ||
      name.length > MAX_WAYPOINT_NAME ||
      !isWaypointIcon(command.icon) ||
      !isWaypointColour(command.colour) ||
      !Number.isInteger(x) ||
      !Number.isInteger(z) ||
      !insideBorder(x, z)
    ) {
      reject(out, player.playerId, command.type, 'invalid');
      return;
    }
    const icon = command.icon;
    player.waypoints.push({ name: name || `${x}, ${z}`, x, z, icon, colour: command.colour });
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
