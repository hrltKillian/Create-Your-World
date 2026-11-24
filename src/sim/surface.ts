import { COLLISION_FULL, COLLISION_NONE } from '../content/registry.ts';
import {
  columnKey,
  localIndex,
  SECTION_SIZE,
  SECTIONS_PER_COLUMN,
  toColumn,
  toLocal,
} from '../world/coords.ts';
import { surfaceY } from '../world/gen/generateColumn.ts';
import type { SavedSection } from '../world/protocol.ts';
import type { Simulation } from './Simulation.ts';

/**
 * Feet height on top of the ground of the block column (x, z), resolved at once: the heightmap of
 * a loaded column, else the analytic height (generated decorations aside), under the saved
 * sections of an edited column, so a body never lands inside what was built there.
 */
export function surfaceAt(sim: Simulation, x: number, z: number): number {
  const top = sim.world.heightAt(x, z);
  if (top >= 0) return top;
  const ground = surfaceY(sim.ctx, x, z);
  const saved = sim.edits.get(columnKey(toColumn(x), toColumn(z)));
  return saved ? savedSurface(saved, toLocal(x), toLocal(z), ground, sim.world.air) : ground;
}

/**
 * Collision of the cell (x, y, z) (a `RawTables.collision` value), resolved at once like
 * `surfaceAt`: the block of a loaded column, else of its saved section, else the generated ground
 * below the analytic height (full) and air above it (decorations aside).
 */
export function collisionAt(sim: Simulation, x: number, y: number, z: number): number {
  const { world } = sim;
  const tables = sim.registry.tables;
  if (world.heightAt(x, z) >= 0) return tables.collision[world.getBlock(x, y, z)]!;
  const saved = sim.edits.get(columnKey(toColumn(x), toColumn(z)));
  const section = saved?.find((s) => s.sy === Math.floor(y / SECTION_SIZE));
  if (section) {
    const ly = y - section.sy * SECTION_SIZE;
    const state =
      section.blocks === null
        ? section.uniformBlock
        : section.blocks[localIndex(toLocal(x), ly, toLocal(z))]!;
    return tables.collision[state]!;
  }
  return y < surfaceY(sim.ctx, x, z) ? COLLISION_FULL : COLLISION_NONE;
}

/**
 * Top of an unloaded column with saved sections (the highest non-air block + 1, as a heightmap):
 * a saved section gives its blocks, any other one is the generated ground below `ground`.
 */
function savedSurface(
  saved: readonly SavedSection[],
  lx: number,
  lz: number,
  ground: number,
  air: number,
): number {
  for (let sy = SECTIONS_PER_COLUMN - 1; sy >= 0; sy--) {
    const section = saved.find((s) => s.sy === sy);
    for (let ly = SECTION_SIZE - 1; ly >= 0; ly--) {
      const y = sy * SECTION_SIZE + ly;
      if (section === undefined) {
        if (y < ground) return y + 1;
        continue;
      }
      const state =
        section.blocks === null ? section.uniformBlock : section.blocks[localIndex(lx, ly, lz)]!;
      if (state !== air) return y + 1;
    }
  }
  return 0;
}
