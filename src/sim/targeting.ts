import type { RawTables } from '../content/registry.ts';
import { lookVector, type Vec3 } from '../core/angles.ts';
import { FACE_NORMALS, type RayHit, raycast } from '../world/raycast.ts';
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
 * Accepts a client target when the aimed face looks towards the eye, the cell is within reach (+
 * slack) of the eye, and a ray towards a point just inside the face stops in that cell. The hit,
 * with the client's face as its normal, goes into `out`.
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
  const f = t.face * 3;
  const nx = FACE_NORMALS[f]!;
  const ny = FACE_NORMALS[f + 1]!;
  const nz = FACE_NORMALS[f + 2]!;
  // Centre of the face; the eye must be in front of its plane.
  const fx = t.x + 0.5 + nx * 0.5;
  const fy = t.y + 0.5 + ny * 0.5;
  const fz = t.z + 0.5 + nz * 0.5;
  if ((ex - fx) * nx + (ey - fy) * ny + (ez - fz) * nz <= 0) return false;
  // Closest point of the cell to the eye.
  const cx = Math.max(t.x, Math.min(t.x + 1, ex)) - ex;
  const cy = Math.max(t.y, Math.min(t.y + 1, ey)) - ey;
  const cz = Math.max(t.z, Math.min(t.z + 1, ez)) - ez;
  const reach = REACH + REACH_SLACK;
  if (cx * cx + cy * cy + cz * cz > reach * reach) return false;
  const dx = fx - nx * 0.01 - ex;
  const dy = fy - ny * 0.01 - ey;
  const dz = fz - nz * 0.01 - ez;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  raycast(world, tables, ex, ey, ez, dx / length, dy / length, dz / length, length + 0.01, out);
  if (!out.hit || out.x !== t.x || out.y !== t.y || out.z !== t.z) return false;
  out.nx = nx;
  out.ny = ny;
  out.nz = nz;
  return true;
}
