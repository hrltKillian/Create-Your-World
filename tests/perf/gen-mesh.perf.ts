import { describe, expect, it } from 'vitest';
import { basePack } from '../../src/content/packs/base/index.ts';
import { buildRegistry } from '../../src/content/registry.ts';
import { Column } from '../../src/world/Column.ts';
import { createGenContext, generateColumn } from '../../src/world/gen/generateColumn.ts';
import { meshSection } from '../../src/world/mesh/greedyMesher.ts';
import { createPadded, fillPadded } from '../../src/world/mesh/padded.ts';
import { VoxelWorld } from '../../src/world/VoxelWorld.ts';

/**
 * Node thresholds measured on the development machine (Apple M4), set to about 0.6× the M1 target
 * (see docs/conception.md « Mesure de performance »). Medians, after a warm-up.
 */
const GEN_MEDIAN_MS = 10;
const MESH_MEDIAN_MS = 3;

const registry = buildRegistry(basePack);
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

describe('performance', () => {
  it(`generates a column in ≤ ${GEN_MEDIAN_MS} ms (median)`, () => {
    const ctx = createGenContext('perf', registry);
    const times: number[] = [];
    for (let i = 0; i < 45; i++) {
      const column = new Column(i % 9, Math.floor(i / 9), registry.air);
      const t0 = performance.now();
      generateColumn(ctx, column);
      if (i >= 5) times.push(performance.now() - t0);
    }
    console.info(`gen median ${median(times).toFixed(2)} ms`);
    expect(median(times)).toBeLessThanOrEqual(GEN_MEDIAN_MS);
  });

  it(`meshes a terrain section in ≤ ${MESH_MEDIAN_MS} ms (median)`, () => {
    const ctx = createGenContext('perf-mesh', registry);
    const world = new VoxelWorld(registry.air, registry.unknownBlock);
    for (let cx = -2; cx <= 2; cx++) {
      for (let cz = -2; cz <= 2; cz++) {
        const column = world.ensureColumn(cx, cz);
        generateColumn(ctx, column);
      }
    }
    const fill = {
      belowBlock: registry.unknownBlock,
      missingBlock: registry.unknownBlock,
      missingLight: 0,
      air: registry.air,
    };
    const padded = createPadded();
    const times: number[] = [];
    // Two passes over the same sections: the first one warms the JIT up (workers mesh thousands).
    for (let pass = 0; pass < 2; pass++) {
      for (let cx = -1; cx <= 1; cx++) {
        for (let cz = -1; cz <= 1; cz++) {
          for (let sy = 0; sy < 8; sy++) {
            if (world.getSection(cx, sy, cz)!.isEmpty(registry.air)) continue;
            fillPadded(world, cx, sy, cz, fill, padded);
            const t0 = performance.now();
            meshSection(padded, registry.tables);
            if (pass === 1) times.push(performance.now() - t0);
          }
        }
      }
    }
    const measured = times;
    console.info(`mesh median ${median(measured).toFixed(2)} ms over ${measured.length} sections`);
    expect(measured.length).toBeGreaterThan(10);
    expect(median(measured)).toBeLessThanOrEqual(MESH_MEDIAN_MS);
  });
});
