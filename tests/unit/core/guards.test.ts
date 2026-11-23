import { describe, expect, it } from 'vitest';
import { isFiniteNumber, isPoint, isWhole } from '../../../src/core/guards.ts';

describe('save guards', () => {
  it('accept whole numbers from a minimum', () => {
    expect(isWhole(3, 1)).toBe(true);
    expect(isWhole(-4, -Infinity)).toBe(true);
    for (const value of [0, 1.5, '2', Number.NaN, Infinity, null, undefined])
      expect(isWhole(value, 1), String(value)).toBe(false);
  });

  it('accept finite numbers only', () => {
    expect(isFiniteNumber(-0.25)).toBe(true);
    for (const value of [Number.NaN, Infinity, '1', null, undefined])
      expect(isFiniteNumber(value), String(value)).toBe(false);
  });

  it('accept points with three finite coordinates', () => {
    expect(isPoint({ x: 1, y: -2, z: 0.5, extra: 'kept' })).toBe(true);
    for (const value of [null, undefined, 3, { x: 1, y: 2 }, { x: 1, y: 2, z: Number.NaN }])
      expect(isPoint(value), JSON.stringify(value)).toBe(false);
  });
});
