import type { Registry } from '../content/registry.ts';
import { WEAR_SLOTS } from '../content/schema.ts';
import type { SimEvent } from './events.ts';
import { spendUses } from './inventory.ts';
import type { PlayerState } from './player.ts';

/*
 * Worn equipment (docs « Inventaire », « Équipement de danger »): five slots from the head down,
 * filled from the Bag (slotClicks.ts: a wearable only goes in its own slot). What worn items do is
 * read where it matters: warmth and cooling in the thermal model, the air filter and waterproof
 * boots in environment.ts (`wornGear`), armour with combat (M10). A filter wears one use per second it filters a toxic
 * air; other gear wears one use per creature hit it takes (`wearGear`).
 */

/** The equipment slot (index in WEAR_SLOTS) an item is worn in, −1 if it is not wearable. */
export function wearSlotOf(registry: Registry, item: string): number {
  const wear = registry.item(item)?.wear;
  return wear ? WEAR_SLOTS.indexOf(wear.slot) : -1;
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

/**
 * A creature's hit landed: every worn piece of this pack but a filter loses a use, and one worn out
 * is gone (an unknown item kept from another pack is left as it is).
 */
export function wearGear(registry: Registry, player: PlayerState, out: SimEvent[]): void {
  const equipment = player.equipment;
  let changed = false;
  for (let i = 0; i < equipment.length; i++) {
    const stack = equipment[i];
    const wear = stack && registry.item(stack.item)?.wear;
    if (!wear || wear.airFilter !== undefined) continue;
    spendUses(registry, equipment, i, 1);
    changed = true;
  }
  if (changed) out.push({ type: 'inventoryChanged', playerId: player.playerId });
}
