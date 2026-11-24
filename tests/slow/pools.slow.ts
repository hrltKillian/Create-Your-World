import { describe, expect, it } from 'vitest';
import { grazeAroundPool } from '../helpers/pools.ts';
import { playerTestSim } from '../helpers/simHarness.ts';

/*
 * The long run of the grazing test in tests/unit/sim/creatures.test.ts: 6 worlds × 4 Trotters ×
 * 9000 ticks around pools whose surface is one block below the bank (entered and left again) or
 * two (never entered), none in the water for 2 minutes on end.
 */
describe('Trotters around sunken pools (long run)', () => {
  it('are never trapped in them', () => {
    let entered = 0;
    for (let k = 0; k < 6; k++) {
      const s = playerTestSim({ seed: `pool-rim-${k}` });
      s.send({ type: 'debug.setTime', hours: 12 }, { type: 'debug.freezeTime', frozen: true });
      const top = k < 3 ? 63 : 62;
      const result = grazeAroundPool(s, top, 9000, 2400);
      expect(result.trapped, `world ${k}`).toBe(0);
      if (top === 62) expect(result.entered, `world ${k}: never entered`).toBe(0);
      else entered += result.entered;
    }
    expect(entered).toBeGreaterThan(0);
  });
});
