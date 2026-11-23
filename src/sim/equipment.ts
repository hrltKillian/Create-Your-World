import type { Registry } from '../content/registry.ts';
import { WEAR_SLOTS } from '../content/schema.ts';
import { reject, validSlotMove } from './commandRules.ts';
import { type EquipCommand, OPEN_SLOTS_BASE } from './commands.ts';
import type { SimEvent } from './events.ts';
import {
  INVENTORY_SLOTS,
  type Inventory,
  type ItemStack,
  moveInto,
  moveStack,
  quickMove,
  spendUses,
} from './inventory.ts';
import type { PlayerState } from './player.ts';

/*
 * Worn equipment (docs « Inventaire », « Équipement de danger »): five slots from the head down,
 * filled from the Bag (`equip.move`). What worn items do is read where it matters: warmth and
 * cooling in the thermal model, the air filter and waterproof boots in environment.ts
 * (`wornGear`), armour with combat (M10). A filter wears one use per second it filters a toxic
 * air; other gear wears per hit absorbed (M10).
 */

/** The equipment slot (index in WEAR_SLOTS) an item is worn in, −1 if it is not wearable. */
export function wearSlotOf(registry: Registry, item: string): number {
  const wear = registry.item(item)?.wear;
  return wear ? WEAR_SLOTS.indexOf(wear.slot) : -1;
}

/** Applies an equip.move of a player (refusing what changes nothing or does not fit). */
export function applyEquipCommand(
  registry: Registry,
  player: PlayerState,
  command: EquipCommand,
  out: SimEvent[],
): void {
  const refusal = validSlotMove(command) ? equipMove(registry, player, command) : 'invalid';
  if (refusal) reject(out, player.playerId, command.type, refusal);
  else out.push({ type: 'inventoryChanged', playerId: player.playerId });
}

/** Slots and index of a slot number: the inventory (0–31), then the worn items. */
function side(player: PlayerState, slot: number): [Inventory, number] | null {
  if (slot < OPEN_SLOTS_BASE) return [player.inventory, slot];
  const index = slot - OPEN_SLOTS_BASE;
  return index < player.equipment.length ? [player.equipment, index] : null;
}

/** Whether a stack may lie in a slot: anything in the inventory, a wearable in its own box. */
function fits(
  registry: Registry,
  player: PlayerState,
  slots: Inventory,
  index: number,
  stack: ItemStack | null | undefined,
): boolean {
  return !stack || slots !== player.equipment || wearSlotOf(registry, stack.item) === index;
}

/** A move with the worn items; returns the refusal, if any. */
function equipMove(registry: Registry, player: PlayerState, c: EquipCommand): string | null {
  const from = side(player, c.from);
  if (!from) return 'invalid';
  const [source, index] = from;
  if (!source[index]) return 'nothing to move';
  if (c.to === undefined) return quickEquip(registry, player, index, source) ? null : 'no room';
  const to = side(player, c.to);
  if (!to) return 'invalid';
  const [target, slot] = to;
  // The stack goes there and, when two stacks swap, the other one comes back here.
  if (
    !fits(registry, player, target, slot, source[index]) ||
    !fits(registry, player, source, index, target[slot])
  )
    return 'does not fit';
  return moveStack(registry, source, index, target, slot, c.count) ? null : 'nothing to move';
}

/**
 * Shift+click: puts a wearable on (swapping what was worn there), takes a worn item off into the
 * inventory, and moves anything else between the hotbar and the bag.
 */
function quickEquip(
  registry: Registry,
  player: PlayerState,
  index: number,
  source: Inventory,
): boolean {
  const inventory = player.inventory;
  if (source === player.equipment)
    return moveInto(registry, source, index, inventory, 0, INVENTORY_SLOTS);
  const wear = wearSlotOf(registry, source[index]!.item);
  if (wear < 0) return quickMove(inventory, registry, index);
  return moveStack(registry, source, index, player.equipment, wear);
}

/**
 * One second of a toxic air (the filtered toxicity above 0): every worn filter loses a use, and
 * one worn out is gone. Called once a second by the survival step; allocates nothing.
 */
export function wearFilters(registry: Registry, player: PlayerState, out: SimEvent[]): void {
  if (player.survival.airToxicity <= 0) return;
  const equipment = player.equipment;
  for (let i = 0; i < equipment.length; i++) {
    const stack = equipment[i];
    if (!stack || registry.item(stack.item)?.wear?.airFilter === undefined) continue;
    if (spendUses(registry, equipment, i, 1))
      out.push({ type: 'inventoryChanged', playerId: player.playerId });
  }
}
