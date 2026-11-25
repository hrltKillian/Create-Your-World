import type { Registry } from '../content/registry.ts';
import type { RecipeDef } from '../content/schema.ts';
import type { WorkbenchEntity } from './blockEntities.ts';
import { ticksOf } from './clock.ts';
import { reject, whole } from './commandRules.ts';
import type { CraftCommand } from './commands.ts';
import type { SimEvent } from './events.ts';
import { countMatching, freshStack, type Inventory, pileOnto, takeMatching } from './inventory.ts';
import { giveItems } from './inventoryCommands.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';
import { openedEntity } from './screens.ts';

/**
 * The Logbook's craft queues (docs « Craft : le Logbook »), 5 entries each, the first one in
 * progress: a player's own for the hand recipes, and a workbench's for its station's recipes,
 * queued by a player who has it open (workbench.ts makes them). Queuing checks that the recipe is
 * revealed and takes its ingredients from the player at once (reserved in the entry); cancelling
 * gives them back to whoever cancels. A recipe already queued adds its crafts to its entry, up to
 * one stack of the output (`entryCrafts`), so five ×1 make the same entry as one ×5; past that, a
 * new entry opens. Each craft of a player's queue goes to the bag, or to the ground at the
 * player's feet when the bag is full.
 */

export const CRAFT_QUEUE = 5;
/** Most crafts one command queues (the Logbook's Max button), and one entry holds. */
export const MAX_CRAFT_COUNT = 100;

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
 * Most crafts one queue entry holds: what makes one stack of the recipe's output (at least one
 * craft, at most MAX_CRAFT_COUNT: what a save keeps of an entry).
 */
export function entryCrafts(registry: Registry, recipe: RecipeDef): number {
  const { item, count } = recipe.output;
  return Math.min(MAX_CRAFT_COUNT, Math.max(1, Math.floor(registry.maxStack(item) / count)));
}

/** Crafts of a recipe a queue still takes: room in its entries, then in the free entries. */
export function queueRoom(
  registry: Registry,
  queue: readonly CraftEntry[],
  recipe: RecipeDef,
): number {
  const cap = entryCrafts(registry, recipe);
  let room = (CRAFT_QUEUE - queue.length) * cap;
  for (const entry of queue)
    if (entry.recipe === recipe.key) room += Math.max(0, cap - entry.count);
  return room;
}

/**
 * Adds `count` crafts of a recipe to a queue (the caller checked queueRoom and the ingredients):
 * onto its entries with room first, then into new entries, each reserving the ingredients of its
 * crafts from the player's inventory (merged onto the stacks already reserved).
 */
function addCrafts(
  sim: Simulation,
  player: PlayerState,
  queue: CraftEntry[],
  recipe: RecipeDef,
  count: number,
): void {
  const cap = entryCrafts(sim.registry, recipe);
  let left = count;
  for (let i = 0; i < queue.length && left > 0; i++) {
    const entry = queue[i]!;
    const crafts = Math.min(left, cap - entry.count);
    if (entry.recipe !== recipe.key || crafts <= 0) continue;
    reserve(sim, player, entry, recipe, crafts);
    left -= crafts;
  }
  while (left > 0) {
    const entry: CraftEntry = { recipe: recipe.key, count: 0, progressTicks: 0, reserved: [] };
    const crafts = Math.min(left, cap);
    reserve(sim, player, entry, recipe, crafts);
    queue.push(entry);
    left -= crafts;
  }
}

/** Takes the ingredients of `crafts` crafts from the player into an entry, counting them in it. */
function reserve(
  sim: Simulation,
  player: PlayerState,
  entry: CraftEntry,
  recipe: RecipeDef,
  crafts: number,
): void {
  const registry = sim.registry;
  const inventory = player.inventory;
  const taken: Inventory = [];
  for (const input of recipe.inputs)
    takeMatching(
      inventory,
      0,
      inventory.length,
      registry.crafting,
      input.item,
      input.count * crafts,
      taken,
    );
  for (const stack of taken) if (stack) pileOnto(entry.reserved, registry, stack);
  entry.count += crafts;
}

/** The workbench a player has open, if any. */
function openWorkbench(sim: Simulation, player: PlayerState): WorkbenchEntity | undefined {
  const entity = openedEntity(sim, player);
  return entity?.kind === 'workbench' ? entity : undefined;
}

