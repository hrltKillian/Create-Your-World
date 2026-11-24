import { fuelSlotOf, stationAccepts } from '../content/crafting.ts';
import { cellKey } from '../world/coords.ts';
import {
  type BlockEntity,
  blockEntityAt,
  OPEN_REACH,
  type StationEntity,
  withinReach,
} from './blockEntities.ts';
import { reject, validBlockEntityCommand } from './commandRules.ts';
import { type BlockEntityCommand, OPEN_SLOTS_BASE, type SlotMove } from './commands.ts';
import type { SimEvent } from './events.ts';
import { INVENTORY_SLOTS, type Inventory, moveInto, moveStack, sameStack } from './inventory.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';
import { cellInSight } from './targeting.ts';

/**
 * The Container and Station screens on the simulation side: opening (one player at a time, within
 * 5 blocks and in sight), closing, atomic moves between the inventory and the open block entity,
 * and the open campfire's « Keep burning » toggle. A station takes anything in its inputs, only
 * fuel its fire burns in its fuel slot, and nothing in its outputs.
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
    case 'container.close':
      if (player.opened) closeBlockEntity(player, out);
      else reject(out, playerId, command.type, 'nothing open');
      break;
    case 'container.move':
    case 'station.move': {
      const refusal = moveWithOpened(sim, player, command);
      if (refusal) reject(out, playerId, command.type, refusal);
      else out.push({ type: 'inventoryChanged', playerId });
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
 * Opens the block entity of a cell for a player (closing theirs); returns the refusal, if any. The
 * cell must be within reach and in sight of the simulation's eye (`cellInSight`, the ray that
 * confirms a client target); `aimed`: secondary on the block, whose aim (targeting.ts `aim`) has
 * already confirmed that ray.
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
  if (!withinReach(player, x, y, z, OPEN_REACH)) return 'reach';
  if (!aimed && !cellInSight(sim.world, sim.registry.tables, player, x, y, z)) return 'sight';
  const entity = blockEntityAt(sim, x, y, z);
  // An Abandoned Pack has no screen: secondary takes it back (death.ts).
  if (!entity || entity.kind === 'grave') return 'nothing to open';
  for (const other of sim.players.values()) {
    const cell = other.opened;
    if (other !== player && cell && cell.x === x && cell.y === y && cell.z === z) return 'in use';
  }
  if (player.opened) closeBlockEntity(player, out);
  player.opened = { x, y, z };
  out.push({ type: 'blockEntityOpened', playerId: player.playerId, kind: entity.kind, x, y, z });
  return null;
}

export function closeBlockEntity(player: PlayerState, out: SimEvent[]): void {
  player.opened = null;
  out.push({ type: 'blockEntityClosed', playerId: player.playerId });
}

/** The block entity a player has open, if it is still there. */
export function openedEntity(sim: Simulation, player: PlayerState): BlockEntity | undefined {
  const cell = player.opened;
  return cell ? sim.blockEntities.get(cellKey(cell.x, cell.y, cell.z)) : undefined;
}

/** Tick step 9: closes the screen of a player who walked away or whose block entity is gone. */
export function checkOpened(sim: Simulation, player: PlayerState, out: SimEvent[]): void {
  const cell = player.opened;
  if (!cell) return;
  if (!openedEntity(sim, player) || !withinReach(player, cell.x, cell.y, cell.z, OPEN_REACH))
    closeBlockEntity(player, out);
}

/** Whether a station slot takes an item (content/crafting.ts `stationAccepts`). */
function accepts(sim: Simulation, station: StationEntity, slot: number, item: string): boolean {
  const crafting = sim.registry.crafting;
  const def = crafting.station(station.station);
  return def !== undefined && stationAccepts(crafting, def, slot, item);
}

/** Slots and index of a slot number of a move (null past the open block entity's slots). */
function side(player: PlayerState, entity: BlockEntity, slot: number): [Inventory, number] | null {
  if (slot < OPEN_SLOTS_BASE) return [player.inventory, slot];
  const index = slot - OPEN_SLOTS_BASE;
  return index < entity.slots.length ? [entity.slots, index] : null;
}

/** A move between the inventory and the open block entity; returns the refusal, if any. */
function moveWithOpened(
  sim: Simulation,
  player: PlayerState,
  command: SlotMove<'container.move' | 'station.move'>,
): string | null {
  const entity = openedEntity(sim, player);
  const kind = command.type === 'container.move' ? 'container' : 'station';
  if (!entity || entity.kind !== kind) return 'not open';
  const from = side(player, entity, command.from);
  if (!from) return 'invalid';
  const [source, index] = from;
  const stack = source[index];
  if (!stack) return 'nothing to move';
  if (command.to === undefined) return quickMoveOpened(sim, player, entity, source, index);
  const to = side(player, entity, command.to);
  if (!to) return 'invalid';
  const [target, slot] = to;
  if (entity.kind === 'station') {
    const there = target[slot];
    // A swap puts the target's stack in the source slot: both slots must take what they get.
    const swap = there !== null && there !== undefined && !sameStack(there, stack);
    if (target === entity.slots && !accepts(sim, entity, slot, stack.item)) return 'slot';
    if (swap && source === entity.slots && !accepts(sim, entity, index, there.item)) return 'slot';
  }
  const moved = moveStack(sim.registry, source, index, target, slot, command.count);
  return moved ? null : 'nothing to move';
}

/**
 * Sends a whole stack to the other side: into the inventory (hotbar first), or into the open block
 * entity (a station: intoStation). Returns the refusal, if any.
 */
function quickMoveOpened(
  sim: Simulation,
  player: PlayerState,
  entity: BlockEntity,
  source: Inventory,
  index: number,
): string | null {
  const registry = sim.registry;
  let moved: boolean;
  if (source === entity.slots)
    moved = moveInto(registry, source, index, player.inventory, 0, INVENTORY_SLOTS);
  else if (entity.kind !== 'station')
    moved = moveInto(registry, source, index, entity.slots, 0, entity.slots.length);
  else return intoStation(sim, entity, source, index);
  return moved ? null : 'nothing to move';
}

/**
 * Shift+click into a station: its fuel slot first when its fire burns the item, then its inputs
 * when one of its processes uses it. Anything else stays in the inventory ('slot').
 */
function intoStation(
  sim: Simulation,
  station: StationEntity,
  source: Inventory,
  index: number,
): string | null {
  const registry = sim.registry;
  const def = registry.crafting.station(station.station);
  if (!def) return 'slot';
  const item = source[index]!.item;
  const fuel = fuelSlotOf(def);
  const burns = fuel >= 0 && stationAccepts(registry.crafting, def, fuel, item);
  const feeds = registry.crafting.feeds(def, item);
  if (!burns && !feeds) return 'slot';
  let moved = burns && moveInto(registry, source, index, station.slots, fuel, fuel + 1);
  if (feeds && source[index])
    moved = moveInto(registry, source, index, station.slots, 0, def.inputSlots) || moved;
  return moved ? null : 'nothing to move';
}
