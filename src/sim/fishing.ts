import type { LootKey } from '../content/schema.ts';
import { hash32 } from '../core/hash.ts';
import { ticksOf } from './clock.ts';
import { held } from './consume.ts';
import { biomeAt } from './environment.ts';
import type { SimEvent } from './events.ts';
import { freshStack, spendUses } from './inventory.ts';
import { giveItems } from './inventoryCommands.ts';
import { rollLoot } from './loot.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';
import { aimedLiquid, aimedLiquidCell } from './water.ts';

/*
 * Fishing (plan v3 « M33 »): a rod held with secondary on a liquid that has fish (`LiquidDef.fish`,
 * or its biome's `fish` there: the Mirror Basin's are richer) lands a catch a pseudo-random
 * `rod.seconds` after the cast (the press, or the last catch). The catch goes to the bag (at the
 * feet when full) and the rod wears one use. Holding it is a held action like eating (consume.ts):
 * the player moves slower, and another hand or target stops it until the next press.
 */

const CAST_SALT = 0x66697368;

/** The fish of the liquid `aimedLiquid` just found, in its biome; undefined when it has none. */
function fishOf(sim: Simulation, liquid: number): LootKey | undefined {
  const fish = sim.registry.blockDef(liquid).liquid?.fish;
  if (!fish) return undefined;
  const at = aimedLiquidCell();
  return biomeAt(sim, at.x, at.z)?.fish ?? fish;
}

/**
 * One tick of secondary held past the interactive blocks with a rod in hand, `pressed` on its
 * first tick. Returns false when the hand holds no rod or it aims at no water with fish.
 */
export function holdRod(
  sim: Simulation,
  player: PlayerState,
  pressed: boolean,
  out: SimEvent[],
): boolean {
  const registry = sim.registry;
  const stack = player.inventory[player.input.slot];
  const id = stack ? registry.itemId(stack.item) : -1;
  const rod = id < 0 ? undefined : registry.items[id]?.rod;
  if (!rod) return false;
  const liquid = aimedLiquid(sim, player);
  const fish = liquid < 0 ? undefined : fishOf(sim, liquid);
  if (!fish) return false;
  const at = aimedLiquidCell();
  const x = at.x;
  const y = at.y;
  const z = at.z;
  // The cast's tick stays the same while it is held (useTicks counts from it).
  const cast = sim.tick - (pressed ? 0 : player.interaction.useTicks);
  const min = ticksOf(rod.seconds[0]);
  const span = ticksOf(rod.seconds[1]) - min + 1;
  const bite = min + (hash32(sim.ctx.seedHash, player.playerId, cast, CAST_SALT) % span);
  if (!held(player, pressed, id, bite)) return true;
  const table = registry.loot(fish);
  const give = (item: string, count: number) => {
    giveItems(sim, player, freshStack(registry, item, count), out);
    out.push({ type: 'fishCaught', playerId: player.playerId, item });
  };
  if (table) rollLoot(table, hash32(sim.ctx.seedHash, player.playerId, sim.tick, CAST_SALT), give);
  spendUses(registry, player.inventory, player.input.slot, 1);
  out.push({ type: 'inventoryChanged', playerId: player.playerId });
  const sfx = registry.blockSfx(liquid, 'place');
  if (sfx) out.push({ type: 'sound', sfx, x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  return true;
}
