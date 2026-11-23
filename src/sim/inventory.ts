import type { Registry } from '../content/registry.ts';
import { HOTBAR_SLOTS } from '../core/player.ts';

/** Hotbar (0–7) then bag (8–31, 6×4). */
export const BAG_SLOTS = 24;
export const INVENTORY_SLOTS = HOTBAR_SLOTS + BAG_SLOTS;

/** A stack of one item (text key, as saves store it). Tools carry their remaining uses. */
export interface ItemStack {
  item: string;
  count: number;
  durability?: number;
  /** Saved key of an item the pack no longer has (`item` is then the pack's unknown item). */
  original?: string;
}

/** Plain JSON: one entry per slot, null when empty. */
export type Inventory = (ItemStack | null)[];

export function createInventory(): Inventory {
  return new Array<ItemStack | null>(INVENTORY_SLOTS).fill(null);
}

/** Stacks of the same item merge, unless they carry wear. */
function mergeable(stack: ItemStack, item: string, durability: number | undefined): boolean {
  return stack.item === item && stack.durability === undefined && durability === undefined;
}

/**
 * Adds items, topping up matching stacks first, then filling empty slots (hotbar first).
 * Returns the count that did not fit.
 */
export function addItem(
  inventory: Inventory,
  registry: Registry,
  item: string,
  count: number,
  durability?: number,
  original?: string,
): number {
  const max = registry.maxStack(item);
  let left = count;
  for (let i = 0; i < inventory.length && left > 0; i++) {
    const stack = inventory[i];
    if (!stack || !mergeable(stack, item, durability) || stack.count >= max) continue;
    const moved = Math.min(left, max - stack.count);
    stack.count += moved;
    left -= moved;
  }
  for (let i = 0; i < inventory.length && left > 0; i++) {
    if (inventory[i]) continue;
    const moved = Math.min(left, max);
    const stack: ItemStack = { item, count: moved };
    if (durability !== undefined) stack.durability = durability;
    if (original !== undefined) stack.original = original;
    inventory[i] = stack;
    left -= moved;
  }
  return left;
}

/** Removes up to `count` items from a slot; returns what was removed (null if the slot is empty). */
export function takeFromSlot(inventory: Inventory, slot: number, count: number): ItemStack | null {
  const stack = inventory[slot];
  if (!stack || count <= 0) return null;
  const taken = Math.min(count, stack.count);
  stack.count -= taken;
  if (stack.count === 0) inventory[slot] = null;
  return { ...stack, count: taken };
}

/**
 * Moves `count` items (default: all) from one slot to another: into an empty slot, onto a matching
 * stack (up to its maximum), or swapping two whole stacks. Returns whether anything moved.
 */
export function moveItems(
  inventory: Inventory,
  registry: Registry,
  from: number,
  to: number,
  count?: number,
): boolean {
  const source = inventory[from];
  if (!source || from === to) return false;
  const amount = Math.min(count ?? source.count, source.count);
  const target = inventory[to];
  if (!target) {
    inventory[to] = takeFromSlot(inventory, from, amount);
    return true;
  }
  if (mergeable(target, source.item, source.durability)) {
    const moved = Math.min(amount, registry.maxStack(target.item) - target.count);
    if (moved <= 0) return false;
    target.count += moved;
    takeFromSlot(inventory, from, moved);
    return true;
  }
  if (amount !== source.count) return false;
  inventory[from] = target;
  inventory[to] = source;
  return true;
}

/** Moves a stack between the hotbar and the bag (merging first); returns whether anything moved. */
export function quickMove(inventory: Inventory, registry: Registry, slot: number): boolean {
  const stack = inventory[slot];
  if (!stack) return false;
  const toBag = slot < HOTBAR_SLOTS;
  const first = toBag ? HOTBAR_SLOTS : 0;
  const end = toBag ? INVENTORY_SLOTS : HOTBAR_SLOTS;
  const before = stack.count;
  const max = registry.maxStack(stack.item);
  for (let i = first; i < end && stack.count > 0; i++) {
    const target = inventory[i];
    if (!target || !mergeable(target, stack.item, stack.durability) || target.count >= max)
      continue;
    const moved = Math.min(stack.count, max - target.count);
    target.count += moved;
    stack.count -= moved;
  }
  for (let i = first; i < end && stack.count > 0; i++) {
    if (inventory[i]) continue;
    inventory[i] = { ...stack };
    stack.count = 0;
  }
  if (stack.count === 0) inventory[slot] = null;
  return stack.count !== before;
}

/** Total count of an item across all slots. */
export function countItem(inventory: Inventory, item: string): number {
  let total = 0;
  for (const stack of inventory) if (stack?.item === item) total += stack.count;
  return total;
}

/** Saved item key: an unknown item goes back to the key it was saved with. */
export function savedItemKey(stack: Readonly<ItemStack>): string {
  return stack.original ?? stack.item;
}

/**
 * Loaded item key (docs « Clés inconnues au chargement »): a key the pack does not have becomes the
 * pack's unknown item, which keeps the key (saved back as it was).
 */
export function loadItemKey(stack: ItemStack, registry: Registry): void {
  if (registry.itemId(stack.item) >= 0) return;
  stack.original = stack.item;
  stack.item = registry.unknownItem;
}

/** Copy for saving (text keys, plain JSON). */
export function serializeInventory(inventory: Inventory): Inventory {
  return inventory.map((stack) => {
    if (!stack) return null;
    const saved: ItemStack = { item: savedItemKey(stack), count: stack.count };
    if (stack.durability !== undefined) saved.durability = stack.durability;
    return saved;
  });
}

const isWhole = (v: unknown, min: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min;

/**
 * Reads a saved inventory: malformed slots become empty, the slot count is fixed, unknown items
 * keep their key (loadItemKey).
 */
export function deserializeInventory(data: unknown, registry: Registry): Inventory {
  const inventory = createInventory();
  if (!Array.isArray(data)) return inventory;
  for (let i = 0; i < INVENTORY_SLOTS; i++) {
    const saved = data[i] as Partial<ItemStack> | null | undefined;
    if (!saved || typeof saved.item !== 'string' || !isWhole(saved.count, 1)) continue;
    const stack: ItemStack = { item: saved.item, count: saved.count };
    if (isWhole(saved.durability, 0)) stack.durability = saved.durability;
    loadItemKey(stack, registry);
    inventory[i] = stack;
  }
  return inventory;
}
