import { HOTBAR_SLOTS } from '../../core/player.ts';
import { solidCell } from '../collision.ts';
import type { Inventory, ItemStack } from '../inventory.ts';
import type { Body } from '../physics.ts';
import type { BotWorld } from './bots.ts';

/*
 * What the wanderMineBuild bot tells apart, from the pack's data only (engine code never names
 * content): the kinds of its items, the blocks that quench thirst or feed it, the cells around it.
 */

/** Item kinds (bit flags): eaten for hunger, drunk for thirst, poisonous, placed, a tool. */
export const FOOD = 1;
export const DRINK = 2;
export const TOXIC = 4;
export const BLOCK = 8;
export const TOOL = 16;

/** Source kinds of blocks: water worth a sip (it quenches more than it poisons), a food plant. */
export const WATER = 1;
export const BUSH = 2;

/** How far a search for a source looks: blocks around the feet, below and above them. */
export const SCAN_RADIUS = 16;
const SCAN_DOWN = 8;
const SCAN_UP = 2;

export interface BotSenses extends BotWorld {
  /** Item kinds by item id. */
  readonly items: Uint8Array;
  /** Source kinds by block id. */
  readonly sources: Uint8Array;
}

/** A target cell (the bot's state holds one). */
export interface Target {
  tx: number;
  ty: number;
  tz: number;
}

export function botSenses({ registry, world }: BotWorld): BotSenses {
  const items = new Uint8Array(registry.items.length);
  registry.items.forEach((def, id) => {
    const c = def.consume;
    items[id] =
      ((c?.hunger ?? 0) > 0 ? FOOD : 0) |
      ((c?.thirst ?? 0) > 0 ? DRINK : 0) |
      ((c?.toxicity ?? 0) > 0 ? TOXIC : 0) |
      (registry.itemTables.places[id]! >= 0 ? BLOCK : 0) |
      (def.tool ? TOOL : 0);
  });
  const sources = new Uint8Array(registry.blocks.length);
  registry.blocks.forEach((def, id) => {
    const liquid = def.liquid;
    const loot =
      def.drops === 'self' || def.drops === 'none' ? undefined : registry.loot(def.drops);
    if (liquid?.drinkable && liquid.thirstPerSip > liquid.toxicityPerSip) sources[id] = WATER;
    else if (loot?.entries.some((e) => (items[registry.itemId(e.item)]! & FOOD) !== 0))
      sources[id] = BUSH;
  });
  return { registry, world, items, sources };
}

/** Kind of a stack's item (0 for an empty slot or an item the pack does not have). */
export function kindOf(senses: BotSenses, stack: Readonly<ItemStack> | null): number {
  return stack ? (senses.items[senses.registry.itemId(stack.item)] ?? 0) : 0;
}

/** First slot of [from, to) whose item has a kind of `mask` and none of `avoid`; −1 if none. */
export function slotWith(
  senses: BotSenses,
  inventory: Inventory,
  mask: number,
  avoid: number,
  from = 0,
  to = HOTBAR_SLOTS,
): number {
  for (let i = from; i < to; i++) {
    const kind = kindOf(senses, inventory[i]!);
    if ((kind & mask) !== 0 && (kind & avoid) === 0) return i;
  }
  return -1;
}

/** Last hotbar slot holding an item with no kind of `mask`; −1 if none. */
export function lastSlotWithout(senses: BotSenses, inventory: Inventory, mask: number): number {
  for (let i = HOTBAR_SLOTS - 1; i >= 0; i--) {
    const stack = inventory[i]!;
    if (stack && (kindOf(senses, stack) & mask) === 0) return i;
  }
  return -1;
}

/** First empty slot of [from, to); −1 if none. */
export function emptySlot(inventory: Inventory, from: number, to: number): number {
  for (let i = from; i < to; i++) if (!inventory[i]) return i;
  return -1;
}

/** The hotbar slot to mine with: a tool, else the bare hand (an empty slot), else `current`. */
export function handSlot(senses: BotSenses, inventory: Inventory, current: number): number {
  const tool = slotWith(senses, inventory, TOOL, 0);
  if (tool >= 0) return tool;
  const empty = emptySlot(inventory, 0, HOTBAR_SLOTS);
  return empty >= 0 ? empty : current;
}

/** Source kind of the block at a cell (0: none). */
export function sourceAt(senses: BotSenses, x: number, y: number, z: number): number {
  const state = senses.world.getBlock(x, y, z);
  return senses.sources[senses.registry.tables.blockOf[state]!]!;
}

/**
 * The nearest cell (squared distance; scan order on ties) within SCAN_RADIUS of the feet, from
 * SCAN_DOWN below to SCAN_UP above, whose block is a `want` source, written into `out`. About
 * 10 000 block reads: the bot searches at most every few seconds.
 */
export function nearestSource(
  senses: BotSenses,
  want: number,
  body: Readonly<Body>,
  out: Target,
): boolean {
  const fx = Math.floor(body.x);
  const fy = Math.floor(body.y);
  const fz = Math.floor(body.z);
  let best = Number.POSITIVE_INFINITY;
  for (let dy = -SCAN_DOWN; dy <= SCAN_UP; dy++) {
    for (let dz = -SCAN_RADIUS; dz <= SCAN_RADIUS; dz++) {
      for (let dx = -SCAN_RADIUS; dx <= SCAN_RADIUS; dx++) {
        const d = dx * dx + dy * dy + dz * dz;
        if (d >= best || sourceAt(senses, fx + dx, fy + dy, fz + dz) !== want) continue;
        best = d;
        out.tx = fx + dx;
        out.ty = fy + dy;
        out.tz = fz + dz;
      }
    }
  }
  return best < Number.POSITIVE_INFINITY;
}

/** Whether the four cells around the head's level are solid: a pit the bot cannot walk out of. */
export function walledIn(senses: BotSenses, body: Readonly<Body>): boolean {
  const { world, registry } = senses;
  const t = registry.tables;
  const x = Math.floor(body.x);
  const y = Math.floor(body.y) + 1;
  const z = Math.floor(body.z);
  return (
    solidCell(world, t, x + 1, y, z) &&
    solidCell(world, t, x - 1, y, z) &&
    solidCell(world, t, x, y, z + 1) &&
    solidCell(world, t, x, y, z - 1)
  );
}

/** Whether the cell above the head is free: standing one block higher fits (no cave ceiling). */
export function headroom(senses: BotSenses, body: Readonly<Body>): boolean {
  const y = Math.floor(body.y) + 2;
  return !solidCell(
    senses.world,
    senses.registry.tables,
    Math.floor(body.x),
    y,
    Math.floor(body.z),
  );
}
