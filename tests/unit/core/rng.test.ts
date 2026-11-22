import { describe, expect, it } from 'vitest';
import { Rng, rngFor, seedState, xmur3 } from '../../../src/core/rng.ts';

describe('rng', () => {
  it('is deterministic for a seed and salt', () => {
    const a = Rng.fromSeed('42', 'terrain');
    const b = Rng.fromSeed('42', 'terrain');
    const seqA = Array.from({ length: 8 }, () => a.next());
    const seqB = Array.from({ length: 8 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('separates salts and seeds', () => {
    expect(Rng.fromSeed('42', 'terrain').next()).not.toBe(Rng.fromSeed('42', 'caves').next());
    expect(Rng.fromSeed('42', 'terrain').next()).not.toBe(Rng.fromSeed('43', 'terrain').next());
  });

  it('resumes exactly from a saved state', () => {
    const rng = Rng.fromSeed('save', 'loot');
    for (let i = 0; i < 100; i++) rng.next();
    const resumed = new Rng(rng.state());
    expect(Array.from({ length: 5 }, () => resumed.next())).toEqual(
      Array.from({ length: 5 }, () => rng.next()),
    );
  });

  it('stays in range and is roughly uniform', () => {
    const next = rngFor('uniform', 'test');
    let sum = 0;
    const buckets = new Array<number>(10).fill(0);
    for (let i = 0; i < 20_000; i++) {
      const v = next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
      buckets[Math.floor(v * 10)]!++;
    }
    expect(sum / 20_000).toBeCloseTo(0.5, 1);
    for (const count of buckets) expect(count).toBeGreaterThan(1700);
  });

  it('keeps integer helpers within bounds', () => {
    const rng = Rng.fromSeed('ints', 'x');
    for (let i = 0; i < 1000; i++) {
      const v = rng.intRange(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });

  it('matches golden values (changing these breaks every saved world)', () => {
    expect(xmur3('cyw')()).toBe(GOLDEN_XMUR3);
    expect(seedState('cyw', 'golden')).toEqual(GOLDEN_STATE);
  });
});

const GOLDEN_XMUR3 = 1211891753;
const GOLDEN_STATE = [-43176831, -724623633, -264367732, -38942759];
