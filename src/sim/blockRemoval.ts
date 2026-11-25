import { blockItemKey } from '../content/items.ts';
import { hash32 } from '../core/hash.ts';
import { blockEntityAt, removeBlockEntity } from './blockEntities.ts';
import { noteRemoved } from './blockUpdates.ts';
import { forgetGrave } from './death.ts';
import { editBlock } from './edits.ts';
import type { SimEvent } from './events.ts';
import { spawnDrop } from './itemDrops.ts';
import { rollLoot } from './loot.ts';
import { otherHalfY } from './placement.ts';
import type { Simulation } from './Simulation.ts';
import { forgetBed } from './sleep.ts';

/*
 * Taking a block out of the world, the one way for a player's break and for the world's own
 * (a block losing its support, leaves decaying): its sound and event, its drops when harvested,
 * what its block entity held, what players kept about the cell, and the updates of its neighbours
 * (blockUpdates.ts) so that what it held up or anchored follows.
 */

/** The player id a block removed by the world (not by a player) is reported with. */
export const BY_WORLD = -1;

/**
 * The one hook for a block removed from the world (broken, filled over, taken back): what players
 * kept about the cell goes with it. A bedroll is no longer anyone's respawn point nor slept on; an
 * Abandoned Pack no longer marks a compass. `state` is the block the cell held. What its block
 * entity held is spilled by `removeBlockEntity` (blockEntities.ts).
 */
export function forgetCell(sim: Simulation, x: number, y: number, z: number, state: number): void {
  const kind = sim.registry.blockDef(state).blockEntity;
  if (kind === 'bed') forgetBed(sim, x, y, z);
  else if (kind === 'grave') forgetGrave(sim, x, y, z);
}

/**
 * Removes a block and, for a tall block (door), its other half too, which drops nothing (one item
 * for the whole door). `by` is the player who broke it, or BY_WORLD.
 */
export function removeWhole(
  sim: Simulation,
  by: number,
  x: number,
  y: number,
  z: number,
  harvest: boolean,
  out: SimEvent[],
): void {
  const other = otherHalfY(sim.world, sim.registry, x, y, z);
  removeBlock(sim, by, x, y, z, harvest, out);
  if (other !== y) removeBlock(sim, by, x, other, z, false, out);
}

/**
 * Removes a block, with its sound, event and (when harvested) its drops; what its block entity
 * held spills, harvested or not (a generated chest gets its loot first). Its neighbours are
 * updated (supports, leaves).
 */
export function removeBlock(
  sim: Simulation,
  by: number,
  x: number,
  y: number,
  z: number,
  harvest: boolean,
  out: SimEvent[],
): void {
  const registry = sim.registry;
  const state = sim.world.getBlock(x, y, z);
  const kept = blockEntityAt(sim, x, y, z) !== undefined;
  if (!editBlock(sim.world, sim.light, x, y, z, registry.air, out)) return;
  if (kept) removeBlockEntity(sim, x, y, z);
  forgetCell(sim, x, y, z, state);
  noteRemoved(sim, x, y, z, state);
  out.push({ type: 'blockBroken', playerId: by, x, y, z, state });
  const sfx = registry.blockSfx(state, 'break');
  if (sfx) out.push({ type: 'sound', sfx, x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  if (!harvest) return;
  const drops = registry.blockDef(state).drops;
  const give = (item: string, count: number) =>
    spawnDrop(sim, { item, count }, x + 0.5, y + 0.5, z + 0.5);
  if (drops === 'self') give(blockItemKey(registry.blockDef(state).key), 1);
  else if (drops !== 'none') {
    const table = registry.loot(drops);
    if (table) rollLoot(table, hash32(hash32(sim.ctx.seedHash, x, y, z), sim.tick), give);
  }
}
