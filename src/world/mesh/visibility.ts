import { FLAG_OPAQUE, type RawTables } from '../../content/registry.ts';
import { SECTION_SIZE, SECTION_VOLUME } from '../coords.ts';
import { PADDED, PADDED_AREA, paddedIndex } from './padded.ts';

/**
 * Which pairs of section faces are connected through non-opaque cells (15 bits, one per pair).
 * Used to cull sections that cannot be seen from the camera (caves).
 */

const visited = new Uint8Array(SECTION_VOLUME);
const queue = new Int32Array(SECTION_VOLUME);

/** Bit index of the pair (a, b), a < b, among the 15 pairs of 6 faces. */
export function pairBit(a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  // Pairs ordered (0,1),(0,2)…(0,5),(1,2)…(4,5).
  return lo * 5 - ((lo * (lo - 1)) >> 1) + (hi - lo - 1);
}

export const ALL_CONNECTED = (1 << 15) - 1;

export function sectionConnectivity(ids: Uint16Array, tables: RawTables): number {
  const n = SECTION_SIZE;
  visited.fill(0);
  let result = 0;
  for (let start = 0; start < SECTION_VOLUME; start++) {
    if (visited[start]) continue;
    const sx = start & 31;
    const sz = (start >> 5) & 31;
    const sy = start >> 10;
    if ((tables.flags[ids[paddedIndex(sx, sy, sz)]!]! & FLAG_OPAQUE) !== 0) {
      visited[start] = 1;
      continue;
    }
    let faces = 0;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const i = queue[head++]!;
      const x = i & 31;
      const z = (i >> 5) & 31;
      const y = i >> 10;
      if (x === n - 1) faces |= 1;
      if (x === 0) faces |= 2;
      if (y === n - 1) faces |= 4;
      if (y === 0) faces |= 8;
      if (z === n - 1) faces |= 16;
      if (z === 0) faces |= 32;
      const p = paddedIndex(x, y, z);
      if (x < n - 1) tail = visit(ids, tables, i + 1, p + 1, tail);
      if (x > 0) tail = visit(ids, tables, i - 1, p - 1, tail);
      if (y < n - 1) tail = visit(ids, tables, i + 1024, p + PADDED_AREA, tail);
      if (y > 0) tail = visit(ids, tables, i - 1024, p - PADDED_AREA, tail);
      if (z < n - 1) tail = visit(ids, tables, i + 32, p + PADDED, tail);
      if (z > 0) tail = visit(ids, tables, i - 32, p - PADDED, tail);
    }
    for (let a = 0; a < 6; a++) {
      if (!(faces & (1 << a))) continue;
      for (let b = a + 1; b < 6; b++) if (faces & (1 << b)) result |= 1 << pairBit(a, b);
    }
    if (result === ALL_CONNECTED) return result;
  }
  return result;
}

function visit(ids: Uint16Array, tables: RawTables, i: number, p: number, tail: number): number {
  if (visited[i]) return tail;
  visited[i] = 1;
  if ((tables.flags[ids[p]!]! & FLAG_OPAQUE) !== 0) return tail;
  queue[tail] = i;
  return tail + 1;
}
