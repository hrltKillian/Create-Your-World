import { spill, type WorkbenchEntity } from './blockEntities.ts';
import { progressCraft } from './craftQueue.ts';
import type { SimEvent } from './events.ts';
import { addToRange, freshStack, roomFor } from './inventory.ts';
import type { Simulation } from './Simulation.ts';

/*
 * Workbenches (docs « Craft : le Logbook », decision 18). A player with the Workbench screen open
 * queues its station's recipes (craftQueue.ts: the ingredients reserved from that player, entries
 * merged as in a player's own queue); the bench then makes them on its own at tick step 9, into
 * its outputs, whoever stands by. Full outputs pause the queue (its progress kept) until someone
 * takes from them. Like a station, a workbench only ticks inside the simulation radius and catches
 * up tick by tick when it comes back into it (stations.ts `stepStations`).
 */

/**
 * One tick of a workbench. Returns false when nothing happened (an empty queue, or full outputs):
 * the bench then stays as it is until something outside changes it, which ends a catch-up early
 * with the same result as ticking on.
 */
export function stepWorkbench(sim: Simulation, bench: WorkbenchEntity, out: SimEvent[]): boolean {
  const entry = bench.craft[0];
  if (!entry) return false;
  const registry = sim.registry;
  const recipe = registry.crafting.recipe(entry.recipe);
  const { x, y, z, slots } = bench;
  if (!recipe) {
    // A recipe the pack no longer has (a save from another pack): its ingredients drop here.
    bench.craft.shift();
    spill(sim, entry.reserved, x, y, z);
    return true;
  }
  const output = recipe.output;
  // Full outputs pause the queue. The output without its wear finds the same room: anything with
  // wear stacks to 1, so it only ever goes into an empty slot.
  if (!roomFor(slots, registry, 0, slots.length, output)) return false;
  if (!progressCraft(registry, entry, recipe)) return true;
  const { item, count } = output;
  addToRange(slots, registry, 0, slots.length, freshStack(registry, item, count));
  if (entry.count === 0) bench.craft.shift();
  out.push({ type: 'workbenchCrafted', x, y, z, recipe: recipe.key, item, count });
  return true;
}

/** `ticks` ticks of a workbench, stopping once a tick changes nothing (stepWorkbench). */
export function advanceWorkbench(
  sim: Simulation,
  bench: WorkbenchEntity,
  ticks: number,
  out: SimEvent[],
): void {
  for (let i = 0; i < ticks; i++) if (!stepWorkbench(sim, bench, out)) return;
}
