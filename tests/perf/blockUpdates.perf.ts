import { describe, expect, it } from 'vitest';
import { BY_WORLD, removeBlock } from '../../src/sim/blockRemoval.ts';
import { stepBlockUpdates } from '../../src/sim/blockUpdates.ts';
import type { SimEvent } from '../../src/sim/events.ts';
import { createInlineSim } from '../../src/sim/testing/inlineSim.ts';
import { registry } from '../helpers/registry.ts';

/**
 * Block updates (docs plan v2, M14: « coupe de 30 bûches : étape 10 ≤ 0,5 ms en médiane »): 30
 * trees of a flat world felled at once, then tick step 10 timed on every tick until their canopies
 * have fallen (decay checks, the leaves removed with their drops and the light they touch).
 * Apple M4: a median about 0.05 ms.
 */
const STEP_MEDIAN_MS = 0.5;

describe('block update performance', () => {
  it(`runs tick step 10 of a clear-cut of 30 trees in ≤ ${STEP_MEDIAN_MS} ms (median)`, () => {
    const { sim, host, events } = createInlineSim({
      registry,
      seed: 'clear-cut',
      worldType: 'flat',
      allowDebug: true,
    });
    sim.addPlayer(1, 3);
    for (let i = 0; i < 120; i++) host.advance(1, events);
    const trunks: [number, number][] = [];
    for (let t = 0; t < 30; t++) {
      const x = (t % 6) * 6 - 14;
      const z = Math.floor(t / 6) * 6 - 14;
      trunks.push([x, z]);
      host.send({
        type: 'debug.fill',
        x0: x - 2,
        y0: 68,
        z0: z - 2,
        x1: x + 2,
        y1: 70,
        z1: z + 2,
        state: 'block:foliage',
      });
      host.send({
        type: 'debug.fill',
        x0: x,
        y0: 65,
        z0: z,
        x1: x,
        y1: 69,
        z1: z,
        state: 'block:broadleaf_log',
      });
    }
    host.advance(1, events);
    const out: SimEvent[] = [];
    for (const [x, z] of trunks)
      for (let y = 65; y <= 69; y++) removeBlock(sim, BY_WORLD, x, y, z, true, out);
    const times: number[] = [];
    for (let i = 0; i < 400 && sim.blockUpdates.size > 0; i++) {
      sim.tick++;
      out.length = 0;
      const t0 = performance.now();
      stepBlockUpdates(sim, out);
      times.push(performance.now() - t0);
    }
    expect(sim.blockUpdates.size).toBe(0);
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)]!;
    console.info(`step 10: median ${median.toFixed(3)} ms over ${times.length} ticks`);
    expect(median).toBeLessThanOrEqual(STEP_MEDIAN_MS);
  });
});
