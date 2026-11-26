import { describe, expect, it } from 'vitest';
import { advanceWind, swaySpeed, WIND_WRAP } from '../../../src/render/wind.ts';

describe('plant sway phase (plan v5 « M46 »)', () => {
  it('moves by the wind speed of one frame, however long the clock has run', () => {
    // An hour into the clock, the wind easing from calm to a storm over 4 s of frames.
    let phase = advanceWind(0, 1, 3600);
    const dt = 1 / 60;
    let most = 0;
    for (let frame = 0; frame < 240; frame++) {
      const wind = 1 + (1.5 * frame) / 240;
      const next = advanceWind(phase, wind, dt);
      const step = (next - phase + WIND_WRAP) % WIND_WRAP;
      most = Math.max(most, step);
      phase = next;
    }
    // Never more than a storm's speed for one frame (the old phase jumped by the clock × Δwind).
    expect(most).toBeLessThanOrEqual(swaySpeed(2.5) * dt + 1e-9);
  });

  it('wraps on a multiple of both sway periods', () => {
    const turns = (period: number) => WIND_WRAP / period;
    expect(turns(2 * Math.PI)).toBeCloseTo(Math.round(turns(2 * Math.PI)), 9);
    expect(turns(2.5 * Math.PI)).toBeCloseTo(Math.round(turns(2.5 * Math.PI)), 9);
    expect(advanceWind(WIND_WRAP - 0.1, 1, 1)).toBeCloseTo(swaySpeed(1) - 0.1, 9);
  });
});