/**
 * The queue a recipe goes to: that of the workbench the player has open, for its station's recipes
 * and the hand ones alike (plan v3 « M18 »); else the player's own for a hand recipe (undefined:
 * a station recipe with no such workbench open).
 */
function queueOf(
  sim: Simulation,
  player: PlayerState,
  recipe: RecipeDef,
): CraftEntry[] | undefined {
  const bench = openWorkbench(sim, player);
  if (bench && (recipe.station === undefined || recipe.station === bench.station))
    return bench.craft;
  return recipe.station === undefined ? player.craft : undefined;
}

/** Queues `count` crafts of a recipe, reserving their ingredients; returns the refusal, if any. */
export function enqueueCraft(
  sim: Simulation,
  player: PlayerState,
  key: string,
  count: number,
): string | null {
  const registry = sim.registry;
  const crafting = registry.crafting;
  const recipe = crafting.recipe(key);
  if (!recipe) return 'unknown recipe';
  if (!crafting.revealed(recipe, player.seen)) return 'not revealed';
  const queue = queueOf(sim, player, recipe);
  if (!queue) return 'station';
  if (queueRoom(registry, queue, recipe) < count) return 'queue full';
  const inventory = player.inventory;
  for (const input of recipe.inputs)
    if (countMatching(inventory, 0, inventory.length, crafting, input.item) < input.count * count)
      return 'ingredients';
  addCrafts(sim, player, queue, recipe, count);
  return null;
}

/**
 * Removes an entry of a queue (the player's, or their open workbench's) and gives its reserved
 * ingredients to the player (dropped at their feet if the bag is full).
 */
export function cancelCraft(
  sim: Simulation,
  player: PlayerState,
  queue: CraftEntry[],
  index: number,
  out: SimEvent[],
): void {
  const [entry] = queue.splice(index, 1);
  for (const stack of entry?.reserved ?? []) if (stack) giveItems(sim, player, stack, out);
  out.push({ type: 'inventoryChanged', playerId: player.playerId });
}

/** Refunds the queue entries whose recipe the pack no longer has (a save from another pack). */
export function refundUnknownCrafts(sim: Simulation, player: PlayerState, out: SimEvent[]): void {
  const queue = player.craft;
  for (let i = queue.length - 1; i >= 0; i--)
    if (!sim.registry.crafting.recipe(queue[i]!.recipe)) cancelCraft(sim, player, queue, i, out);
}

/** Shape and ranges of a craft command (the recipe and the queue are checked when applied). */
function validCraftCommand(c: CraftCommand): boolean {
  if (c.type === 'craft.cancel')
    return (
      whole(c.index, 0, Number.POSITIVE_INFINITY) &&
      (c.workbench === undefined || typeof c.workbench === 'boolean')
    );
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
    const queue = command.workbench ? openWorkbench(sim, player)?.craft : player.craft;
    if (!queue) reject(out, playerId, command.type, 'not open');
    else if (command.index < queue.length) cancelCraft(sim, player, queue, command.index, out);
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
    cancelCraft(sim, player, player.craft, 0, out);
    return;
  }
  if (!progressCraft(registry, entry, recipe)) return;
  const { item, count } = recipe.output;
  giveItems(sim, player, freshStack(registry, item, count), out);
  out.push({ type: 'crafted', playerId: player.playerId, recipe: recipe.key, item, count });
  if (entry.count === 0) player.craft.shift();
}

/**
 * One tick of the craft under way of a queue's first entry. Returns true when it is done: its
 * ingredients are used up from the reservation and the entry counts one craft less (its output,
 * and the entry once empty, are the caller's).
 */
export function progressCraft(registry: Registry, entry: CraftEntry, recipe: RecipeDef): boolean {
  if (++entry.progressTicks < ticksOf(recipe.seconds)) return false;
  entry.progressTicks = 0;
  const reserved = entry.reserved;
  for (const input of recipe.inputs)
    takeMatching(reserved, 0, reserved.length, registry.crafting, input.item, input.count);
  entry.reserved = reserved.filter((stack) => stack !== null);
  entry.count--;
  return true;
}
