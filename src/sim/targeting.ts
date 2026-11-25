import { type RawTables, SHAPE_BOXES } from '../content/registry.ts';
import { lookVector, type Vec3 } from '../core/angles.ts';
import { createRayHit, FACE_NORMALS, type RayHit, raycast } from '../world/raycast.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import type { ClientTarget } from './commands.ts';
import { eyeHeight } from './physics.ts';
import type { PlayerState } from './player.ts';

/** Block reach from the eye (m). */
export const REACH = 4.5;
/** Extra reach granted to a client's target: its eye is interpolated, the simulation's is not. */
export const REACH_SLACK = 0.3;

export const AIM_NONE = 0;
export const AIM_HIT = 1;
/** The client aimed at a block the simulation cannot confirm, and its own ray finds nothing. */
export const AIM_OUT_OF_REACH = 2;

const dir: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * The block a player aims at this tick, written into `out`: the client's target when it is within
 * reach of the simulation's eye and in line of sight, else the simulation's own ray along the
 * player's view. Returns AIM_HIT, AIM_NONE or AIM_OUT_OF_REACH.
 */
export function aim(
  world: VoxelWorld,
  tables: RawTables,
  player: PlayerState,
  out: RayHit,
): number {
  const b = player.body;
  const ey = b.y + eyeHeight(b);
  const target = player.input.target;
  if (target && confirmTarget(world, tables, b.x, ey, b.z, target, out)) return AIM_HIT;
  lookVector(player.yaw, player.pitch, dir);
  raycast(world, tables, b.x, ey, b.z, dir.x, dir.y, dir.z, REACH, out);
  if (out.hit) return AIM_HIT;
  return target ? AIM_OUT_OF_REACH : AIM_NONE;
}

/**
 * Accepts a client target when the aimed face is in sight of the eye (faceInSight). The hit, with
 * the client's face as its normal, goes into `out`.
 */
function confirmTarget(
  world: VoxelWorld,
  tables: RawTables,
  ex: number,
  ey: number,
  ez: number,
  t: ClientTarget,
  out: RayHit,
): boolean {
  if (!faceInSight(world, tables, ex, ey, ez, t.x, t.y, t.z, t.face, out)) return false;
  const f = t.face * 3;
  out.nx = FACE_NORMALS[f]!;
  out.ny = FACE_NORMALS[f + 1]!;
  out.nz = FACE_NORMALS[f + 2]!;
  return true;
}

/**
 * Whether a face of a cell is in sight of an eye: the face looks towards the eye, the cell is
 * within reach (+ slack) of it, and a ray towards a point just inside the face stops in that cell
 * (the ray's hit goes into `out`); a box shape may also be seen through the middle of its first box.
 */
function faceInSight(
  world: VoxelWorld,
  tables: RawTables,
  ex: number,
  ey: number,
  ez: number,
  x: number,
  y: number,
  z: number,
  face: number,
  out: RayHit,
): boolean {
  const f = face * 3;
  const nx = FACE_NORMALS[f]!;
  const ny = FACE_NORMALS[f + 1]!;
  const nz = FACE_NORMALS[f + 2]!;
  // Centre of the face; the eye must be in front of its plane.
  const fx = x + 0.5 + nx * 0.5;
  const fy = y + 0.5 + ny * 0.5;
  const fz = z + 0.5 + nz * 0.5;
  if ((ex - fx) * nx + (ey - fy) * ny + (ez - fz) * nz <= 0) return false;
  // Closest point of the cell to the eye.
  const cx = Math.max(x, Math.min(x + 1, ex)) - ex;
  const cy = Math.max(y, Math.min(y + 1, ey)) - ey;
  const cz = Math.max(z, Math.min(z + 1, ez)) - ez;
  const reach = REACH + REACH_SLACK;
  if (cx * cx + cy * cy + cz * cz > reach * reach) return false;
  // Towards a point just inside the face, on through the cell (√3): a box shape is hit where the
  // ray enters its boxes. A low or thin one (a bedroll, a gate) may lie off that line: then towards
  // the middle of its first box.
  if (
    rayStopsIn(
      world,
      tables,
      ex,
      ey,
      ez,
      fx - nx * 0.01,
      fy - ny * 0.01,
      fz - nz * 0.01,
      1.74,
      x,
      y,
      z,
      out,
    )
  )
    return true;
  const state = world.getBlock(x, y, z);
  if (tables.shape[state] !== SHAPE_BOXES) return false;
  const box = tables.boxShapes[tables.boxShape[state]!]![0]!;
  const bx = x + (box[0] + box[3]) / 32;
  const by = y + (box[1] + box[4]) / 32;
  const bz = z + (box[2] + box[5]) / 32;
  return rayStopsIn(world, tables, ex, ey, ez, bx, by, bz, 0.01, x, y, z, out);
}

/** Whether a ray from the eye towards a point (and `beyond` it) stops first in cell (x, y, z). */
function rayStopsIn(
  world: VoxelWorld,
  tables: RawTables,
  ex: number,
  ey: number,
  ez: number,
  px: number,
  py: number,
  pz: number,
  beyond: number,
  x: number,
  y: number,
  z: number,
  out: RayHit,
): boolean {
  const dx = px - ex;
  const dy = py - ey;
  const dz = pz - ez;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  raycast(world, tables, ex, ey, ez, dx / length, dy / length, dz / length, length + beyond, out);
  return out.hit && out.x === x && out.y === y && out.z === z;
}

/** Scratch hit of cellInSight. */
const sight = createRayHit();

/**
 * Whether a player sees a cell from the simulation's eye, as a client target is confirmed: one of
 * its faces is within reach (+ slack) and a ray towards it stops in the cell first (chests and
 * stations do not open through walls).
 */
export function cellInSight(
  world: VoxelWorld,
  tables: RawTables,
  player: PlayerState,
  x: number,
  y: number,
  z: number,
): boolean {
  const b = player.body;
  const ey = b.y + eyeHeight(b);
  for (let face = 0; face < 6; face++)
    if (faceInSight(world, tables, b.x, ey, b.z, x, y, z, face, sight)) return true;
  return false;
}
