import type { Crafting } from '../content/crafting.ts';
import type { Registry } from '../content/registry.ts';
import { isWhole } from '../core/guards.ts';
import { HOTBAR_SLOTS } from '../core/player.ts';

/**
 * Slots of an inventory (docs « Inventaire »): the hotbar (0–7) then the bag, 32 at first (a bag of
 * 6×4), up to 64 with upgrades. Its size is its length: every rule reads `inventory.length`.
 */
export const BASE_INVENTORY_SLOTS = 32;
export const MAX_INVENTORY_SLOTS = 64;

/** The size rule: a whole number of slots within [BASE_INVENTORY_SLOTS, MAX_INVENTORY_SLOTS]. */
export function inventorySize(slots: number): number {
  const whole = Number.isInteger(slots) ? slots : BASE_INVENTORY_SLOTS;
  return Math.min(MAX_INVENTORY_SLOTS, Math.max(BASE_INVENTORY_SLOTS, whole));
}

/** A stack of one item (text key, as saves store it). */
export interface ItemStack {
  item: string;
  count: number;
  /**
   * Uses left (`itemTables.durability`): a tool's, a wearable's wear, a filled container's
   * charges. Absent: as fresh.
   */
  durability?: number;
  /** Saved key of an item the pack no longer has (`item` is then the pack's unknown item). */
  original?: string;
}

/** Plain JSON: one entry per slot, null when empty. */
export type Inventory = (ItemStack | null)[];

/** An empty inventory of `size` slots (kept to the size rule). */
export function createInventory(size = BASE_INVENTORY_SLOTS): Inventory {
  return new Array<ItemStack | null>(inventorySize(size)).fill(null);
}

/**
 * Whether two stacks (or item drops) may merge: the same item saved under the same key (unknown
 * items of different keys stay apart), and neither carries wear.
 */
export function sameStack(a: Readonly<ItemStack>, b: Readonly<ItemStack>): boolean {
  return (
    a.item === b.item &&
    a.original === b.original &&
    a.durability === undefined &&
    b.durability === undefined
  );
}

/** A new stack of an item; a tool, a wearable or a filled container comes with all its uses. */
export function freshStack(registry: Registry, item: string, count: number): ItemStack {
  const id = registry.itemId(item);
  const durability = id < 0 ? 0 : registry.itemTables.durability[id]!;
  return durability > 0 ? { item, count, durability } : { item, count };
}

/**
 * Adds the items of `stack` (left as it is), topping up matching stacks first, then filling empty
 * slots (hotbar first). Returns the count that did not fit.
 */
export function addItem(
  inventory: Inventory,
  registry: Registry,
  stack: Readonly<ItemStack>,
): number {
  return addToRange(inventory, registry, 0, inventory.length, stack);
}

/** addItem within the slots [first, end) of any slot array (a chest, a station's outputs). */
export function addToRange(
  slots: Inventory,
  registry: Registry,
  first: number,
  end: number,
  stack: Readonly<ItemStack>,
): number {
  const max = registry.maxStack(stack.item);
  let left = stack.count;
  for (let i = first; i < end && left > 0; i++) {
    const target = slots[i];
    if (!target || !sameStack(target, stack) || target.count >= max) continue;
    const moved = Math.min(left, max - target.count);
    target.count += moved;
    left -= moved;
  }
  for (let i = first; i < end && left > 0; i++) {
    if (slots[i]) continue;
    const moved = Math.min(left, max);
    const added: ItemStack = { item: stack.item, count: moved };
    if (stack.durability !== undefined) added.durability = stack.durability;
    if (stack.original !== undefined) added.original = stack.original;
    slots[i] = added;
    left -= moved;
  }
  return left;
}

/** Whether all the items of `stack` fit in the slots [first, end) (the addToRange rule). */
export function roomFor(
  slots: Inventory,
  registry: Registry,
  first: number,
  end: number,
  stack: Readonly<ItemStack>,
): boolean {
  const max = registry.maxStack(stack.item);
  let room = 0;
  for (let i = first; i < end && room < stack.count; i++) {
    const target = slots[i];
    if (!target) room += max;
    else if (sameStack(target, stack)) room += Math.max(0, max - target.count);
  }
  return room >= stack.count;
}

/**
 * Spends uses of the stack of a slot (a tool's, worn gear's, a container's charges: its
 * `durability`, full when absent); a stack with none left is gone. Returns whether it went.
 */
export function spendUses(registry: Registry, slots: Inventory, slot: number, uses: number) {
  const stack = slots[slot];
  if (!stack) return false;
  const id = registry.itemId(stack.item);
  stack.durability =
    (stack.durability ?? (id < 0 ? 0 : registry.itemTables.durability[id]!)) - uses;
  if (stack.durability > 0) return false;
  slots[slot] = null;
  return true;
}

/**
 * Cuts every stack of a slot array over its item's maximum down to it (a pack that lowered a
 * maximum since the save). Returns the excess, one stack per cut stack (it may itself be over the
 * maximum: `addToRange` splits it), for the caller to place.
 */
