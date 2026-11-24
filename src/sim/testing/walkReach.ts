import { COLLISION_FULL, FLAG_LIQUID, FLAG_SOLID, type Registry } from '../../content/registry.ts';
import { anglesTo, clampPitch, lookVector, type Vec3 } from '../../core/angles.ts';
import { createRayHit, raycast } from '../../world/raycast.ts';
import type { VoxelWorld } from '../../world/VoxelWorld.ts';
import { PHYSICS } from '../physics.ts';
import { REACH } from '../targeting.ts';
import type { Cell, Point } from './walkPort.ts';

/*
 * Where the objectives walk stands and aims to break or to place a block (walkHands.ts): the
 * simulation's own ray (world/raycast.ts, cast as targeting.ts does) from the eye of a cell to
 * stand in must stop in the block to break, or on the face of a solid neighbour that looks at the
 * cell to place into. Pure: reads the world and changes nothing.
 */

/** The aim stays this far under the reach (the browser's eye follows the body on frames). */
const REACH_MARGIN = 0.25;
/** Stands around the target: this many blocks to the side, below and above it. */
const STAND_SIDE = 3;
const STAND_BELOW = 3;
const STAND_ABOVE = 2;
/**
 * How far into a block an aim point on its face lies, and how far off the face's middle along
 * each axis (unlike offsets: no two of them sum to a whole number).
 */
const INSIDE = 0.01;
const SKEW = [0.037, 0.029, 0.017] as const;
/** The 6 neighbours. */
const DIRS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const hit = createRayHit();
const dir: Vec3 = { x: 0, y: 0, z: 0 };

/** An aim from an eye: the point to look at, or null when nothing fits from there. */
export type Aim = (eye: Point) => Point | null;

/** A cell to stand in and the point its eye looks at. */
export interface Reach {
  readonly stand: Cell;
  readonly at: Point;
}

/** The eye of a player standing in the middle of a cell. */
function eyeOf(stand: Cell): Point {
  return { x: stand.x + 0.5, y: stand.y + PHYSICS.eye, z: stand.z + 0.5 };
}

const flagsAt = (world: VoxelWorld, registry: Registry, c: Cell) =>
  registry.tables.flags[world.getBlock(c.x, c.y, c.z)]!;

const loaded = (world: VoxelWorld, c: Cell) => world.getBlock(c.x, c.y, c.z) !== world.outside;

/** Whether a cell holds a block with collision (a face to place against). */
export function solidAt(world: VoxelWorld, registry: Registry, c: Cell): boolean {
  return loaded(world, c) && (flagsAt(world, registry, c) & FLAG_SOLID) !== 0;
}

/**
 * Whether a player can stand in a cell: feet and head free of collision and liquid, a full block
 * under the feet (on a low one, a campfire, the eye would stand lower).
 */
export function standable(world: VoxelWorld, registry: Registry, c: Cell): boolean {
  const head = { x: c.x, y: c.y + 1, z: c.z };
  const free = (cell: Cell) =>
    loaded(world, cell) && (flagsAt(world, registry, cell) & (FLAG_SOLID | FLAG_LIQUID)) === 0;
  const ground = world.getBlock(c.x, c.y - 1, c.z);
  return free(c) && free(head) && registry.tables.collision[ground] === COLLISION_FULL;
}

/**
 * Whether the view turned from the eye towards a point within reach stops in `cell` (on face `n`):
 * the ray the simulation casts along that yaw and pitch.
 */
function rayStops(
  world: VoxelWorld,
  registry: Registry,
  eye: Point,
  at: Point,
  cell: Cell,
  n?: readonly [number, number, number],
): boolean {
  const dx = at.x - eye.x;
  const dy = at.y - eye.y;
  const dz = at.z - eye.z;
  if (Math.sqrt(dx * dx + dy * dy + dz * dz) > REACH - REACH_MARGIN) return false;
  const { yaw, pitch } = anglesTo(eye, at);
  lookVector(yaw, clampPitch(pitch), dir);
  raycast(world, registry.tables, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, REACH, hit);
  if (!hit.hit || hit.x !== cell.x || hit.y !== cell.y || hit.z !== cell.z) return false;
  return !n || (hit.nx === n[0] && hit.ny === n[1] && hit.nz === n[2]);
}

/**
 * A point of a cell's face (`n`: its normal; none: the cell's centre), `depth` into the cell along
 * the normal, set off the middle by SKEW along the face: a ray from the middle of another cell
 * does not run through the corners of the cells it crosses (where rounding picks the next one).
 */
function facePoint(cell: Cell, n: readonly [number, number, number] | null, depth: number): Point {
  const [nx, ny, nz] = n ?? [0, 0, 0];
  return {
    x: cell.x + 0.5 + nx * (0.5 - depth) + (nx === 0 ? SKEW[0] : 0),
    y: cell.y + 0.5 + ny * (0.5 - depth) + (ny === 0 ? SKEW[1] : 0),
    z: cell.z + 0.5 + nz * (0.5 - depth) + (nz === 0 ? SKEW[2] : 0),
  };
}

/** Aims at a block: its centre, else the middle of one of its faces, as the eye sees it. */
export function aimToBreak(world: VoxelWorld, registry: Registry, cell: Cell): Aim {
  const points = [facePoint(cell, null, 0), ...DIRS.map((n) => facePoint(cell, n, INSIDE))];
  return (eye) => points.find((at) => rayStops(world, registry, eye, at, cell)) ?? null;
}

/**
 * Aims at the middle of a face that a solid neighbour of `cell` turns to it, as the eye sees it: a
 * block placed on that face goes into `cell`.
 */
export function aimToPlace(world: VoxelWorld, registry: Registry, cell: Cell): Aim {
  return (eye) => {
    for (const [dx, dy, dz] of DIRS) {
      const support = { x: cell.x + dx, y: cell.y + dy, z: cell.z + dz };
      const towards = [-dx, -dy, -dz] as const;
      if (!solidAt(world, registry, support)) continue;
      const at = facePoint(support, towards, INSIDE);
      if (rayStops(world, registry, eye, at, support, towards)) return at;
    }
    return null;
  };
}

/**
 * The stand nearest to `from` around a target cell whose eye finds an aim: a cell a player can
 * stand in, the body neither in the target nor on it. Null when none does.
 */
export function standFor(
  world: VoxelWorld,
  registry: Registry,
  target: Cell,
  from: Cell,
  aim: Aim,
): Reach | null {
  const stands: Cell[] = [];
  for (let dy = -STAND_BELOW; dy <= STAND_ABOVE; dy++)
    for (let dz = -STAND_SIDE; dz <= STAND_SIDE; dz++)
      for (let dx = -STAND_SIDE; dx <= STAND_SIDE; dx++) {
        // Feet, head or ground in the target.
        if (dx === 0 && dz === 0 && dy >= -1 && dy <= 1) continue;
        const stand = { x: target.x + dx, y: target.y + dy, z: target.z + dz };
        if (standable(world, registry, stand)) stands.push(stand);
      }
  const away = (c: Cell) => (c.x - from.x) ** 2 + (c.y - from.y) ** 2 + (c.z - from.z) ** 2;
  stands.sort((a, b) => away(a) - away(b));
  for (const stand of stands) {
    const at = aim(eyeOf(stand));
    if (at) return { stand, at };
  }
  return null;
}
