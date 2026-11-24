import { describe, expect, it } from 'vitest';
import { DOUBLE_TAP_MS, SprintLatch } from '../../../src/input/sprintLatch.ts';

describe('SprintLatch', () => {
  it('latches on a second press of forward within the double-tap window', () => {
    const latch = new SprintLatch();
    latch.press(1000);
    expect(latch.on).toBe(false);
    latch.press(1000 + DOUBLE_TAP_MS);
    expect(latch.on).toBe(true);
  });

  it('does not latch when the presses are too far apart, and each press decides again', () => {
    const latch = new SprintLatch();
    latch.press(0);
    latch.press(DOUBLE_TAP_MS + 1);
    expect(latch.on).toBe(false);
    // A quick tap after that one latches; a lone press long after lets go.
    latch.press(DOUBLE_TAP_MS + 120);
    expect(latch.on).toBe(true);
    latch.press(5000);
    expect(latch.on).toBe(false);
  });

  it('forgets the last press: the next one is a first press again', () => {
    const latch = new SprintLatch();
    latch.press(0);
    latch.press(100);
    latch.forget();
    expect(latch.on).toBe(false);
    latch.press(200);
    expect(latch.on).toBe(false);
  });

  it('never latches on the first press', () => {
    const latch = new SprintLatch();
    latch.press(0);
    expect(latch.on).toBe(false);
  });
});
