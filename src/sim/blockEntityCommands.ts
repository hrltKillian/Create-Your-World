import { fuelSlotOf } from '../content/crafting.ts';
import { cellKey } from '../world/coords.ts';
import {
  type BlockEntity,
  blockEntityAt,
  OPEN_REACH,
  type StationEntity,
  withinReach,
} from './blockEntities.ts';
import { reject, validBlockEntityCommand } from './commandRules.ts';
import { type BlockEntityCommand, type BlockEntityMove, OPEN_SLOTS_BASE } from './commands.ts';
import type { SimEvent } from './events.ts';
import { INVENTORY_SLOTS, type Inventory, moveInto, moveStack, sameStack } from './inventory.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';

/**
 * The Container and Station screens on the simulation side: opening (one player at a time, within
 * 5 blocks), closing, and atomic moves between the inventory and the open block entity. A station
 * takes anything in its inputs, only fuel in its fuel slot, and nothing in its outputs.
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
  }
}

/** Opens the block entity of a cell for a player (closing theirs); returns the refusal, if any. */
export function openBlockEntity(
  sim: Simulation,
  player: PlayerState,
  x: number,
  y: number,
  z: number,
  out: SimEvent[],
): string | null {
  if (!withinReach(player, x, y, z, OPEN_REACH)) return 'reach';
  const entity = blockEntityAt(sim, x, y, z);
  if (!entity) return 'nothing to open';
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

/** Whether a station slot takes an item: inputs anything, the fuel slot fuel, outputs nothing. */
function accepts(sim: Simulation, station: StationEntity, slot: number, item: string): boolean {
  const def = sim.registry.crafting.station(station.station);
  if (!def) return false;
  if (slot < def.inputSlots) return true;
  return slot === fuelSlotOf(def) && sim.registry.crafting.burnSeconds(item, 'any') > 0;
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
  command: BlockEntityMove<'container.move' | 'station.move'>,
): string | null {
  const entity = openedEntity(sim, player);
  const kind = command.type === 'container.move' ? 'container' : 'station';
  if (!entity || entity.kind !== kind) return 'not open';
  const from = side(player, entity, command.from);
  if (!from) return 'invalid';
  const [source, index] = from;
  const stack = source[index];
  if (!stack) return 'nothing to move';
  if (command.to === undefined)
    return quickMoveOpened(sim, player, entity, source, index) ? null : 'nothing to move';
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
 * entity (a station: fuel into its fuel slot first, then its inputs).
 */
function quickMoveOpened(
  sim: Simulation,
  player: PlayerState,
  entity: BlockEntity,
  source: Inventory,
  index: number,
): boolean {
  const registry = sim.registry;
  if (source === entity.slots)
    return moveInto(registry, source, index, player.inventory, 0, INVENTORY_SLOTS);
  if (entity.kind === 'container')
    return moveInto(registry, source, index, entity.slots, 0, entity.slots.length);
  const def = registry.crafting.station(entity.station);
  if (!def) return false;
  const fuel = fuelSlotOf(def);
  const stack = source[index]!;
  let moved = false;
  if (fuel >= 0 && accepts(sim, entity, fuel, stack.item))
    moved = moveInto(registry, source, index, entity.slots, fuel, fuel + 1);
  if (source[index])
    moved = moveInto(registry, source, index, entity.slots, 0, def.inputSlots) || moved;
  return moved;
}
