import { describe, expect, it } from 'vitest';
import { SpatialHash } from '../../../src/sim/spatialHash.ts';

describe('SpatialHash', () => {
  it('finds entities in the cells around a point, including negative coordinates', () => {
    const hash = new SpatialHash(8);
    hash.update(1, 0.5, 0.5);
    hash.update(2, -0.5, -0.5);
    hash.update(3, 30, 30);
    hash.update(4, -100, 7);
    const out: number[] = [];
    expect(hash.query(0, 0, 4, out).sort()).toEqual([1, 2]);
    expect(hash.query(30, 30, 1, out)).toEqual([3]);
    expect(hash.query(-100, 7, 0.5, out)).toEqual([4]);
  });

  it('moves and removes entities', () => {
    const hash = new SpatialHash(8);
    const out: number[] = [];
    hash.update(7, 1, 1);
    hash.update(7, 50, 50);
    expect(hash.query(1, 1, 2, out)).toEqual([]);
    expect(hash.query(50, 50, 2, out)).toEqual([7]);
    hash.remove(7);
    hash.remove(7);
    expect(hash.query(50, 50, 2, out)).toEqual([]);
  });

  it('never misses an entity within the query radius (random check)', () => {
    const hash = new SpatialHash(8);
    const points: [number, number][] = [];
    let s = 12345;
    const rand = () => {
      s = (s * 1103515245 + 12345) >>> 0;
      return s / 0x100000000;
    };
    for (let id = 0; id < 400; id++) {
      const p: [number, number] = [rand() * 200 - 100, rand() * 200 - 100];
      points.push(p);
      hash.update(id, p[0], p[1]);
    }
    const out: number[] = [];
    for (let q = 0; q < 50; q++) {
      const x = rand() * 200 - 100;
      const z = rand() * 200 - 100;
      const r = rand() * 20;
      const found = new Set(hash.query(x, z, r, out));
      points.forEach(([px, pz], id) => {
        if (Math.abs(px - x) <= r && Math.abs(pz - z) <= r) expect(found.has(id)).toBe(true);
      });
    }
  });

  it('keeps cells apart when they share a bucket, and grows past its first capacity', () => {
    const hash = new SpatialHash(8, 2);
    for (let id = 1; id <= 300; id++)
      hash.update(id, (id % 20) * 8 + 1, Math.floor(id / 20) * 8 + 1);
    expect(hash.size).toBe(300);
    const out: number[] = [];
    // Exactly one entity per cell: no duplicates and no neighbours from other cells.
    for (let id = 1; id <= 300; id++) {
      expect(hash.query((id % 20) * 8 + 4, Math.floor(id / 20) * 8 + 4, 3, out)).toEqual([id]);
    }
    for (let id = 1; id <= 300; id += 2) hash.remove(id);
    expect(hash.size).toBe(150);
    hash.update(1000, 1, 1);
    expect(hash.query(4, 4, 3, out)).toEqual([1000]);
  });

  it('returns ids in ascending order, whatever order they were linked in', () => {
    const hash = new SpatialHash(8);
    const out: number[] = [];
    for (const id of [5, 3, 9, 1]) hash.update(id, 2, 2);
    hash.update(3, 20, 20);
    hash.update(3, 4, 4); // linked again, last
    hash.update(7, -3, 2); // a neighbour cell, queried first
    expect(hash.query(2, 2, 6, out)).toEqual([1, 3, 5, 7, 9]);
  });

  it('reuses the output array', () => {
    const hash = new SpatialHash();
    hash.update(1, 0, 0);
    const out = [99, 98, 97];
    expect(hash.query(0, 0, 1, out)).toBe(out);
    expect(out).toEqual([1]);
  });

  it('returns ids of crowded cells in ascending order without quadratic work', () => {
    const hash = new SpatialHash(8);
    for (let id = 1; id <= 200; id++) hash.update(id, 1 + (id % 7) * 0.9, 1 + (id % 5) * 1.1);
    const out: number[] = [];
    hash.query(3, 3, 2, out);
    expect(out).toEqual([...out].sort((a, b) => a - b));
    expect(out).toHaveLength(200);
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) hash.query(3, 3, 2, out);
    // The bucket lists newest first; without reversing each run the sort was ~20× slower.
    expect(performance.now() - t0).toBeLessThan(40);
  });
});
