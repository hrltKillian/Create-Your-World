import { blockEntityAt, OPEN_REACH, withinReach } from './blockEntities.ts';
import { reject, validBlockEntityCommand } from './commandRules.ts';
import type { BlockEntityCommand } from './commands.ts';
import type { SimEvent } from './events.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';
import { closeScreen, openedEntity } from './screens.ts';
import { cellInSight } from './targeting.ts';

/**
 * The Container and Station screens on the simulation side: opening one (one player at a time,
 * within 5 blocks and in sight) and the open campfire's « Keep burning » toggle. Closing, the
 * cursor and the clicks are the slot screens' (screens.ts, slotClicks.ts).
 */

export function applyBlockEntityCommand(
  sim: Simulation,
  player: PlayerState,
  command: BlockEntityCommand,
  out: SimEvent[],
): void {
  const playerId = player.playerId;
  if (!validBlockEntityCommand(command)) {
    reject(out, playerId, command.type, 'invalid');
    return;
  }
  switch (command.type) {
    case 'container.open': {
      const refusal = openBlockEntity(sim, player, command.x, command.y, command.z, out);
      if (refusal) reject(out, playerId, command.type, refusal);
      break;
    }
    case 'station.keepLit': {
      const refusal = toggleKeepLit(sim, player);
      if (refusal) reject(out, playerId, command.type, refusal);
      break;
    }
  }
}

/**
 * Turns the open station's « Keep burning » on or off (kept, its fire burns while it has fuel
 * without a process); returns the refusal, if any.
 */
function toggleKeepLit(sim: Simulation, player: PlayerState): string | null {
  const entity = openedEntity(sim, player);
  if (entity?.kind !== 'station') return 'not open';
  if (sim.registry.crafting.station(entity.station)?.keepLit !== true) return 'invalid';
  entity.keepLit = !entity.keepLit;
  return null;
}

/**
 * Opens the block entity of a cell for a living player (closing the screen they had open:
 * screens.ts `closeScreen`); returns the refusal, if any. The cell must be within reach and in
 * sight of the simulation's eye (`cellInSight`, the ray that confirms a client target); `aimed`:
 * secondary on the block, whose aim (targeting.ts `aim`) has already confirmed that ray.
 */
export function openBlockEntity(
  sim: Simulation,
  player: PlayerState,
  x: number,
  y: number,
  z: number,
  out: SimEvent[],
  aimed = false,
): string | null {
  if (player.survival.dead) return 'dead';
  if (!withinReach(player, x, y, z, OPEN_REACH)) return 'reach';
  if (!aimed && !cellInSight(sim.world, sim.registry.tables, player, x, y, z)) return 'sight';
  const entity = blockEntityAt(sim, x, y, z);
  // An Abandoned Pack has no screen: secondary takes it back (death.ts).
  if (!entity || entity.kind === 'grave') return 'nothing to open';
  for (const other of sim.players.values()) {
    const open = other.screen;
    if (other !== player && open?.kind === 'block' && open.x === x && open.y === y && open.z === z)
      return 'in use';
  }
  closeScreen(sim, player, out);
  player.screen = { kind: 'block', x, y, z };
  out.push({ type: 'blockEntityOpened', playerId: player.playerId, kind: entity.kind, x, y, z });
  return null;
}
