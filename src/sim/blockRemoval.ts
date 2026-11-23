import { forgetGrave } from './death.ts';
import type { Simulation } from './Simulation.ts';
import { forgetBed } from './sleep.ts';

/**
 * The one hook for a block removed from the world (broken, filled over, taken back): what players
 * kept about the cell goes with it. A bedroll is no longer anyone's respawn point nor slept on; an
 * Abandoned Pack no longer marks a compass. `state` is the block the cell held. What its block
 * entity held is spilled by `removeBlockEntity` (blockEntities.ts).
 */
export function forgetCell(sim: Simulation, x: number, y: number, z: number, state: number): void {
  const kind = sim.registry.blockDef(state).blockEntity;
  if (kind === 'bed') forgetBed(sim, x, y, z);
  else if (kind === 'grave') forgetGrave(sim, x, y, z);
}
