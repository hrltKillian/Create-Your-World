import { describe, expect, it } from 'vitest';
import {
  columnKey,
  columnKeyX,
  columnKeyZ,
  localIndex,
  sectionKey,
  toColumn,
  toLocal,
} from '../../../src/world/coords.ts';

describe('coordinates', () => {
  it('floors negative coordinates into columns and local positions', () => {
    expect(toColumn(-1)).toBe(-1);
    expect(toLocal(-1)).toBe(31);
    expect(toColumn(-32)).toBe(-1);
    expect(toColumn(-33)).toBe(-2);
    expect(toLocal(-33)).toBe(31);
    expect(toColumn(31)).toBe(0);
    expect(toColumn(32)).toBe(1);
  });

  it('round-trips column keys, including negative and far coordinates', () => {
    for (const [cx, cz] of [
      [0, 0],
      [-1, -1],
      [31_249, -31_249],
      [-500, 700],
    ] as const) {
      const key = columnKey(cx, cz);
      expect(Number.isSafeInteger(key)).toBe(true);
      expect(columnKeyX(key)).toBe(cx);
      expect(columnKeyZ(key)).toBe(cz);
    }
    expect(columnKey(-1, 0)).not.toBe(columnKey(0, -1));
  });

  it('builds unique section keys and voxel indices', () => {
    const keys = new Set<number>();
    for (let cx = -2; cx <= 2; cx++)
      for (let cz = -2; cz <= 2; cz++)
        for (let sy = 0; sy < 8; sy++) keys.add(sectionKey(cx, sy, cz));
    expect(keys.size).toBe(5 * 5 * 8);
    expect(localIndex(31, 31, 31)).toBe(32 * 32 * 32 - 1);
    expect(localIndex(1, 0, 0)).toBe(1);
    expect(localIndex(0, 0, 1)).toBe(32);
    expect(localIndex(0, 1, 0)).toBe(1024);
  });
});
