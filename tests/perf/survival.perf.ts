import { describe, expect, it } from 'vitest';
import { heatAround } from '../../src/sim/environment.ts';
import { litWorld, STONE } from '../helpers/lightWorld.ts';
import { registry } from '../helpers/registry.ts';

/**
 * Environment sample of one player (every second), on Apple M4 under plain Node: the heat scan
 * around the player in a room of rock, median after a warm-up. One column lookup per block column
 * of the scan, not per voxel: about 10 µs (23 before).
 */
const HEAT_MEDIAN_MS = 0.03;

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

/** Calls per sample: a pause or deopt during one call cannot move the median. */
const BATCH = 20;

/** Median time of one `run` over 100 samples of BATCH calls, after 50 warm-up calls. */
function time(run: () => void): number {
  for (let i = 0; i < 50; i++) run();
  const times: number[] = [];
  for (let i = 0; i < 100; i++) {
    const t0 = performance.now();
    for (let j = 0; j < BATCH; j++) run();
    times.push((performance.now() - t0) / BATCH);
  }
  return median(times);
}

describe('survival performance', () => {
  it(`scans heat in ≤ ${HEAT_MEDIAN_MS} ms`, () => {
    // Solid rock around a dark 9×4×9 room with a lit campfire.
    const { world } = litWorld(1, (w) => {
      for (let x = -12; x <= 12; x++)
        for (let z = -12; z <= 12; z++)
          for (let y = 50; y <= 80; y++)
            if (Math.abs(x) > 4 || Math.abs(z) > 4 || y < 64 || y > 67) w.setBlock(x, y, z, STONE);
      w.setBlock(2, 64, 2, registry.stateId('block:campfire[lit=1]'));
    });
    let heat = 0;
    const heatMs = time(() => {
      heat = heatAround(world, registry.tables, 0.5, 64.9, 0.5, 2);
    });
    console.info(`heat median ${(heatMs * 1000).toFixed(1)} µs`);
    expect(heat).toBeGreaterThan(0);
    expect(heatMs).toBeLessThanOrEqual(HEAT_MEDIAN_MS);
  });
});
