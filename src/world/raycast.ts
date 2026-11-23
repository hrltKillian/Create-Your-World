import { COLLISION_LIQUID, FLAG_SOLID, PASS_NONE, type RawTables } from '../content/registry.ts';
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

/** What stops a ray: targetable blocks (drawn, not liquid), the same plus liquids, or solids. */
export const RAY_TARGET = 0;
export const RAY_TARGET_LIQUIDS = 1;
/** Blocks with collision, and unloaded columns (camera probes). */
export const RAY_SOLID = 2;
export type RayMode = typeof RAY_TARGET | typeof RAY_TARGET_LIQUIDS | typeof RAY_SOLID;

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
  out.hit = false;
  while (t <= maxDistance) {
    const state = world.getBlock(x, y, z);
    const stops =
      mode === RAY_SOLID
        ? (tables.flags[state]! & FLAG_SOLID) !== 0 || state === world.outside
        : state !== world.outside &&
          tables.pass[state] !== PASS_NONE &&
          (mode === RAY_TARGET_LIQUIDS || tables.collision[state] !== COLLISION_LIQUID);
    if (stops) {
      out.hit = true;
      out.x = x;
      out.y = y;
      out.z = z;
      out.nx = nx;
      out.ny = ny;
      out.nz = nz;
      out.distance = t;
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
