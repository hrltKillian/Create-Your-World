import { COLLISION_LIQUID, FLAG_SOLID, type Registry } from '../content/registry.ts';
import { hash32 } from '../core/hash.ts';
import { BY_WORLD, removeWhole } from './blockRemoval.ts';
import { UPDATE_SOIL } from './blockUpdates.ts';
import { ticksOf } from './clock.ts';
import { editBlock } from './edits.ts';
import type { SimEvent } from './events.ts';
import { spendUses } from './inventory.ts';
import { heldItem, type PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';

/*
 * Farmland (plan v3 « M33 », the reference game's): a hoe turns grass or dirt with air above
 * into farmland (`BlockDef.tills`), the only block crops are planted on (placement.ts). Every
 * SOIL_SECONDS a farmland checks itself (block updates, UPDATE_SOIL): watered (`moist`) while a
 * liquid that does not burn lies within its `soil.irrigation` blocks, on its level or one above;
 * else it dries, and dry with nothing planted on it, or under a solid block, it turns back into
 * `soil.dries` (dirt). A player landing on it from a jump tramples it: the chance is the fall
 * past half a block. A crop on dry farmland ripens twice as slowly (crops.ts).
 */

/** Seconds between two checks of a farmland (a pseudo-random time in this range). */
const SOIL_SECONDS = [15, 30] as const;
const SOIL_SALT = 0x736f696c;
const TRAMPLE_SALT = 0x7472616d;

/** Whether a block state is farmland. */
export function isSoil(registry: Registry, state: number): boolean {
  return registry.blockDef(state).soil !== undefined;
}

/** Whether a farmland state is watered. */
export function isMoist(registry: Registry, state: number): boolean {
  return registry.prop(state, 'moist') === '1';
}

/** Schedules the next check of a farmland. */
function scheduleSoil(sim: Simulation, x: number, y: number, z: number): void {
  const min = ticksOf(SOIL_SECONDS[0]);
  const span = ticksOf(SOIL_SECONDS[1]) - min + 1;
  const delay = min + (hash32(hash32(sim.ctx.seedHash, x, y, z), sim.tick, SOIL_SALT) % span);
  sim.blockUpdates.schedule(x, y, z, UPDATE_SOIL, sim.tick + delay);
}

/** Whether a liquid that does not burn lies within `radius` blocks of a cell, its level or above. */
function irrigated(sim: Simulation, x: number, y: number, z: number, radius: number): boolean {
  const { world, registry } = sim;
  const collision = registry.tables.collision;
  for (let dy = 0; dy <= 1; dy++)
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        const state = world.getBlock(x + dx, y + dy, z + dz);
        if (collision[state] === COLLISION_LIQUID && !registry.blockDef(state).contact?.ignites)
          return true;
      }
  return false;
}

/** The farmland a held hoe would till the aimed block into (−1: none). */
export function tilledState(sim: Simulation, player: PlayerState, state: number): number {
  const registry = sim.registry;
  if (!heldItem(registry, player)?.hoe) return -1;
  const tills = registry.blockDef(state).tills;
  return tills === undefined ? -1 : registry.defaultState(tills);
}

/**
 * Tills the block at a cell into farmland with the held hoe (it wears one use): only with air
 * above. Returns false when it cannot.
 */
export function till(
  sim: Simulation,
  player: PlayerState,
  x: number,
  y: number,
  z: number,
  out: SimEvent[],
): boolean {
  const { world, registry } = sim;
  const farmland = tilledState(sim, player, world.getBlock(x, y, z));
  if (farmland < 0 || world.getBlock(x, y + 1, z) !== registry.air) return false;
  const radius = registry.blockDef(farmland).soil!.irrigation;
  const moist = irrigated(sim, x, y, z, radius) ? '1' : '0';
  editBlock(world, sim.light, x, y, z, registry.withState(farmland, 'moist', moist), out);
  scheduleSoil(sim, x, y, z);
  spendUses(registry, player.inventory, player.input.slot, 1);
  out.push({ type: 'inventoryChanged', playerId: player.playerId });
  const sfx = registry.blockSfx(farmland, 'place');
  if (sfx) out.push({ type: 'sound', sfx, x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  return true;
}

/** UPDATE_SOIL: a farmland waters, dries, or turns back into dirt (see the header). */
export function checkSoil(sim: Simulation, x: number, y: number, z: number, out: SimEvent[]) {
  const { world, registry } = sim;
  const state = world.getBlock(x, y, z);
  const soil = registry.blockDef(state).soil;
  if (!soil) return;
  const above = world.getBlock(x, y + 1, z);
  const covered = (registry.tables.flags[above]! & FLAG_SOLID) !== 0;
  const wet = !covered && irrigated(sim, x, y, z, soil.irrigation);
  const planted = registry.blockDef(above).crop !== undefined;
  if (covered || (!wet && !isMoist(registry, state) && !planted)) {
    editBlock(world, sim.light, x, y, z, registry.defaultState(soil.dries), out);
    return;
  }
  const next = registry.withState(state, 'moist', wet ? '1' : '0');
  if (next !== state) editBlock(world, sim.light, x, y, z, next, out);
  scheduleSoil(sim, x, y, z);
}

/**
 * After the players move: a player landing on farmland from a fall of more than half a block
 * tramples it (the chance is the fall past half a block, the reference game's) back into dirt;
 * the crop on it breaks, its harvest dropped.
 */
export function stepTrampling(sim: Simulation, out: SimEvent[], first: number): void {
  const { world, registry } = sim;
  const end = out.length;
  for (let i = first; i < end; i++) {
    const e = out[i]!;
    if (e.type !== 'playerLanded' || e.fall <= 0.5) continue;
    const player = sim.players.get(e.playerId);
    if (!player) continue;
    const b = player.body;
    const x = Math.floor(b.x);
    const y = Math.floor(b.y - 0.05);
    const z = Math.floor(b.z);
    const state = world.getBlock(x, y, z);
    const soil = registry.blockDef(state).soil;
    if (!soil) continue;
    const chance = (hash32(sim.ctx.seedHash, sim.tick, e.playerId, TRAMPLE_SALT) % 1000) / 1000;
    if (chance >= e.fall - 0.5) continue;
    if (registry.blockDef(world.getBlock(x, y + 1, z)).crop)
      removeWhole(sim, BY_WORLD, x, y + 1, z, true, out);
    editBlock(world, sim.light, x, y, z, registry.defaultState(soil.dries), out);
  }
}

/** A crop on dry farmland ripens twice as slowly: the factor of its delay. */
export function soilFactor(sim: Simulation, x: number, y: number, z: number): number {
  const below = sim.world.getBlock(x, y - 1, z);
  return isSoil(sim.registry, below) && !isMoist(sim.registry, below) ? 2 : 1;
}
