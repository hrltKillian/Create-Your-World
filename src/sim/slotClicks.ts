import { fuelSlotOf, stationAccepts } from '../content/crafting.ts';
import type { StationEntity } from './blockEntities.ts';
import { reject, validSlotCommand } from './commandRules.ts';
import { OPEN_SLOTS_BASE, type SlotCommand } from './commands.ts';
import { wearSlotOf } from './equipment.ts';
import type { SimEvent } from './events.ts';
import {
  type Inventory,
  moveInto,
  moveStack,
  quickMove,
  sameStack,
  takeFromSlot,
} from './inventory.ts';
import { throwStack } from './inventoryCommands.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';
import { openedEntity } from './screens.ts';

/*
 * The rules of the clicks on a slot screen (decision 20, as in Minecraft), the only way items move
 * between the inventory, the worn items and an open chest or station. The player's cursor holds
 * one stack (PlayerState.cursor) while a screen is open (screens.ts):
 * - left click: takes a slot's stack, puts the cursor's down, merges it, or swaps the two;
 * - right click: takes half a slot's stack (rounded up), or puts one item of the cursor's down;
 * - Shift+click (either button): sends a slot's stack across, the cursor left as it is: inventory
 *   ⇄ the open chest or station; in the Bag a wearable on (swapping what was worn), a worn item
 *   off, anything else hotbar ⇄ bag;
 * - a click outside the panel (slot −1) throws the cursor's stack (left) or one of its items
 *   (right);
 * - a hotbar key over a slot swaps it with that hotbar slot (refused while the cursor holds
 *   anything).
 * A slot only takes what it may hold: anything in the inventory and a chest, a wearable in its own
 * worn slot, a station's layout (`stationAccepts`: its outputs take nothing, so a click there only
 * takes, onto a cursor of the same item too), nothing a workbench's outputs. Every refusal changes
 * nothing.
 */

/** Applies a slot command of a player, announcing the change or the refusal. */
export function applySlotCommand(
  sim: Simulation,
  player: PlayerState,
  command: SlotCommand,
  out: SimEvent[],
): void {
  const refusal = validSlotCommand(command) ? slotCommand(sim, player, command) : 'invalid';
  if (refusal) reject(out, player.playerId, command.type, refusal);
  else out.push({ type: 'inventoryChanged', playerId: player.playerId });
}

/** A slot command on the open screen; returns the refusal, if any. */
function slotCommand(sim: Simulation, player: PlayerState, c: SlotCommand): string | null {
  if (!player.screen) return 'no screen';
  if (c.type === 'slot.hotkey') return hotkey(sim, player, c.slot, c.hotbar);
  if (c.slot < 0) return throwCursor(sim, player, c.button);
  const at = slotAt(sim, player, c.slot);
  if (!at) return 'invalid';
  const [slots, index] = at;
  if (c.shift) return quickMoveFrom(sim, player, slots, index);
  return click(sim, player, slots, index, c.button === 1);
}

/**
 * The slot array and index of a slot number of the open screen: the inventory below
 * OPEN_SLOTS_BASE, then the Bag's worn items or the open chest's or station's slots; null past
 * them.
 */
function slotAt(sim: Simulation, player: PlayerState, slot: number): [Inventory, number] | null {
  const inventory = player.inventory;
  if (slot < OPEN_SLOTS_BASE) return slot < inventory.length ? [inventory, slot] : null;
  const open = player.screen?.kind === 'bag' ? player.equipment : openedEntity(sim, player)?.slots;
  const index = slot - OPEN_SLOTS_BASE;
  return open && index < open.length ? [open, index] : null;
}

/** Whether a slot of the open screen may hold an item. */
function takes(
  sim: Simulation,
  player: PlayerState,
  slots: Inventory,
  index: number,
  item: string,
): boolean {
  if (slots === player.inventory) return true;
  if (slots === player.equipment) return wearSlotOf(sim.registry, item) === index;
  const entity = openedEntity(sim, player);
  // A workbench's slots are all outputs.
  if (entity?.kind === 'workbench') return false;
  if (entity?.kind !== 'station') return true;
  const crafting = sim.registry.crafting;
  const def = crafting.station(entity.station);
  return def !== undefined && stationAccepts(crafting, def, index, item);
}

/**
 * The cursor as a one-slot array while a click runs, so the slot array moves (moveStack) serve it
 * too; allocates nothing.
 */
const hand: Inventory = [null];

