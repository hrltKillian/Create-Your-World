import { FLAG_LIQUID } from '../content/registry.ts';
import type { ItemKey } from '../content/schema.ts';
import { lookVector, type Vec3 } from '../core/angles.ts';
import { createRayHit, RAY_TARGET_LIQUIDS, raycast } from '../world/raycast.ts';
import type { SimEvent } from './events.ts';
import { freshStack } from './inventory.ts';
import { eyeHeight } from './physics.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';
import { adjustGauges } from './survival.ts';
import { REACH } from './targeting.ts';

/*
 * Drinking water (docs « Eau potable »): a sip from a drinkable liquid with the hand empty, and an
 * empty container filled from a liquid (`liquid.fills`: raw or foul water, all its charges).
 * Drinking a container's charges is consuming it (consume.ts); boiling is a campfire process,
 * which keeps the charges left (stations.ts). Module scratch only: nothing allocated per tick.
 */

/** The last liquid found by `aimedLiquid`. */
const ray = createRayHit();
const look: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * The liquid a player looks at within reach, before any other block (the client's target skips
 * liquids, so the simulation casts its own ray): its block state, or −1.
 */
export function aimedLiquid(sim: Simulation, player: PlayerState): number {
  const b = player.body;
  const tables = sim.registry.tables;
  lookVector(player.yaw, player.pitch, look);
  const eye = b.y + eyeHeight(b);
  raycast(sim.world, tables, b.x, eye, b.z, look.x, look.y, look.z, REACH, ray, RAY_TARGET_LIQUIDS);
  return ray.hit && (tables.flags[ray.state]! & FLAG_LIQUID) !== 0 ? ray.state : -1;
}

/** One sip of a liquid (fresh water: thirst +8, toxicity +2; foul water: toxicity +10). */
export function sip(sim: Simulation, player: PlayerState, liquid: number, out: SimEvent[]): void {
  const def = sim.registry.blockDef(liquid);
  const l = def.liquid;
  if (!l) return;
  adjustGauges(player.survival, sim.registry.pack.balance, 0, l.thirstPerSip, 0, l.toxicityPerSip);
  if (l.thirstPerSip > 0) player.drank = true;
  out.push({ type: 'consumed', playerId: player.playerId, item: def.key });
}

/**
 * Fills the held empty container from the liquid just found by `aimedLiquid`, which turns it into
 * its full container of that water. Returns false when that liquid does not fill it.
 */
export function fill(sim: Simulation, player: PlayerState, liquid: number, out: SimEvent[]) {
  const registry = sim.registry;
  const slot = player.input.slot;
  const stack = player.inventory[slot];
  const filled = stack ? registry.blockDef(liquid).liquid?.fills[stack.item as ItemKey] : undefined;
  if (!stack || !filled) return false;
  player.inventory[slot] = freshStack(registry, filled, stack.count);
  out.push({ type: 'inventoryChanged', playerId: player.playerId });
  const sfx = registry.blockSfx(liquid, 'place');
  if (sfx) out.push({ type: 'sound', sfx, x: ray.x + 0.5, y: ray.y + 0.5, z: ray.z + 0.5 });
  return true;
}
