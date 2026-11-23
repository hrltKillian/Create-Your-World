import { SECTION_SIZE } from '../coords.ts';
import { FLAT_SURFACE } from './flat.ts';
import { type GenContext, isFlatWorld } from './generateColumn.ts';
import { LatticeCache, pointInfo } from './sample.ts';

/** Provisional spawn (M2–M5): nearest dry column of a spawn biome, spiralling out from the origin. */
export function findSpawn(ctx: GenContext, maxRadius = 64): { x: number; y: number; z: number } {
  if (isFlatWorld(ctx.worldType)) return { x: 0.5, y: FLAT_SURFACE + 1, z: 0.5 };
  const cache = new LatticeCache();
  for (let r = 0; r <= maxRadius; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = dx * SECTION_SIZE + 16;
        const z = dz * SECTION_SIZE + 16;
        const info = pointInfo(ctx, x, z, cache);
        if (
          info.height >= ctx.def.seaLevel + 1 &&
          (ctx.spawnBiomes.size === 0 || ctx.spawnBiomes.has(info.biome))
        ) {
          return { x: x + 0.5, y: info.height + 1, z: z + 0.5 };
        }
      }
    }
  }
  return { x: 0.5, y: ctx.def.seaLevel + 2, z: 0.5 };
}
