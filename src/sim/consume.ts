import type { ItemDef } from '../content/schema.ts';
import { ticksOf } from './clock.ts';
import type { SimEvent } from './events.ts';
import { freshStack, spendUses, takeFromSlot } from './inventory.ts';
import { giveItems } from './inventoryCommands.ts';
import { NO_USE, type PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';
import { adjustGauges } from './survival.ts';
import { aimedLiquid, fill, sip } from './water.ts';

/*
 * What the held secondary button does before placing (docs « Priorité des actions », after an
 * interactive block): eat or drink the held item (held `consume.seconds`; a container one charge
 * at a time), fill a held empty container from the aimed liquid (on the press), or sip from it with
 * the hand empty (held `water.sipSec`). A held action is the one the press started: another hand
 * or target stops it until the button is pressed again (a container just filled is not drunk).
 */

/** `interaction.useItem` of a sip. */
const SIP = -1;

/** Counts the ticks of the held action; true each time it is done (it then starts over). */
function held(player: PlayerState, pressed: boolean, action: number, ticks: number): boolean {
  const st = player.interaction;
  if (pressed) {
    st.useItem = action;
    st.useTicks = 0;
  }
  if (st.useItem !== action) return false;
  if (++st.useTicks < ticks) return false;
  st.useTicks = 0;
  return true;
}

/**
 * One tick of the secondary button held past the interactive blocks; `pressed` on its first tick.
 * Returns false when it has nothing to eat, drink or fill (the hand places instead).
 */
export function holdUse(
  sim: Simulation,
  player: PlayerState,
  pressed: boolean,
  out: SimEvent[],
): boolean {
  const registry = sim.registry;
  const stack = player.inventory[player.input.slot];
  const id = stack ? registry.itemId(stack.item) : -1;
  const def = id < 0 ? undefined : registry.items[id];
  if (def?.consume) {
    if (held(player, pressed, id, ticksOf(def.consume.seconds))) consume(sim, player, def, out);
    return true;
  }
  if (stack && def?.container?.contents !== 'empty') return false;
  const liquid = aimedLiquid(sim, player);
  if (liquid < 0) return false;
  if (stack) {
    if (!pressed) return true;
    player.interaction.useItem = NO_USE;
    return fill(sim, player, liquid, out);
  }
  if (registry.blockDef(liquid).liquid?.drinkable !== true) return false;
  if (held(player, pressed, SIP, ticksOf(registry.pack.balance.water.sipSec)))
    sip(sim, player, liquid, out);
  return true;
}

/**
 * Eats or drinks one of the held item: its gauges, then one item fewer (and what it `returns`),
 * or one charge fewer for a container, which the last one leaves empty.
 */
function consume(sim: Simulation, player: PlayerState, def: ItemDef, out: SimEvent[]): void {
  const registry = sim.registry;
  const c = def.consume!;
  const b = registry.pack.balance;
  adjustGauges(player.survival, b, c.hunger ?? 0, c.thirst ?? 0, c.health ?? 0, c.toxicity ?? 0);
  const inventory = player.inventory;
  const slot = player.input.slot;
  if (def.container) {
    if (spendUses(registry, inventory, slot, 1))
      inventory[slot] = freshStack(registry, def.container.emptyAs, 1);
  } else {
    takeFromSlot(inventory, slot, 1);
    if (c.returns) giveItems(sim, player, freshStack(registry, c.returns, 1), out);
  }
  out.push({ type: 'inventoryChanged', playerId: player.playerId });
  out.push({ type: 'consumed', playerId: player.playerId, item: def.key });
}
