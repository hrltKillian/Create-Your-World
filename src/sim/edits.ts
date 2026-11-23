import type { RawTables } from '../content/registry.ts';
import { columnIndex, toColumn, toLocal, WORLD_HEIGHT } from '../world/coords.ts';
import { blockOf, skyOf } from '../world/light.ts';
import { FACE_NORMALS } from '../world/raycast.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import type { SimEvent } from './events.ts';

/**
 * Writes one voxel changed by gameplay (break, place, toggle) in a loaded column: keeps the
 * heightmap right, gives the cell an approximate light and asks for a remesh. Returns false outside
 * the loaded world.
 */
export function editBlock(
  world: VoxelWorld,
  tables: RawTables,
  x: number,
  y: number,
  z: number,
  state: number,
  out: SimEvent[],
): boolean {
  if (y < 0 || y >= WORLD_HEIGHT) return false;
  const column = world.getColumn(toColumn(x), toColumn(z));
  if (!column) return false;
  world.setBlock(x, y, z, state);
  const cell = columnIndex(toLocal(x), toLocal(z));
  const top = column.heightmap[cell]!;
  if (state !== world.air) {
    if (y + 1 > top) column.heightmap[cell] = y + 1;
  } else if (y + 1 === top) {
    let h = y;
    while (h > 0 && world.getBlock(x, h - 1, z) === world.air) h--;
    column.heightmap[cell] = h;
  }
  approximateLight(world, tables, x, y, z, state);
  out.push({ type: 'blocksChanged', x0: x, y0: y, z0: z, x1: x, y1: y, z1: z });
  return true;
}

/**
 * Stand-in for the light engine (M5): the edited cell takes full sky light when nothing above
 * filters it, else its brightest neighbour minus one, and its own emission. Only this cell
 * changes, so a fresh hole is not black; the light engine will propagate edits properly.
 */
function approximateLight(
  world: VoxelWorld,
  tables: RawTables,
  x: number,
  y: number,
  z: number,
  state: number,
): void {
  const filter = tables.lightFilter[state]!;
  let sky = 0;
  let block = 0;
  if (filter < 15) {
    for (let f = 0; f < 18; f += 3) {
      const light = world.getLight(
        x + FACE_NORMALS[f]!,
        y + FACE_NORMALS[f + 1]!,
        z + FACE_NORMALS[f + 2]!,
      );
      sky = Math.max(sky, skyOf(light));
      block = Math.max(block, blockOf(light));
    }
    let open = true;
    for (let above = y + 1; above < WORLD_HEIGHT && open; above++)
      open = tables.lightFilter[world.getBlock(x, above, z)] === 0;
    sky = Math.max(0, (open ? 15 : sky - 1) - filter);
    block = Math.max(0, block - 1 - filter);
  }
  block = Math.max(block, tables.emit[state]!);
  world.setLight(x, y, z, (sky << 4) | block);
}
