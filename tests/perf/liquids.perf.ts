import { describe, expect, it } from 'vitest';
import { BY_WORLD, removeBlock } from '../../src/sim/blockRemoval.ts';
import type { SimEvent } from '../../src/sim/events.ts';
import { createInlineSim } from '../../src/sim/testing/inlineSim.ts';
import { registry } from '../helpers/registry.ts';

/**
 * Flowing water (docs plan v2, M15: « barrage cédé dans une fosse de 20×20 : tick p95 ≤ 4 ms »): a
 * reservoir of sources 10×20×4 held by a wall beside an empty pit 20×20×4 of a flat world; the wall
 * goes at once, then every whole tick is timed until the water settles (flow, light, remesh events).
 * Apple M4: a p95 about 0.6 ms.
 */
const TICK_P95_MS = 4;

describe('liquid performance', () => {
  it(`floods a 20×20 pit from a broken dam with a tick p95 ≤ ${TICK_P95_MS} ms`, () => {
    const { sim, host, events } = createInlineSim({
      registry,
      seed: 'dam-break',
      worldType: 'flat',
      allowDebug: true,
    });
    sim.addPlayer(1, 3);
    for (let i = 0; i < 120; i++) host.advance(1, events);
    const fill = (x0: number, x1: number, state: string) =>
      host.send({ type: 'debug.fill', x0, y0: 61, z0: -10, x1, y1: 64, z1: 9, state });
    fill(-30, -1, 'block:air');
    fill(-30, -21, 'block:fresh_water');
    fill(-20, -20, 'block:stone');
    host.advance(1, events);
    const out: SimEvent[] = [];
    for (let z = -10; z <= 9; z++)
      for (let y = 61; y <= 64; y++) removeBlock(sim, BY_WORLD, -20, y, z, false, out);
    const times: number[] = [];
    for (let i = 0; i < 2000 && sim.blockUpdates.size > 0; i++) {
      events.length = 0;
      const t0 = performance.now();
      host.advance(1, events);
      times.push(performance.now() - t0);
    }
    expect(sim.blockUpdates.size).toBe(0);
    // Sources never drain: the falls at the dam spread 7 blocks over the pit's floor.
    const key = (x: number) => registry.states[sim.world.getBlock(x, 61, 0)]!.key;
    expect(key(-13)).toBe('block:fresh_water[level=7,falling=0]');
    expect(key(-12)).toBe('block:air');
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    console.info(`dam break: p95 ${p95.toFixed(3)} ms over ${times.length} ticks`);
    expect(p95).toBeLessThanOrEqual(TICK_P95_MS);
  });
});