/** A left or right click on a slot; returns the refusal, if any. */
function click(
  sim: Simulation,
  player: PlayerState,
  slots: Inventory,
  index: number,
  right: boolean,
): string | null {
  const registry = sim.registry;
  const there = slots[index];
  const cursor = player.cursor;
  let refusal: string | null = null;
  hand[0] = cursor;
  if (!cursor) {
    // Takes the stack, or half of it (rounded up).
    const half = there && right ? Math.ceil(there.count / 2) : undefined;
    if (!moveStack(registry, slots, index, hand, 0, half)) refusal = 'nothing to move';
  } else if (takes(sim, player, slots, index, cursor.item)) {
    // Puts the stack down (merging what fits), or one item of it; a different stack swaps.
    const swap = there !== null && there !== undefined && !sameStack(there, cursor);
    const count = right && !swap ? 1 : undefined;
    if (!moveStack(registry, hand, 0, slots, index, count)) refusal = 'nothing to move';
  } else if (there && sameStack(there, cursor)) {
    // A slot that takes nothing of the cursor's (a station's output): its stack joins the cursor's.
    if (!moveStack(registry, slots, index, hand, 0)) refusal = 'nothing to move';
  } else refusal = 'slot';
  player.cursor = hand[0] ?? null;
  hand[0] = null;
  return refusal;
}

/**
 * Shift+click: sends a slot's whole stack across (the cursor left as it is); returns the refusal,
 * if any.
 */
function quickMoveFrom(
  sim: Simulation,
  player: PlayerState,
  slots: Inventory,
  index: number,
): string | null {
  const registry = sim.registry;
  const stack = slots[index];
  if (!stack) return 'nothing to move';
  const inventory = player.inventory;
  let moved: boolean;
  if (slots !== inventory) {
    // From the worn items, a chest or a station, into the inventory (hotbar first).
    moved = moveInto(registry, slots, index, inventory, 0, inventory.length);
  } else if (player.screen?.kind === 'bag') {
    const wear = wearSlotOf(registry, stack.item);
    moved =
      wear < 0
        ? quickMove(inventory, registry, index)
        : moveStack(registry, inventory, index, player.equipment, wear);
  } else {
    const entity = openedEntity(sim, player);
    if (!entity) return 'not open';
    if (entity.kind === 'station') return intoStation(sim, entity, inventory, index);
    if (entity.kind === 'workbench') return 'slot';
    moved = moveInto(registry, inventory, index, entity.slots, 0, entity.slots.length);
  }
  return moved ? null : 'nothing to move';
}

/**
 * Shift+click into a station: its fuel slot first when its fire burns the item, then its inputs
 * when one of its processes uses it. Anything else stays in the inventory ('slot').
 */
function intoStation(
  sim: Simulation,
  station: StationEntity,
  source: Inventory,
  index: number,
): string | null {
  const registry = sim.registry;
  const def = registry.crafting.station(station.station);
  if (!def) return 'slot';
  const item = source[index]!.item;
  const fuel = fuelSlotOf(def);
  const burns = fuel >= 0 && stationAccepts(registry.crafting, def, fuel, item);
  const feeds = registry.crafting.feeds(def, item);
  if (!burns && !feeds) return 'slot';
  let moved = burns && moveInto(registry, source, index, station.slots, fuel, fuel + 1);
  if (feeds && source[index])
    moved = moveInto(registry, source, index, station.slots, 0, def.inputSlots) || moved;
  return moved ? null : 'nothing to move';
}

/** A click outside the panel: throws the cursor's stack (left) or one of its items (right). */
function throwCursor(sim: Simulation, player: PlayerState, button: 0 | 1): string | null {
  const cursor = player.cursor;
  if (!cursor) return 'nothing to move';
  hand[0] = cursor;
  const thrown = takeFromSlot(hand, 0, button === 0 ? cursor.count : 1)!;
  player.cursor = hand[0] ?? null;
  hand[0] = null;
  throwStack(sim, player, thrown);
  return null;
}

/**
 * A hotbar key over a slot: the slot's stack goes to that hotbar slot (merging, or swapping with
 * what is there when the slot takes it), or the hotbar's comes to an empty slot that takes it.
 * Returns the refusal, if any.
 */
function hotkey(sim: Simulation, player: PlayerState, slot: number, hotbar: number): string | null {
  if (player.cursor) return 'cursor';
  const at = slotAt(sim, player, slot);
  if (!at) return 'invalid';
  const [slots, index] = at;
  const inventory = player.inventory;
  if (slots === inventory && index === hotbar) return 'nothing to move';
  const here = slots[index];
  const held = inventory[hotbar];
  const swaps = held && !(here && sameStack(here, held));
  if (swaps && !takes(sim, player, slots, index, held.item)) return 'slot';
  const registry = sim.registry;
  const moved = here
    ? moveStack(registry, slots, index, inventory, hotbar)
    : moveStack(registry, inventory, hotbar, slots, index);
  return moved ? null : 'nothing to move';
}
