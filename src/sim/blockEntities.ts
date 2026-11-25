import { stationSlotCount } from '../content/crafting.ts';
import { hash32 } from '../core/hash.ts';
import { cellKey } from '../world/coords.ts';
import { structureLootAt } from '../world/gen/structures.ts';
import type { CraftEntry } from './craftQueue.ts';
import { addItem, type Inventory } from './inventory.ts';
import { spawnDrop } from './itemDrops.ts';
import { rollLoot } from './loot.ts';
import { bodyHeight } from './physics.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';

/**
 * Block entities (docs « Inventaire », « Stations de transformation », « Craft : le Logbook »,
 * « Mort »): the state a block keeps besides its voxel, plain JSON saved with its column. A chest
 * holds 18 slots; a station (campfire, kiln, bloomery) its inputs, fuel and outputs with its fire
 * and progress (stepped by stations.ts); a workbench its craft queue and outputs (workbench.ts);
 * an Abandoned Pack (`grave`) what a dead player carried (death.ts makes it). They live in
 * `Simulation.blockEntities` by cell key, loaded or not, like item drops. A placed block gets an
 * empty one, so does an older save's workbench when first opened; a generated chest gets its
 * structure's loot the first time anyone opens or breaks it. This module only stores them and
 * spills what one holds when its block goes.
 */

/** Slots of a container block (a chest). */
export const CONTAINER_SLOTS = 18;
/** A player opens a block entity within this distance (blocks). */
export const OPEN_REACH = 5;
const SALT_LOOT = 61;

export interface ContainerEntity {
  readonly kind: 'container';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  slots: Inventory;
}

