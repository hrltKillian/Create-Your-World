import { describe, expect, it } from 'vitest';
import {
  doppler,
  enclosed,
  impulseResponse,
  REVERB_PLACES,
  REVERBS,
  ROOM_PROBE,
} from '../../../src/audio/reverb.ts';

const RATE = 22_050;
const energy = (s: Float32Array, from: number, to: number) => {
  let e = 0;
  for (let i = from; i < Math.min(to, s.length); i++) e += s[i]! * s[i]!;
  return e;
};

describe('rooms (plan v4 « M44 »)', () => {
  it('ring as long as their place, in two decorrelated ears of unit energy, fading', () => {
    for (const place of REVERB_PLACES.filter((p) => REVERBS[p].wet > 0)) {
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
    expect(REVERBS.cave.seconds).toBeGreaterThan(REVERBS.indoor.seconds * 3);
    expect(REVERBS.cave.wet).toBeGreaterThan(REVERBS.indoor.wet);
    // Outdoors (plan v5 « M53 »): dry.
    expect(REVERBS.dry.wet).toBe(0);
  });

  it('find a closed room only under a ceiling with walls nearly all around', () => {
    // A hut 5 × 5 inside, 3 high, its door the cell at (3, 1, 0).
    const hut = (x: number, y: number, z: number) => {
      const wall = x === 0 || x === 6 || z === 0 || z === 6;
      const door = x === 3 && z === 0 && y < 3;
      return y === 4 || (wall && y >= 1 && y <= 4 && !door);
    };
    expect(enclosed(hut, 3, 2, 3)).toBe(true);
    // A roof alone (a lean-to), walls alone (a ruin), nothing (a meadow).
    expect(enclosed((_x, y) => y === 4, 3, 2, 3)).toBe(false);
    expect(enclosed((x, y, z) => hut(x, y, z) && y < 4, 3, 2, 3)).toBe(false);
    expect(enclosed(() => false, 3, 2, 3)).toBe(false);
    // Trunks here and there under no roof: no room either.
    const trunks = (x: number, y: number, z: number) =>
      y < 4 && (x !== 3 || z !== 3) && (x * 7 + z * 3) % 5 === 0;
    expect(enclosed(trunks, 3, 2, 3)).toBe(false);
    expect(ROOM_PROBE.walls).toBeGreaterThan(4);
  });

  it('shift a moving source up coming closer, down going away, a little at most', () => {
    expect(doppler(10, 0, 0, 5, 0, 0)).toBeGreaterThan(1);
    expect(doppler(-10, 0, 0, 5, 0, 0)).toBeLessThan(1);
    expect(doppler(0, 10, 0, 5, 0, 0)).toBe(1);
    expect(doppler(500, 0, 0, 5, 0, 0)).toBeCloseTo(1.08, 6);
    expect(doppler(5, 0, 0, 0, 0, 0)).toBe(1);
  });
});
