import { Column } from '../world/Column.ts';
import {
  columnKey,
  localIndex,
  SECTION_SIZE,
  SECTIONS_PER_COLUMN,
  toColumn,
  toLocal,
} from '../world/coords.ts';
import { generateColumn, surfaceY } from '../world/gen/generateColumn.ts';
import { restoreSections } from '../world/gen/generateResult.ts';
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
 * Collision of cells (a `RawTables.collision` value), resolved at once: the block of a loaded
 * column, else of the column generated here (decoration and caves included) under its saved
 * sections, kept for the reader's lifetime (a few milliseconds a column: respawns only).
 */
export function collisionReader(sim: Simulation): (x: number, y: number, z: number) => number {
  const { world } = sim;
  const collision = sim.registry.tables.collision;
  const generated = new Map<number, Column>();
  return (x, y, z) => {
    if (world.heightAt(x, z) >= 0) return collision[world.getBlock(x, y, z)]!;
    const cx = toColumn(x);
    const cz = toColumn(z);
    const key = columnKey(cx, cz);
    let column = generated.get(key);
    if (!column) {
      column = new Column(cx, cz, world.air);
      generateColumn(sim.ctx, column);
      const saved = sim.edits.get(key);
      // Read only: the saved arrays are shared, never written through this column.
      if (saved) restoreSections(column, saved, world.air);
      generated.set(key, column);
    }
    return collision[column.getBlock(toLocal(x), y, toLocal(z))]!;
  };
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
