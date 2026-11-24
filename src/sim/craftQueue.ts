import type { Registry } from '../content/registry.ts';
import { WORLD_HEIGHT } from '../world/coords.ts';
import { withinReach } from './blockEntities.ts';
import { ticksOf } from './clock.ts';
import { reject, whole } from './commandRules.ts';
import type { CraftCommand } from './commands.ts';
import type { SimEvent } from './events.ts';
import { countMatching, freshStack, type Inventory, takeMatching } from './inventory.ts';
import { giveItems } from './inventoryCommands.ts';
import { bodyHeight } from './physics.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';

/**
 * The Logbook's craft queue (docs « Craft : le Logbook »): 5 entries per player, the first one in
 * progress. Queuing checks that the recipe is revealed, that its station stands within 4 blocks,
 * and takes its ingredients at once (reserved in the entry); cancelling gives them back. Each
 * craft done goes to the bag, or to the ground at the player's feet when the bag is full.
 */

export const CRAFT_QUEUE = 5;
/** Most crafts one entry holds (the Logbook's Max button). */
export const MAX_CRAFT_COUNT = 100;
/** A station recipe needs a block of its station within this distance (blocks). */
export const STATION_REACH = 4;

/** A queue entry: `count` crafts of a recipe, with the ingredients still reserved for them. */
export interface CraftEntry {
  readonly recipe: string;
  count: number;
  /** Ticks spent on the craft in progress (the first entry only). */
  progressTicks: number;
  reserved: Inventory;
}

/** Marks an item, and its tags, as seen by a player (recipe reveal). */
export function noteSeen(registry: Registry, seen: Record<string, true>, item: string): void {
  seen[item] = true;
  for (const tag of registry.item(item)?.tags ?? []) seen[tag] = true;
}

/**
 * Whether a block of a station stands within STATION_REACH of the player (the cells around them
 * are read: placed, generated or filled blocks all count, and nothing is left to keep in sync).
 */
export function stationNear(sim: Simulation, player: PlayerState, station: string): boolean {
  const b = player.body;
  const r = STATION_REACH;
  const y0 = Math.max(0, Math.floor(b.y - r));
  const y1 = Math.min(WORLD_HEIGHT - 1, Math.floor(b.y + bodyHeight(b) + r));
  for (let x = Math.floor(b.x - r); x <= Math.floor(b.x + r); x++) {
    for (let z = Math.floor(b.z - r); z <= Math.floor(b.z + r); z++) {
      for (let y = y0; y <= y1; y++) {
        const def = sim.registry.blockDef(sim.world.getBlock(x, y, z));
        if (def.station === station && withinReach(player, x, y, z, r)) return true;
      }
    }
  }
  return false;
}

/** Queues `count` crafts of a recipe, reserving their ingredients; returns the refusal, if any. */
export function enqueueCraft(
  sim: Simulation,
  player: PlayerState,
  key: string,
  count: number,
): string | null {
  const crafting = sim.registry.crafting;
  const recipe = crafting.recipe(key);
  if (!recipe) return 'unknown recipe';
  if (!crafting.revealed(recipe, player.seen)) return 'not revealed';
  if (player.craft.length >= CRAFT_QUEUE) return 'queue full';
  if (recipe.station !== undefined && !stationNear(sim, player, recipe.station)) return 'station';
  const inventory = player.inventory;
  const end = inventory.length;
  for (const input of recipe.inputs)
    if (countMatching(inventory, 0, end, crafting, input.item) < input.count * count)
      return 'ingredients';
  const reserved: Inventory = [];
  for (const input of recipe.inputs)
    takeMatching(inventory, 0, end, crafting, input.item, input.count * count, reserved);
  player.craft.push({ recipe: key, count, progressTicks: 0, reserved });
  return null;
}

/** Removes a queue entry and gives its reserved ingredients back (dropped if the bag is full). */
export function cancelCraft(
  sim: Simulation,
  player: PlayerState,
  index: number,
  out: SimEvent[],
): void {
  const [entry] = player.craft.splice(index, 1);
  for (const stack of entry?.reserved ?? []) if (stack) giveItems(sim, player, stack, out);
  out.push({ type: 'inventoryChanged', playerId: player.playerId });
}

/** Refunds the queue entries whose recipe the pack no longer has (a save from another pack). */
export function refundUnknownCrafts(sim: Simulation, player: PlayerState, out: SimEvent[]): void {
  for (let i = player.craft.length - 1; i >= 0; i--)
    if (!sim.registry.crafting.recipe(player.craft[i]!.recipe)) cancelCraft(sim, player, i, out);
}

/** Shape and ranges of a craft command (the recipe and the queue are checked when applied). */
function validCraftCommand(c: CraftCommand): boolean {
  if (c.type === 'craft.cancel') return whole(c.index, 0, Number.POSITIVE_INFINITY);
  return typeof c.recipe === 'string' && whole(c.count, 1, MAX_CRAFT_COUNT);
}

export function applyCraftCommand(
  sim: Simulation,
  player: PlayerState,
  command: CraftCommand,
  out: SimEvent[],
): void {
  const playerId = player.playerId;
  if (!validCraftCommand(command)) {
    reject(out, playerId, command.type, 'invalid');
  } else if (command.type === 'craft.cancel') {
    if (command.index < player.craft.length) cancelCraft(sim, player, command.index, out);
    else reject(out, playerId, command.type, 'no such entry');
  } else {
    const refusal = enqueueCraft(sim, player, command.recipe, command.count);
    if (refusal) reject(out, playerId, command.type, refusal);
    else out.push({ type: 'inventoryChanged', playerId });
  }
}

/**
 * Tick step 9 for a player: notes the items seen (in the inventory or on the cursor), then advances
 * the first queue entry.
 */
export function stepCrafting(sim: Simulation, player: PlayerState, out: SimEvent[]): void {
  const registry = sim.registry;
  const inventory = player.inventory;
  for (let i = 0; i < inventory.length; i++) {
    const stack = inventory[i];
    if (stack && player.seen[stack.item] !== true) noteSeen(registry, player.seen, stack.item);
  }
  const cursor = player.cursor;
  if (cursor && player.seen[cursor.item] !== true) noteSeen(registry, player.seen, cursor.item);
  const entry = player.craft[0];
  if (!entry) return;
  const recipe = registry.crafting.recipe(entry.recipe);
  if (!recipe) {
    cancelCraft(sim, player, 0, out);
    return;
  }
  if (++entry.progressTicks < ticksOf(recipe.seconds)) return;
  entry.progressTicks = 0;
  const reserved = entry.reserved;
  for (const input of recipe.inputs)
    takeMatching(reserved, 0, reserved.length, registry.crafting, input.item, input.count);
  entry.reserved = reserved.filter((stack) => stack !== null);
  const { item, count } = recipe.output;
  giveItems(sim, player, freshStack(registry, item, count), out);
  out.push({ type: 'crafted', playerId: player.playerId, recipe: recipe.key, item, count });
  if (--entry.count === 0) player.craft.shift();
}
