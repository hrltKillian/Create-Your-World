import { describe, expect, it } from 'vitest';
import { writeTone } from '../../../src/assets/procedural/palette.ts';
import {
  cellular,
  fbm,
  tri,
  valueNoise,
  wrapDelta,
} from '../../../src/assets/procedural/texNoise.ts';

const SIZE = 32;

describe('texture noises (plan v4 « M36 »)', () => {
  it('wrap at the tile size, so textures tile', () => {
    for (let i = 0; i < SIZE; i++) {
      expect(valueNoise(3, i + SIZE, 5, SIZE, 4)).toBeCloseTo(valueNoise(3, i, 5, SIZE, 4), 12);
      expect(valueNoise(3, 7, i + SIZE, SIZE, 6, 2)).toBeCloseTo(
        valueNoise(3, 7, i, SIZE, 6, 2),
        12,
      );
      expect(fbm(9, i - SIZE, i, SIZE, 3, 4)).toBeCloseTo(fbm(9, i, i, SIZE, 3, 4), 12);
      expect(cellular(5, i + SIZE, 3, SIZE, 6).f1).toBeCloseTo(cellular(5, i, 3, SIZE, 6).f1, 12);
    }
  });

  it('stay in [0, 1] and depend on the seed', () => {
    let differ = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const v = fbm(1, x, y, SIZE, 4, 3);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
        if (v !== fbm(2, x, y, SIZE, 4, 3)) differ++;
      }
    }
    expect(differ).toBeGreaterThan(SIZE * SIZE * 0.9);
  });

  it('finds the nearest cellular point before the second', () => {
    for (let x = 0; x < SIZE; x++) {
      const hit = cellular(7, x, x, SIZE, 5);
      expect(hit.f1).toBeLessThanOrEqual(hit.f2);
      expect(Math.hypot(hit.dx, hit.dy)).toBeCloseTo(hit.f1, 12);
    }
  });

  it('measures wrapped steps and triangle waves', () => {
    expect(wrapDelta(1, 31, 32)).toBe(2);
    expect(wrapDelta(31, 1, 32)).toBe(-2);
    expect(tri(0)).toBe(1);
    expect(tri(0.5)).toBe(0);
    expect(tri(1.25)).toBe(0.5);
  });

  it('blends two palette colours at a fractional tone', () => {
    const colors = [
      [0, 0, 0],
      [100, 200, 40],
    ] as const;
    const out = new Uint8Array(4);
    writeTone(colors, 0.5, out, 0);
    expect([...out.subarray(0, 3)]).toEqual([50, 100, 20]);
    writeTone(colors, 1, out, 0);
    expect([...out.subarray(0, 3)]).toEqual([100, 200, 40]);
    writeTone(colors, 7, out, 0);
    expect([...out.subarray(0, 3)]).toEqual([100, 200, 40]);
  });
});
