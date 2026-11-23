import { describe, expect, it } from 'vitest';
import { heatAround } from '../../src/sim/environment.ts';
import { shelterAt } from '../../src/sim/shelter.ts';
import { litWorld, STONE } from '../helpers/lightWorld.ts';
import { registry } from '../helpers/registry.ts';

/**
 * Environment sample of one player (docs « Abri »: about 20 µs, every 30 ticks), on Apple M4 under
 * plain Node: the worst shelter test (a closed room as large as the limits allow) and the heat
 * scan around the player, medians after a warm-up.
 */
const SHELTER_MEDIAN_MS = 0.05;
const HEAT_MEDIAN_MS = 0.05;

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

/** Median time of `run` over 200 calls after 50 warm-up calls. */
function time(run: () => void): number {
  const times: number[] = [];
  for (let i = 0; i < 250; i++) {
    const t0 = performance.now();
    run();
    if (i >= 50) times.push(performance.now() - t0);
  }
  return median(times);
}

describe('survival performance', () => {
  it(`tests a shelter in ≤ ${SHELTER_MEDIAN_MS} ms and scans heat in ≤ ${HEAT_MEDIAN_MS} ms`, () => {
    // Solid rock around a dark 9×4×9 room, as large as the limits allow: the flood fills it all.
    const { world } = litWorld(1, (w) => {
      for (let x = -12; x <= 12; x++)
        for (let z = -12; z <= 12; z++)
          for (let y = 50; y <= 80; y++)
            if (Math.abs(x) > 4 || Math.abs(z) > 4 || y < 64 || y > 67) w.setBlock(x, y, z, STONE);
      w.setBlock(2, 64, 2, registry.stateId('block:campfire[lit=1]'));
    });
    const rules = registry.pack.balance.shelter;
    let shelter = '';
    const shelterMs = time(() => {
      shelter = shelterAt(world, registry.tables, 0, 65, 0, rules);
    });
    let heat = 0;
    const heatMs = time(() => {
      heat = heatAround(world, registry.tables, 0.5, 64.9, 0.5, 2);
    });
    console.info(
      `shelter median ${(shelterMs * 1000).toFixed(1)} µs, heat ${(heatMs * 1000).toFixed(1)} µs`,
    );
    expect(shelter).toBe('enclosed');
    expect(heat).toBeGreaterThan(0);
    expect(shelterMs).toBeLessThanOrEqual(SHELTER_MEDIAN_MS);
    expect(heatMs).toBeLessThanOrEqual(HEAT_MEDIAN_MS);
  });
});
