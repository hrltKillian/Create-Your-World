import {
  COLLISION_BOXES,
  COLLISION_FULL,
  COLLISION_LIQUID,
  FLAG_SOLID,
  type RawTables,
} from '../content/registry.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';

/**
 * Collision of one axis-aligned box against the blocks of the world. The box is the module-level
 * `aabb` (min x, y, z then max x, y, z, in blocks): callers set it, sweep it along an axis and test
 * it for overlaps. Zero allocation: every query works on module-level scratch arrays.
 */

/** Slack so that touching faces neither block a move nor count as an overlap. */
const EPSILON = 1e-4;

/**
 * Longest move of one sweep (blocks): far above any speed of the game (terminal speed covers under
 * two blocks a tick), it bounds the cells a crafted speed could make the sweep read.
 */
const MAX_MOVE = 16;

/** The box being moved and tested. */
export const aabb = new Float64Array(6);
const boxes = new Float64Array(6 * 8);
const lo = new Float64Array(3);
const hi = new Float64Array(3);
const sweepMin = new Float64Array(3);
const sweepMax = new Float64Array(3);

/** Collision boxes of the block at a cell, in world units, written into `out` (returns the count). */
function cellBoxes(
  world: VoxelWorld,
  tables: RawTables,
  x: number,
  y: number,
  z: number,
  out: Float64Array,
): number {
  const state = world.getBlock(x, y, z);
  const c = tables.collision[state]!;
  if (c === COLLISION_FULL || state === world.outside) {
    out[0] = x;
    out[1] = y;
    out[2] = z;
    out[3] = x + 1;
    out[4] = y + 1;
    out[5] = z + 1;
    return 1;
  }
  if (c < COLLISION_BOXES) return 0;
  let n = 0;
  for (const b of tables.collisionBoxes[c - COLLISION_BOXES]!) {
    out[n * 6] = x + b[0] / 16;
    out[n * 6 + 1] = y + b[1] / 16;
    out[n * 6 + 2] = z + b[2] / 16;
    out[n * 6 + 3] = x + b[3] / 16;
    out[n * 6 + 4] = y + b[4] / 16;
    out[n * 6 + 5] = z + b[5] / 16;
    n++;
    if (n * 6 >= out.length) break;
  }
  return n;
}

/**
 * Whether the collision box at offset `o` of `boxes` overlaps the AABB on every axis except `skip`
 * (−1: all three); touching faces do not count.
 */
function overlapsAabb(o: number, skip: number): boolean {
  for (let a = 0; a < 3; a++) {
    if (a === skip) continue;
    if (!(boxes[o + a]! < aabb[a + 3]! - EPSILON && boxes[o + 3 + a]! > aabb[a]! + EPSILON))
      return false;
  }
  return true;
}

/**
 * Moves the AABB along one axis by `delta` (at most MAX_MOVE), stopping at the first collision.
 * Sweeps every cell the move covers, so nothing is tunnelled through. Returns the distance actually
 * moved.
 */
export function moveAxis(
  world: VoxelWorld,
  tables: RawTables,
  axis: number,
  wanted: number,
): number {
  if (wanted === 0) return 0;
  const delta = Math.max(-MAX_MOVE, Math.min(MAX_MOVE, wanted));
  for (let a = 0; a < 3; a++) {
    lo[a] = aabb[a]!;
    hi[a] = aabb[a + 3]!;
    sweepMin[a] = lo[a]!;
    sweepMax[a] = hi[a]!;
  }
  // Cells covered by the swept box.
  if (delta > 0) sweepMax[axis] = hi[axis]! + delta;
  else sweepMin[axis] = lo[axis]! + delta;
  const min = sweepMin;
  const max = sweepMax;
  let allowed = delta;
  const x0 = Math.floor(min[0]! + EPSILON);
  const x1 = Math.floor(max[0]! - EPSILON);
  const y0 = Math.floor(min[1]! + EPSILON);
  const y1 = Math.floor(max[1]! - EPSILON);
  const z0 = Math.floor(min[2]! + EPSILON);
  const z1 = Math.floor(max[2]! - EPSILON);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        const n = cellBoxes(world, tables, x, y, z, boxes);
        for (let b = 0; b < n; b++) {
          const o = b * 6;
          // The AABB has not moved yet: overlap on the two other axes?
          if (!overlapsAabb(o, axis)) continue;
          if (delta > 0) {
            const gap = boxes[o + axis]! - hi[axis]!;
            if (gap >= -EPSILON && gap < allowed) allowed = Math.max(0, gap - EPSILON);
          } else {
            const gap = boxes[o + 3 + axis]! - lo[axis]!;
            if (gap <= EPSILON && gap > allowed) allowed = Math.min(0, gap + EPSILON);
          }
        }
      }
    }
  }
  aabb[axis] = lo[axis]! + allowed;
  aabb[axis + 3] = hi[axis]! + allowed;
  return allowed;
}

/** Whether a box at the current AABB position overlaps any solid. */
export function overlapsSolid(world: VoxelWorld, tables: RawTables): boolean {
  for (let x = Math.floor(aabb[0]! + EPSILON); x <= Math.floor(aabb[3]! - EPSILON); x++) {
    for (let y = Math.floor(aabb[1]! + EPSILON); y <= Math.floor(aabb[4]! - EPSILON); y++) {
      for (let z = Math.floor(aabb[2]! + EPSILON); z <= Math.floor(aabb[5]! - EPSILON); z++) {
        const n = cellBoxes(world, tables, x, y, z, boxes);
        for (let b = 0; b < n; b++) if (overlapsAabb(b * 6, -1)) return true;
      }
    }
  }
  return false;
}

/** Whether the block at a cell is solid (unloaded and below-world cells are). */
export function solidCell(
  world: VoxelWorld,
  tables: RawTables,
  x: number,
  y: number,
  z: number,
): boolean {
  const state = world.getBlock(x, y, z);
  return (tables.flags[state]! & FLAG_SOLID) !== 0 || state === world.outside;
}

/** Whether the block containing a point is a liquid. */
export function isLiquid(
  world: VoxelWorld,
  tables: RawTables,
  x: number,
  y: number,
  z: number,
): boolean {
  return (
    tables.collision[world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))] ===
    COLLISION_LIQUID
  );
}

/** Whether something solid lies under the footprint of the AABB (crouch edge guard). */
export function supported(world: VoxelWorld, tables: RawTables): boolean {
  const saved1 = aabb[1]!;
  const saved4 = aabb[4]!;
  aabb[1] = saved1 - 0.05;
  aabb[4] = saved1;
  const result = overlapsSolid(world, tables);
  aabb[1] = saved1;
  aabb[4] = saved4;
  return result;
}