export interface StationEntity {
  readonly kind: 'station';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Station key (the block's `station`). */
  readonly station: string;
  /** Inputs, the fuel slot, then the outputs (content/crafting.ts `fuelSlotOf`, `outputSlotOf`). */
  slots: Inventory;
  /** Ticks the fuel item now burning has left, and its full burn (the flame gauge). */
  burnTicksLeft: number;
  burnTicks: number;
  /** Ticks spent on `process`, which restarts whenever the inputs call for another one. */
  progressTicks: number;
  /** Key of the process the inputs call for ('' when none). */
  process: string;
  /** Burned during the last tick: drives the block's `lit` state (light and heat). */
  lit: boolean;
  /**
   * Kept burning without a process while it has fuel (warmth, light): the « Keep burning » toggle
   * of a station whose fire allows it (`StationDef.keepLit`), off for a new one.
   */
  keepLit: boolean;
  /** Last tick simulated: a station outside the simulation radius catches up from it. */
  tick: number;
}

/**
 * A workbench: the crafts of its station's recipes, queued by whoever has it open (their
 * ingredients reserved in the entries, as in a player's queue), done into its outputs.
 */
export interface WorkbenchEntity {
  readonly kind: 'workbench';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Station key (the block's `station`): the recipes made here are this station's. */
  readonly station: string;
  /** The outputs (`StationDef.outputSlots`): the crafts done wait here; full ones pause the queue. */
  slots: Inventory;
  /** The craft queue (CRAFT_QUEUE entries, merged like a player's: craftQueue.ts). */
  craft: CraftEntry[];
  /** Last tick simulated: a workbench outside the simulation radius catches up from it. */
  tick: number;
}

/**
 * An Abandoned Pack: every stack a dead player carried, the worn items apart (they go back on
 * where they were worn).
 */
export interface GraveEntity {
  readonly kind: 'grave';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The inventory and the craft queue's reserved ingredients: as many slots as stacks. */
  slots: Inventory;
  /** What was worn, one slot per `WEAR_SLOTS` entry (head to feet). */
  worn: Inventory;
}

export type BlockEntity = ContainerEntity | StationEntity | WorkbenchEntity | GraveEntity;

/**
 * Whether a block cell lies within `reach` blocks of a player: from the middle of the body to the
 * nearest point of the cell.
 */
export function withinReach(
  player: PlayerState,
  x: number,
  y: number,
  z: number,
  reach: number,
): boolean {
  const b = player.body;
  const cy = b.y + bodyHeight(b) / 2;
  const dx = Math.max(x, Math.min(x + 1, b.x)) - b.x;
  const dy = Math.max(y, Math.min(y + 1, cy)) - cy;
  const dz = Math.max(z, Math.min(z + 1, b.z)) - b.z;
  return dx * dx + dy * dy + dz * dz <= reach * reach;
}

/**
 * The block entity of a cell, created when its block keeps one and has none yet (a generated
 * chest: filled from its structure's loot table). Undefined for other blocks and unloaded cells.
 */
export function blockEntityAt(
  sim: Simulation,
  x: number,
  y: number,
  z: number,
): BlockEntity | undefined {
  return sim.blockEntities.get(cellKey(x, y, z)) ?? createBlockEntity(sim, x, y, z, true);
}

/** A new block entity for the block at a cell (empty unless `generated` and a structure's). */
export function createBlockEntity(
  sim: Simulation,
  x: number,
  y: number,
  z: number,
  generated: boolean,
): BlockEntity | undefined {
  const def = sim.registry.blockDef(sim.world.getBlock(x, y, z));
  const station =
    def.station === undefined ? undefined : sim.registry.crafting.station(def.station);
  let entity: BlockEntity;
  if (def.blockEntity === 'container') {
    entity = { kind: 'container', x, y, z, slots: emptySlots(CONTAINER_SLOTS) };
    if (generated) fillFromStructure(sim, entity);
  } else if (def.blockEntity === 'workbench' && station) {
    const slots = emptySlots(station.outputSlots);
    entity = { kind: 'workbench', x, y, z, station: station.key, slots, craft: [], tick: sim.tick };
  } else if (def.blockEntity === 'station' && station) {
    entity = {
      kind: 'station',
      x,
      y,
      z,
      station: station.key,
      slots: emptySlots(stationSlotCount(station)),
      burnTicksLeft: 0,
      burnTicks: 0,
      progressTicks: 0,
      process: '',
      lit: false,
      keepLit: false,
      tick: sim.tick,
    };
  } else {
    return undefined;
  }
  sim.blockEntities.set(cellKey(x, y, z), entity);
  return entity;
}

/**
 * Removes the block entity of a cell, if any, spilling its items around the cell's centre (a
 * workbench's queued ingredients too: they come back to whoever picks them up; what else a
 * removed block leaves behind is `forgetCell`'s).
 */
export function removeBlockEntity(sim: Simulation, x: number, y: number, z: number): void {
  const key = cellKey(x, y, z);
  const entity = sim.blockEntities.get(key);
  if (!entity) return;
  sim.blockEntities.delete(key);
  spill(sim, entity.slots, x, y, z);
  if (entity.kind === 'grave') spill(sim, entity.worn, x, y, z);
  if (entity.kind === 'workbench')
    for (const entry of entity.craft) spill(sim, entry.reserved, x, y, z);
}

/** Drops the stacks of a slot array around a cell's centre. */
export function spill(sim: Simulation, slots: Inventory, x: number, y: number, z: number): void {
  for (const stack of slots) if (stack) spawnDrop(sim, stack, x + 0.5, y + 0.5, z + 0.5);
}

function emptySlots(count: number): Inventory {
  return new Array<null>(count).fill(null);
}

/** Rolls the loot table of a structure chest (the same roll whenever it is first opened). */
function fillFromStructure(sim: Simulation, chest: ContainerEntity): void {
  const { x, y, z } = chest;
  const table = sim.registry.loot(structureLootAt(sim.ctx, x, y, z) ?? '');
  if (!table) return;
  const seed = hash32(hash32(sim.ctx.seedHash, x, y, z), SALT_LOOT);
  rollLoot(table, seed, (item, count) => {
    addItem(chest.slots, sim.registry, { item, count });
  });
}
