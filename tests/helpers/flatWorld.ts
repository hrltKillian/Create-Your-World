import { VoxelWorld } from '../../src/world/VoxelWorld.ts';
import { registry } from './registry.ts';

/** An empty world with the columns of [-r, r]² loaded. */
export function emptyWorld(columnRadius: number): VoxelWorld {
  const world = new VoxelWorld(registry.air, registry.unknownBlock);
  for (let cx = -columnRadius; cx <= columnRadius; cx++)
    for (let cz = -columnRadius; cz <= columnRadius; cz++) world.ensureColumn(cx, cz);
  return world;
}

/** Stone floor at y = 63 (feet stand at y = 64) over x, z in [-40, 40), on columns -2…2. */
export function flatWorld(): VoxelWorld {
  const world = emptyWorld(2);
  const stone = registry.defaultState('block:stone');
  for (let x = -40; x < 40; x++) for (let z = -40; z < 40; z++) world.setBlock(x, 63, z, stone);
  return world;
}
