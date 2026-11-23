import { columnIndex, SECTION_BITS, toColumn, toLocal, WORLD_HEIGHT } from '../world/coords.ts';
import type { LightEngine } from '../world/light/LightEngine.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import type { SimEvent } from './events.ts';

/**
 * Writes one voxel in a loaded column: marks its section persisted (kept when the column unloads),
 * keeps the heightmap right and hands the cell to the light engine, which resolves it at the light
 * step. Returns false outside the loaded world.
 */
export function writeBlock(
  world: VoxelWorld,
  light: LightEngine,
  x: number,
  y: number,
  z: number,
  state: number,
): boolean {
  if (y < 0 || y >= WORLD_HEIGHT) return false;
  const column = world.getColumn(toColumn(x), toColumn(z));
  if (!column) return false;
  if (world.getBlock(x, y, z) === state) return true;
  world.setBlock(x, y, z, state);
  column.persisted |= 1 << (y >> SECTION_BITS);
  const cell = columnIndex(toLocal(x), toLocal(z));
  const top = column.heightmap[cell]!;
  if (state !== world.air) {
    if (y + 1 > top) column.heightmap[cell] = y + 1;
  } else if (y + 1 === top) {
    let h = y;
    while (h > 0 && world.getBlock(x, h - 1, z) === world.air) h--;
    column.heightmap[cell] = h;
  }
  light.edited(x, y, z);
  return true;
}

/** A gameplay edit (break, place, toggle): `writeBlock` plus the remesh of the cell. */
export function editBlock(
  world: VoxelWorld,
  light: LightEngine,
  x: number,
  y: number,
  z: number,
  state: number,
  out: SimEvent[],
): boolean {
  if (!writeBlock(world, light, x, y, z, state)) return false;
  out.push({ type: 'blocksChanged', x0: x, y0: y, z0: z, x1: x, y1: y, z1: z });
  return true;
}

/**
 * Light step of a tick: the edits are resolved to completion and the light they changed is
 * remeshed (urgent, like the edits), then the seams are stitched for at most `budget` nodes.
 * Seam light never needs a remesh: it reaches at most 14 blocks from a seam, inside columns that
 * cannot be MESHABLE before that seam is stitched and its entries are drained.
 */
export function stepLight(light: LightEngine, budget: number, out: SimEvent[]): void {
  if (light.flush()) {
    const b = light.changed;
    out.push({ type: 'blocksChanged', x0: b.x0, y0: b.y0, z0: b.z0, x1: b.x1, y1: b.y1, z1: b.z1 });
  }
  light.stitch(budget);
}
