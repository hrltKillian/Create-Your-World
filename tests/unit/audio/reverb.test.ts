import { describe, expect, it } from 'vitest';
import { doppler, impulseResponse, REVERB_PLACES, REVERBS } from '../../../src/audio/reverb.ts';

const RATE = 22_050;
const energy = (s: Float32Array, from: number, to: number) => {
  let e = 0;
  for (let i = from; i < Math.min(to, s.length); i++) e += s[i]! * s[i]!;
  return e;
};

describe('rooms (plan v4 « M44 »)', () => {
  it('ring as long as their place, in two decorrelated ears of unit energy, fading', () => {
    for (const place of REVERB_PLACES) {
      const [left, right] = impulseResponse(place, RATE);
      expect(left.length).toBe(Math.round(REVERBS[place].seconds * RATE));
      expect(energy(left, 0, left.length)).toBeCloseTo(1, 4);
      expect(energy(right, 0, right.length)).toBeCloseTo(1, 4);
      expect(left).not.toEqual(right);
      const tenth = Math.floor(left.length / 10);
      expect(energy(left, 0, tenth)).toBeGreaterThan(
        energy(left, left.length - tenth, left.length) * 20,
      );
      expect(impulseResponse(place, RATE)[0]).toEqual(left);
    }
    expect(REVERBS.cave.seconds).toBeGreaterThan(REVERBS.open.seconds * 3);
    expect(REVERBS.cave.wet).toBeGreaterThan(REVERBS.forest.wet);
  });

  it('shift a moving source up coming closer, down going away, a little at most', () => {
    expect(doppler(10, 0, 0, 5, 0, 0)).toBeGreaterThan(1);
    expect(doppler(-10, 0, 0, 5, 0, 0)).toBeLessThan(1);
    expect(doppler(0, 10, 0, 5, 0, 0)).toBe(1);
    expect(doppler(500, 0, 0, 5, 0, 0)).toBeCloseTo(1.08, 6);
    expect(doppler(5, 0, 0, 0, 0, 0)).toBe(1);
  });
});
