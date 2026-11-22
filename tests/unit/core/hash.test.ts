import { describe, expect, it } from 'vitest';
import { fnv1aBytes, fnv1aString, fnv1aU32, hash32, hashUnit } from '../../../src/core/hash.ts';

describe('hash', () => {
  it('matches FNV-1a reference vectors', () => {
    expect(fnv1aString('')).toBe(0x811c9dc5);
    expect(fnv1aString('a')).toBe(0xe40c292c);
    expect(fnv1aString('foobar')).toBe(0xbf9cf968);
    expect(fnv1aBytes([0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72])).toBe(0xbf9cf968);
  });

  it('folds integers byte by byte', () => {
    expect(fnv1aU32(0x811c9dc5, 0x00000061)).toBe(fnv1aBytes([0x61, 0, 0, 0]));
  });

  it('spreads nearby coordinates', () => {
    const values = new Set<number>();
    for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) values.add(hash32(7, x, 0, z));
    expect(values.size).toBe(1024);
    const u = hashUnit(1, 2, 3, 4);
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThan(1);
  });
});
