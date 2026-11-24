import {
  COLLISION_BOXES,
  COLLISION_LIQUID,
  FLAG_OPAQUE,
  FLAG_SOLID,
  PASS_NONE,
  type RawTables,
} from '../content/registry.ts';
import type { VoxelWorld } from './VoxelWorld.ts';

/** Result of a voxel raycast. Reused between calls (no allocation). */
export interface RayHit {
  hit: boolean;
  x: number;
  y: number;
  z: number;
  /** Face normal of the entry face (0, 0, 0 when the ray starts inside the hit block). */
  nx: number;
  ny: number;
  nz: number;
  distance: number;
  state: number;
}

/**
 * What stops a ray: targetable blocks (drawn, not liquid), the same plus liquids, solids, or
 * opaque blocks.
 */
export const RAY_TARGET = 0;
export const RAY_TARGET_LIQUIDS = 1;
/**
 * Collision boxes, and unloaded columns (camera probes, the reach of a blow): a ray passing over a
 * low block (a campfire, a chest) goes on.
 */
export const RAY_SOLID = 2;
/** Opaque blocks, and unloaded columns (creatures' lines of sight: glass and plants let it by). */
export const RAY_OPAQUE = 3;
export type RayMode =
  | typeof RAY_TARGET
  | typeof RAY_TARGET_LIQUIDS
  | typeof RAY_SOLID
  | typeof RAY_OPAQUE;

export function createRayHit(): RayHit {
  return { hit: false, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, distance: 0, state: 0 };
}

/**
 * Amanatides & Woo voxel traversal. Stops at the first block matching `mode` (by default a drawn,
 * non-liquid block) within `maxDistance`. `(dx, dy, dz)` must be normalised.
 */
export function raycast(
  world: VoxelWorld,
  tables: RawTables,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDistance: number,
  out: RayHit,
  mode: RayMode = RAY_TARGET,
): RayHit {
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Number.POSITIVE_INFINITY;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Number.POSITIVE_INFINITY;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Number.POSITIVE_INFINITY;
  let tMaxX =
    stepX > 0 ? (x + 1 - ox) * tDeltaX : stepX < 0 ? (ox - x) * tDeltaX : Number.POSITIVE_INFINITY;
  let tMaxY =
    stepY > 0 ? (y + 1 - oy) * tDeltaY : stepY < 0 ? (oy - y) * tDeltaY : Number.POSITIVE_INFINITY;
  let tMaxZ =
    stepZ > 0 ? (z + 1 - oz) * tDeltaZ : stepZ < 0 ? (oz - z) * tDeltaZ : Number.POSITIVE_INFINITY;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let t = 0;
  // Solid and opaque rays stop on a flag (and in unloaded columns), target rays on drawn blocks.
  const flag = mode === RAY_SOLID ? FLAG_SOLID : mode === RAY_OPAQUE ? FLAG_OPAQUE : 0;
  out.hit = false;
  while (t <= maxDistance) {
    const state = world.getBlock(x, y, z);
    const stops =
      flag !== 0
        ? (tables.flags[state]! & flag) !== 0 || state === world.outside
        : state !== world.outside &&
          tables.pass[state] !== PASS_NONE &&
          (mode === RAY_TARGET_LIQUIDS || tables.collision[state] !== COLLISION_LIQUID);
    // A block with collision boxes stops a solid ray only where the ray enters one of them.
    const entry =
      stops && mode === RAY_SOLID && tables.collision[state]! >= COLLISION_BOXES
        ? boxEntry(tables, state, x, y, z, ox, oy, oz, dx, dy, dz, maxDistance)
        : t;
    if (stops && entry <= maxDistance) {
      out.hit = true;
      out.x = x;
      out.y = y;
      out.z = z;
      out.nx = nx;
      out.ny = ny;
      out.nz = nz;
      out.distance = Math.max(t, entry);
      out.state = state;
      return out;
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      nx = -stepX;
      ny = 0;
      nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      nx = 0;
      ny = -stepY;
      nz = 0;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      nx = 0;
      ny = 0;
      nz = -stepZ;
    }
  }
  return out;
}

/**
 * Distance along the ray (o + t·d, 0 ≤ t ≤ max) where it enters the first of the collision boxes of
 * `state` in cell (x, y, z) (the slab test), or +∞ when it misses them all.
 */
function boxEntry(
  tables: RawTables,
  state: number,
  x: number,
  y: number,
  z: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  max: number,
): number {
  const boxes = tables.collisionBoxes[tables.collision[state]! - COLLISION_BOXES]!;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    const t = Math.max(
      0,
      slabEnter(ox, dx, x + b[0] / 16, x + b[3] / 16, max),
      slabEnter(oy, dy, y + b[1] / 16, y + b[4] / 16, max),
      slabEnter(oz, dz, z + b[2] / 16, z + b[5] / 16, max),
    );
    const exit = Math.min(
      max,
      slabExit(ox, dx, x + b[0] / 16, x + b[3] / 16),
      slabExit(oy, dy, y + b[1] / 16, y + b[4] / 16),
      slabExit(oz, dz, z + b[2] / 16, z + b[5] / 16),
    );
    if (t <= exit && t < best) best = t;
  }
  return best;
}

/** Where a ray along one axis enters [lo, hi] (−∞ when inside without moving, past `max` when never). */
function slabEnter(o: number, d: number, lo: number, hi: number, max: number): number {
  if (d === 0) return o >= lo && o <= hi ? Number.NEGATIVE_INFINITY : max + 1;
  return d > 0 ? (lo - o) / d : (hi - o) / d;
}

/** Where a ray along one axis leaves [lo, hi] (+∞ when it stays inside). */
function slabExit(o: number, d: number, lo: number, hi: number): number {
  if (d === 0) return Number.POSITIVE_INFINITY;
  return d > 0 ? (hi - o) / d : (lo - o) / d;
}

/** Normal of each face, in the registry's face order (+x, −x, +y, −y, +z, −z), as x, y, z triples. */
export const FACE_NORMALS: readonly number[] = [
  1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1,
];

/** Face index of a hit normal (−1 for the null normal of a ray that starts inside a block). */
export function faceOfNormal(nx: number, ny: number, nz: number): number {
  if (nx !== 0) return nx > 0 ? 0 : 1;
  if (ny !== 0) return ny > 0 ? 2 : 3;
  if (nz !== 0) return nz > 0 ? 4 : 5;
  return -1;
}
