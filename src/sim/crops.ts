import type { Registry } from '../content/registry.ts';
import type { CropDef } from '../content/schema.ts';
import { hash32 } from '../core/hash.ts';
import { effectiveLight } from '../world/light.ts';
import { dropLoot } from './blockRemoval.ts';
import { UPDATE_GROW } from './blockUpdates.ts';
import { ticksOf } from './clock.ts';
import { editBlock } from './edits.ts';
import type { SimEvent } from './events.ts';
import { freshStack } from './inventory.ts';
import { giveItems } from './inventoryCommands.ts';
import { rollLoot } from './loot.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';

/*
 * Crops (plan v3 « M33 »): a plant with `BlockDef.crop` bears its harvest while `ripe`. Secondary
 * on a ripe one picks it: the harvest goes to the bag, the plant stays bare (broken ripe, it drops
 * its harvest with itself; a grazing creature leaves it bare, without the harvest). A bare one ripens `crop.seconds` later (block updates,
 * UPDATE_GROW) where the sky or a lamp gives it `crop.light`; in the dark it waits as long again.
 * A planted one starts bare (placement.ts); generated ones are ripe.
 */

/** Salts of the hashes (a crop's delay, its harvest roll). */
const GROW_SALT = 0x67726f77;
const HARVEST_SALT = 0x68617276;

/** The crop of a block state, if it is one. */
export function cropOf(registry: Registry, state: number): CropDef | undefined {
  return registry.blockDef(state).crop;
}

/** Whether a block state is a ripe crop (secondary picks it). */
export function isRipeCrop(registry: Registry, state: number): boolean {
  return cropOf(registry, state) !== undefined && registry.prop(state, 'ripe') === '1';
}

/** Schedules the ripening of a bare crop at a cell (nothing for another block). */
export function scheduleRipening(sim: Simulation, x: number, y: number, z: number): void {
  const state = sim.world.getBlock(x, y, z);
  const crop = cropOf(sim.registry, state);
  if (!crop || sim.registry.prop(state, 'ripe') !== '0') return;
  const min = ticksOf(crop.seconds[0]);
  const span = ticksOf(crop.seconds[1]) - min + 1;
  const delay = min + (hash32(hash32(sim.ctx.seedHash, x, y, z), sim.tick, GROW_SALT) % span);
  sim.blockUpdates.schedule(x, y, z, UPDATE_GROW, sim.tick + delay);
}

/** Leaves the ripe crop at a cell bare (picked or grazed); it ripens again later. */
export function stripCrop(sim: Simulation, x: number, y: number, z: number, out: SimEvent[]) {
  const state = sim.world.getBlock(x, y, z);
  if (!isRipeCrop(sim.registry, state)) return;
  editBlock(sim.world, sim.light, x, y, z, sim.registry.withState(state, 'ripe', '0'), out);
  scheduleRipening(sim, x, y, z);
}

/**
 * A player picks the ripe crop at a cell: its harvest goes to the bag (at the feet when full), the
 * plant stays bare.
 */
export function harvestCrop(
  sim: Simulation,
  player: PlayerState,
  x: number,
  y: number,
  z: number,
  out: SimEvent[],
): void {
  const registry = sim.registry;
  const state = sim.world.getBlock(x, y, z);
  const crop = cropOf(registry, state);
  const table = crop ? registry.loot(crop.harvest) : undefined;
  if (!table || !isRipeCrop(registry, state)) return;
  const give = (item: string, count: number) =>
    giveItems(sim, player, freshStack(registry, item, count), out);
  rollLoot(table, hash32(hash32(sim.ctx.seedHash, x, y, z), sim.tick, HARVEST_SALT), give);
  stripCrop(sim, x, y, z, out);
  out.push({ type: 'cropHarvested', playerId: player.playerId, x, y, z, state });
  const sfx = registry.blockSfx(state, 'break');
  if (sfx) out.push({ type: 'sound', sfx, x: x + 0.5, y: y + 0.5, z: z + 0.5 });
}

/** A crop's harvest dropped at a cell (broken ripe: blockRemoval.ts). */
export function dropHarvest(sim: Simulation, crop: CropDef, x: number, y: number, z: number) {
  dropLoot(sim, crop.harvest, x, y, z, HARVEST_SALT);
}

/** UPDATE_GROW: a bare crop in enough light ripens; in the dark it waits another delay. */
export function ripenCrop(sim: Simulation, x: number, y: number, z: number, out: SimEvent[]) {
  const registry = sim.registry;
  const state = sim.world.getBlock(x, y, z);
  const crop = cropOf(registry, state);
  if (!crop || registry.prop(state, 'ripe') !== '0') return;
  if (effectiveLight(sim.world.getLight(x, y, z), 1) < crop.light) {
    scheduleRipening(sim, x, y, z);
    return;
  }
  editBlock(sim.world, sim.light, x, y, z, registry.withState(state, 'ripe', '1'), out);
}
