import type { RawTables } from '../content/registry.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import { TICK_SECONDS } from './clock.ts';
import { aabb, isLiquid, moveAxis, overlapsSolid } from './collision.ts';
import type { CreatureBody } from './creatures.ts';
import { PHYSICS } from './physics.ts';

/**
 * Creature bodies: a box of the creature's hitbox against the voxels (collision.ts), gravity,
 * buoyancy, acceleration towards the speed its brain wants, and a hop onto a one-block step it
 * walks into (its paths climb one block), from the ground, or out of a liquid onto a bank at most
 * one block above the surface.
 * Zero allocation.
 */
export const CREATURE_BODY = {
  /** m/s² towards the wanted speed (on the ground and in the air alike). */
  accel: 40,
  /** Horizontal speed kept per tick on the ground while not steering (knocked back, dying). */
  groundFriction: 0.8,
  /** Rising speed in a liquid (m/s): creatures keep their head above water. */
  swimUp: 2,
} as const;

/** Puts the collision box around a body. */
function setAabb(b: CreatureBody, width: number, height: number): void {
  const half = width / 2;
  aabb[0] = b.x - half;
  aabb[1] = b.y;
  aabb[2] = b.z - half;
  aabb[3] = b.x + half;
  aabb[4] = b.y + height;
  aabb[5] = b.z + half;
}

/**
 * Rising speed that lifts the feet `bankClearance` over a bank one block above the surface the
 * body floats at (its feet's cell + 2: the swimmer's climb out of ai/pathfind.ts). The ticks apply
 * gravity before moving, which loses about v·dt/2 of height: v = g·dt/2 + √((g·dt/2)² + 2·g·h).
 */
function climbOutSpeed(feet: number): number {
  const rise = Math.floor(feet) + 2 + PHYSICS.bankClearance - feet;
  const half = (PHYSICS.gravity * TICK_SECONDS) / 2;
  return half + Math.sqrt(half * half + 2 * PHYSICS.gravity * rise);
}

/**
 * One tick of a creature body towards the horizontal velocity (`wantX`, `wantZ`) when `steer`
 * (else it slides: knocked back or falling over). Walking into a wall on the ground or swimming
 * with `climb` hops (a one-block step, a bank at most one block above the surface). Returns whether a wall stopped it.
 */
export function stepCreatureBody(
  world: VoxelWorld,
  tables: RawTables,
  b: CreatureBody,
  width: number,
  height: number,
  wantX: number,
  wantZ: number,
  steer: boolean,
  climb: boolean,
): boolean {
  const dt = TICK_SECONDS;
  const wet = isLiquid(world, tables, b.x, b.y + Math.min(0.4, height / 2), b.z);
  if (steer) {
    const accel = CREATURE_BODY.accel * dt;
    const dvx = wantX - b.vx;
    const dvz = wantZ - b.vz;
    const dv = Math.sqrt(dvx * dvx + dvz * dvz);
    const k = dv <= accel ? 1 : accel / dv;
    b.vx += dvx * k;
    b.vz += dvz * k;
  } else if (b.onGround) {
    b.vx *= CREATURE_BODY.groundFriction;
    b.vz *= CREATURE_BODY.groundFriction;
  }
  // Buoyancy lifts at most to `swimUp`; a faster rise (a hop out onto the bank) falls as in air.
  b.vy =
    wet && b.vy <= CREATURE_BODY.swimUp
      ? Math.min(CREATURE_BODY.swimUp, b.vy + PHYSICS.gravity * dt)
      : Math.max(-PHYSICS.terminal, b.vy - PHYSICS.gravity * dt);
  setAabb(b, width, height);
  if (overlapsSolid(world, tables)) {
    // Buried (a debug fill): one cell up if the box is free there, else stuck: never through rock.
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
    const y = b.y;
    b.y = Math.floor(y) + 1;
    setAabb(b, width, height);
    if (overlapsSolid(world, tables)) b.y = y;
    return false;
  }
  const wantY = b.vy * dt;
  const dy = moveAxis(world, tables, 1, wantY);
  b.onGround = wantY < 0 && dy > wantY;
  if (dy !== wantY) b.vy = 0;
  const wantDx = b.vx * dt;
  const dx = moveAxis(world, tables, 0, wantDx);
  const wantDz = b.vz * dt;
  const dz = moveAxis(world, tables, 2, wantDz);
  const blocked = dx !== wantDx || dz !== wantDz;
  if (dx !== wantDx) b.vx = 0;
  if (dz !== wantDz) b.vz = 0;
  b.x += dx;
  b.y += dy;
  b.z += dz;
  if (blocked && climb && steer && (b.onGround || wet)) {
    b.vy = wet ? climbOutSpeed(b.y) : PHYSICS.jump;
    b.onGround = false;
  }
  return blocked;
}
