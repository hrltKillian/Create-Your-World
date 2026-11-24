import { describe, expect, it } from 'vitest';
import { ClientThrottle, THROTTLE } from '../../../src/app/throttle.ts';
import type { MeshBudgets } from '../../../src/render/MeshScheduler.ts';

const NOMINAL: MeshBudgets = {
  maxInFlight: 8,
  dispatchPerFrame: 4,
  uploadsPerFrame: 8,
  uploadBytesPerFrame: 1 << 20,
};
const DT = 1 / 60;

/** Feeds `seconds` of frames of `workMs` each. */
function run(throttle: ClientThrottle, workMs: number, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) throttle.observe(workMs, DT);
}

describe('adaptive client throttling', () => {
  it(`cuts the client slices by 30 % after ${THROTTLE.slowSeconds} s over ${THROTTLE.slowMs} ms`, () => {
    const throttle = new ClientThrottle();
    run(throttle, 14, THROTTLE.slowSeconds - 0.1);
    expect(throttle.scale).toBe(1);
    run(throttle, 14, 0.2);
    expect(throttle.scale).toBeCloseTo(THROTTLE.down);
    const budgets = throttle.budgets(NOMINAL);
    expect(budgets).toEqual({
      // Jobs run on the workers: their number never changes.
      maxInFlight: 8,
      dispatchPerFrame: 3,
      uploadsPerFrame: 6,
      uploadBytesPerFrame: Math.round((1 << 20) * THROTTLE.down),
    });
    // Another stretch of slow frames cuts again.
    run(throttle, 14, THROTTLE.slowSeconds);
    expect(throttle.scale).toBeCloseTo(THROTTLE.down * THROTTLE.down);
  });

  it(`gives 10 % back after ${THROTTLE.fastSeconds} s under ${THROTTLE.fastMs} ms, up to the nominal budgets`, () => {
    const throttle = new ClientThrottle();
    run(throttle, 14, THROTTLE.slowSeconds + 0.1);
    const cut = throttle.scale;
    run(throttle, 4, THROTTLE.fastSeconds + 0.5);
    expect(throttle.scale).toBeCloseTo(cut * THROTTLE.up);
    run(throttle, 4, 10 * THROTTLE.fastSeconds);
    expect(throttle.scale).toBe(1);
    expect(throttle.budgets(NOMINAL)).toBe(NOMINAL);
  });

  it('keeps the scale between the two thresholds, and one odd frame changes nothing', () => {
    const throttle = new ClientThrottle();
    run(throttle, 10, 20);
    expect(throttle.scale).toBe(1);
    // A 100 ms hitch in a run of fast frames does not start a slow stretch.
    run(throttle, 4, 1);
    throttle.observe(100, DT);
    run(throttle, 4, THROTTLE.slowSeconds + 1);
    expect(throttle.scale).toBe(1);
  });

  it(`never goes under ${THROTTLE.minScale} of the nominal slices, nor under one each`, () => {
    const throttle = new ClientThrottle();
    run(throttle, 30, 60);
    expect(throttle.scale).toBe(THROTTLE.minScale);
    const budgets = throttle.budgets({ ...NOMINAL, dispatchPerFrame: 1, uploadsPerFrame: 2 });
    expect(budgets.dispatchPerFrame).toBe(1);
    expect(budgets.uploadsPerFrame).toBe(1);
  });
});
