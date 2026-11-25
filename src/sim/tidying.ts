import type { Registry } from '../content/registry.ts';
import { HOTBAR_SLOTS } from '../core/player.ts';
import { cellKey } from '../world/coords.ts';
import type { BlockEntity, ContainerEntity } from './blockEntities.ts';
import { reject } from './commandRules.ts';
import type { TidyCommand } from './commands.ts';
import type { SimEvent } from './events.ts';
import { addToRange, type Inventory, type ItemStack, pileOnto } from './inventory.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';
import { openedEntity } from './screens.ts';

/*
 * Inventory comfort (plan v3 « M32 »): the bag (or the open chest) sorted, its stacks merged; the
 * bag's items stacked into the chests nearby that already hold them; and the chests near a
 * workbench lending their ingredients to its recipes (craftQueue.ts).
 */

/** Chests within this many blocks (on each axis) of the player take a quick stack. */
export const STACK_RADIUS = 6;
/** Chests within this many blocks (on each axis) of a workbench lend it their ingredients. */
export const BENCH_RADIUS = 6;

/** A block entity at a cell (the simulation's, or a view's of it). */
export type EntityAt = (x: number, y: number, z: number) => Readonly<BlockEntity> | undefined;

/** The block entities of a simulation by cell. */
export function entityAt(sim: Simulation): EntityAt {
  return (x, y, z) => sim.blockEntities.get(cellKey(x, y, z));
}

/**
 * The chests within `radius` blocks of a cell on each axis, in a fixed order (y, then z, then x)
 * whatever the order they were opened in.
 */
export function chestsNear(
  at: EntityAt,
  x: number,
  y: number,
  z: number,
  radius: number,
): ContainerEntity[] {
  const out: ContainerEntity[] = [];
  for (let dy = -radius; dy <= radius; dy++)
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        const entity = at(x + dx, y + dy, z + dz);
        if (entity?.kind === 'container') out.push(entity as ContainerEntity);
      }
  return out;
}

/**
 * Sorts the slots [first, end): stacks of one kind merged up to their size, then in the pack's
 * item order, the larger stacks first, the empty slots last. Returns whether anything moved.
 */
export function sortSlots(registry: Registry, slots: Inventory, first: number, end: number) {
  const before = JSON.stringify(slots.slice(first, end));
  const stacks: Inventory = [];
  for (let i = first; i < end; i++) {
    const stack = slots[i];
    if (stack) pileOnto(stacks, registry, stack);
  }
  const sorted = (stacks as ItemStack[]).sort(
    (a, b) => registry.itemId(a.item) - registry.itemId(b.item) || b.count - a.count,
  );
  for (let i = first; i < end; i++) slots[i] = sorted[i - first] ?? null;
  return JSON.stringify(slots.slice(first, end)) !== before;
}

/**
 * Moves the items of the slots [first, end) that `into` already holds into it, as far as they fit.
 * Returns the count moved.
 */
export function stackInto(
  registry: Registry,
  from: Inventory,
  first: number,
  end: number,
  into: Inventory,
): number {
  let moved = 0;
  for (let i = first; i < end; i++) {
    const stack = from[i];
    if (!stack || !into.some((held) => held?.item === stack.item)) continue;
    const left = addToRange(into, registry, 0, into.length, stack);
    moved += stack.count - left;
    if (left === 0) from[i] = null;
    else stack.count = left;
  }
  return moved;
}

/**
 * `inv.sort`: the bag (not the hotbar) or the open chest sorted. `inv.stackNearby`: the bag's items
 * (not the hotbar's) stacked into the chests within STACK_RADIUS that already hold them.
 */
export function applyTidyCommand(
  sim: Simulation,
  player: PlayerState,
  command: TidyCommand,
  out: SimEvent[],
): void {
  const registry = sim.registry;
  const inventory = player.inventory;
  if (command.type === 'inv.sort') {
    if (command.open) {
      const chest = openedEntity(sim, player);
      if (chest?.kind !== 'container') {
        reject(out, player.playerId, command.type, 'nothing open');
        return;
      }
      sortSlots(registry, chest.slots, 0, chest.slots.length);
    } else sortSlots(registry, inventory, HOTBAR_SLOTS, inventory.length);
    out.push({ type: 'inventoryChanged', playerId: player.playerId });
    return;
  }
  const b = player.body;
  const chests = chestsNear(
    entityAt(sim),
    Math.floor(b.x),
    Math.floor(b.y),
    Math.floor(b.z),
    STACK_RADIUS,
  );
  let moved = 0;
  for (const chest of chests)
    moved += stackInto(registry, inventory, HOTBAR_SLOTS, inventory.length, chest.slots);
  out.push({
    type: 'stackedNearby',
    playerId: player.playerId,
    count: moved,
    chests: chests.length,
  });
  if (moved > 0) out.push({ type: 'inventoryChanged', playerId: player.playerId });
}