export function fitStacks(registry: Registry, slots: Inventory): ItemStack[] {
  const excess: ItemStack[] = [];
  for (const stack of slots) {
    const max = stack ? registry.maxStack(stack.item) : 0;
    if (!stack || stack.count <= max) continue;
    excess.push({ ...stack, count: stack.count - max });
    stack.count = max;
  }
  return excess;
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
 * Moves `count` items (default: all) from a slot of one slot array to a slot of another, or of
 * the same: into an empty slot, onto a matching stack (up to its maximum), or swapping two whole
 * stacks. Returns whether anything moved.
 */
export function moveStack(
  registry: Registry,
  source: Inventory,
  from: number,
  target: Inventory,
  to: number,
  count?: number,
): boolean {
  const stack = source[from];
  if (!stack || (source === target && from === to)) return false;
  const amount = Math.min(count ?? stack.count, stack.count);
  const there = target[to];
  if (!there) {
    target[to] = takeFromSlot(source, from, amount);
    return true;
  }
  if (sameStack(there, stack)) {
    const moved = Math.min(amount, registry.maxStack(there.item) - there.count);
    if (moved <= 0) return false;
    there.count += moved;
    takeFromSlot(source, from, moved);
    return true;
  }
  if (amount !== stack.count) return false;
  source[from] = there;
  target[to] = stack;
  return true;
}

/** Moves a stack between the hotbar and the bag (merging first); returns whether anything moved. */
export function quickMove(inventory: Inventory, registry: Registry, slot: number): boolean {
  const toBag = slot < HOTBAR_SLOTS;
  const first = toBag ? HOTBAR_SLOTS : 0;
  const end = toBag ? inventory.length : HOTBAR_SLOTS;
  return moveInto(registry, inventory, slot, inventory, first, end);
}

/**
 * Moves a whole stack into the slots [first, end) of a slot array: onto matching stacks first,
 * then into empty slots. Returns whether anything moved.
 */
export function moveInto(
  registry: Registry,
  source: Inventory,
  from: number,
  target: Inventory,
  first: number,
  end: number,
): boolean {
  const stack = source[from];
  if (!stack) return false;
  const before = stack.count;
  const max = registry.maxStack(stack.item);
  for (let i = first; i < end && stack.count > 0; i++) {
    const there = target[i];
    if (!there || there === stack || !sameStack(there, stack) || there.count >= max) continue;
    const moved = Math.min(stack.count, max - there.count);
    there.count += moved;
    stack.count -= moved;
  }
  for (let i = first; i < end && stack.count > 0; i++) {
    if (target[i]) continue;
    target[i] = { ...stack };
    stack.count = 0;
  }
  if (stack.count === 0) source[from] = null;
  return stack.count !== before;
}

/** Items of the slots [first, end) that fill an ingredient (an item, or a tag: Crafting.matches). */
export function countMatching(
  slots: Inventory,
  first: number,
  end: number,
  crafting: Crafting,
  ingredient: string,
): number {
  let total = 0;
  for (let i = first; i < end; i++) {
    const stack = slots[i];
    if (stack && crafting.matches(stack.item, ingredient)) total += stack.count;
  }
  return total;
}

/**
 * Removes `count` items filling an ingredient from the slots [first, end), in slot order (the
 * caller checked countMatching). The stacks taken are pushed to `into` when given.
 */
export function takeMatching(
  slots: Inventory,
  first: number,
  end: number,
  crafting: Crafting,
  ingredient: string,
  count: number,
  into?: Inventory,
): void {
  let left = count;
  for (let i = first; i < end && left > 0; i++) {
    const stack = slots[i];
    if (!stack || !crafting.matches(stack.item, ingredient)) continue;
    const taken = Math.min(left, stack.count);
    if (into) into.push({ ...stack, count: taken });
    stack.count -= taken;
    left -= taken;
    if (stack.count === 0) slots[i] = null;
  }
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
  return inventory.map((stack) => (stack ? savedStack(stack) : null));
}

/** A stack as saved: its text key (an unknown item's own), count and wear. */
export function savedStack(stack: Readonly<ItemStack>): ItemStack {
  const saved: ItemStack = { item: savedItemKey(stack), count: stack.count };
  if (stack.durability !== undefined) saved.durability = stack.durability;
  return saved;
}

/** A saved stack, or null when malformed; an unknown item keeps its key (loadItemKey). */
export function readStack(data: unknown, registry: Registry): ItemStack | null {
  const saved = data as Partial<ItemStack> | null | undefined;
  if (!saved || typeof saved.item !== 'string' || !isWhole(saved.count, 1)) return null;
  const stack: ItemStack = { item: saved.item, count: saved.count };
  if (isWhole(saved.durability, 0)) stack.durability = saved.durability;
  loadItemKey(stack, registry);
  return stack;
}

/**
 * Reads a saved inventory: its size is the saved one kept to the size rule, malformed slots become
 * empty, unknown items keep their key (loadItemKey).
 */
export function deserializeInventory(data: unknown, registry: Registry): Inventory {
  const size = inventorySize(Array.isArray(data) ? data.length : BASE_INVENTORY_SLOTS);
  return deserializeSlots(data, size, registry);
}

/** deserializeInventory for any slot array of `size` slots (chests, stations). */
export function deserializeSlots(data: unknown, size: number, registry: Registry): Inventory {
  const slots = new Array<ItemStack | null>(size).fill(null);
  if (!Array.isArray(data)) return slots;
  for (let i = 0; i < size; i++) slots[i] = readStack(data[i], registry);
  return slots;
}
