import { describe, expect, it } from 'vitest';
import { CAVE } from '../../../src/app/bench/cave.ts';
import { EYE_HEIGHT } from '../../../src/core/player.ts';
import { Occlusion } from '../../../src/render/Occlusion.ts';
import { SECTIONS_PER_COLUMN, sectionKey } from '../../../src/world/coords.ts';
import { findCave } from '../../../src/world/gen/find.ts';
import { createGenContext, generateColumn } from '../../../src/world/gen/generateColumn.ts';
import { findSpawn } from '../../../src/world/gen/spawn.ts';
import { createPadded, fillPadded } from '../../../src/world/mesh/padded.ts';
import { sectionConnectivity } from '../../../src/world/mesh/visibility.ts';
import { VoxelWorld } from '../../../src/world/VoxelWorld.ts';
import { registry } from '../../helpers/registry.ts';

/** The bench's render distance (preset Medium). */
const RD = 6;

/**
 * The cave benchmark's pose on real terrain: the world around it generated, each section's
 * connectivity mask computed as the mesher does, and the culling's walk from the eye. Returns the
 * sections with blocks within the render distance (those that get meshes) and those it shows.
 */
function caveView(seed: string): { meshed: number; shown: number } {
  const ctx = createGenContext(seed, registry);
  const cave = findCave(ctx, findSpawn(ctx), CAVE.radius, CAVE.minDepth);
  if (!cave) throw new Error(`no cave for seed ${seed}`);
  const world = new VoxelWorld(registry.air, registry.unknownBlock);
  const ccx = cave.x >> 5;
  const ccz = cave.z >> 5;
  // The walk reads the masks one ring of columns past the render distance.
  const reach = RD + 1;
  for (let cx = ccx - reach; cx <= ccx + reach; cx++)
    for (let cz = ccz - reach; cz <= ccz + reach; cz++)
      generateColumn(ctx, world.ensureColumn(cx, cz));
  const fill = {
    belowBlock: registry.unknownBlock,
    missingBlock: registry.unknownBlock,
    missingLight: 0,
    air: registry.air,
  };
  const padded = createPadded();
  const masks = new Map<number, number>();
  const meshed: [number, number, number][] = [];
  for (let cx = ccx - reach; cx <= ccx + reach; cx++) {
    for (let cz = ccz - reach; cz <= ccz + reach; cz++) {
      for (let sy = 0; sy < SECTIONS_PER_COLUMN; sy++) {
        // Empty sections get no mask (MeshScheduler): fully connected.
        if (world.getSection(cx, sy, cz)!.isEmpty(registry.air)) continue;
        fillPadded(world, cx, sy, cz, fill, padded);
        masks.set(sectionKey(cx, sy, cz), sectionConnectivity(padded.ids, registry.tables));
        const dx = cx - ccx;
        const dz = cz - ccz;
        if (dx * dx + dz * dz <= RD * RD) meshed.push([cx, sy, cz]);
      }
    }
  }
  const occlusion = new Occlusion();
  occlusion.update(cave.x + 0.5, cave.y + EYE_HEIGHT, cave.z + 0.5, RD, masks);
  const shown = meshed.filter(([cx, sy, cz]) => occlusion.visible(cx, sy, cz)).length;
  return { meshed: meshed.length, shown };
}

describe('cave culling on generated terrain', () => {
  // About 2 s: 225 columns generated and 1 800 sections walked under Vite's module runner.
  it('hides sections from the cave benchmark’s pose (bench seed 42)', {
    timeout: 30_000,
  }, () => {
    const { meshed, shown } = caveView('42');
    expect(meshed).toBeGreaterThan(300);
    // The wide, connected caves of plan v3 « M24 » are seen far through: a tenth at least is
    // still hidden (the benchmark's own threshold, docs « Mesure de performance »).
    expect(shown).toBeLessThanOrEqual(meshed * 0.9);
  });
});
