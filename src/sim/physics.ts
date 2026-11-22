import {
  COLLISION_BOXES,
  COLLISION_FULL,
  COLLISION_LIQUID,
  type RawTables,
} from '../content/registry.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';

/** Player movement constants (docs/conception.md « Joueur »). */
export const PHYSICS = {
  width: 0.6,
  height: 1.8,
  crouchHeight: 1.5,
  eye: 1.62,
  crouchEye: 1.27,
  walk: 4.3,
  sprint: 6.4,
  crouch: 1.6,
  swim: 2.4,
  gravity: 28,
  jump: 8.4,
  groundAccel: 50,
  airAccel: 12,
  waterAccel: 20,
  terminal: 50,
  /** Coyote time and jump buffer, in ticks (0.1 s at 30 Hz). */
  coyoteTicks: 3,
  jumpBufferTicks: 3,
  swimUp: 3.2,
  /**
   * Upward speed while swimming at the surface against a wall with jump held: enough to lift the
   * feet a little over one block above the water, so every bank of height ≤ 1 can be climbed.
   */
  waterExit: 8,
  epsilon: 1e-4,
} as const;

export interface Body {
  /** Feet position (centre of the bottom face). */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  /** Buoyancy and swimming (liquid at feet + 0.4). */
  inWater: boolean;
  /** The feet touch a liquid (water exit boost). */
  feetInWater: boolean;
  headInWater: boolean;
  /** A horizontal move was blocked last tick (climbing out of water). */
  hitWall: boolean;
  crouching: boolean;
  /** Ticks since the body last stood on ground (coyote time). */
  airTicks: number;
  /** Ticks since jump was pressed (jump buffer); large when not pressed. */
  jumpTicks: number;
  jumpHeldLast: boolean;
  /** Highest y since leaving the ground (fall damage). */
  fallStartY: number;
}

export interface MoveInput {
  /** −1…1 along the view (forward) and to the right (strafe). */
  forward: number;
  strafe: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  /** Radians, 0 looks north (−z). */
  yaw: number;
}

export interface StepResult {
  /** Fall distance when the body landed this tick (0 otherwise). */
  landedFrom: number;
  jumped: boolean;
  /** Effective horizontal mode this tick. */
  sprinting: boolean;
}

export function createBody(x: number, y: number, z: number): Body {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    onGround: false,
    inWater: false,
    feetInWater: false,
    headInWater: false,
    hitWall: false,
    crouching: false,
    airTicks: 0,
    jumpTicks: 99,
    jumpHeldLast: false,
    fallStartY: y,
  };
}

export function bodyHeight(body: Body): number {
  return body.crouching ? PHYSICS.crouchHeight : PHYSICS.height;
}

export function eyeHeight(body: Body): number {
  return body.crouching ? PHYSICS.crouchEye : PHYSICS.eye;
}

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
  const boxes = tables.collisionBoxes[c - COLLISION_BOXES]!;
  let n = 0;
  for (const b of boxes) {
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

const boxes = new Float64Array(6 * 8);
const aabb = new Float64Array(6);
const lo = new Float64Array(3);
const hi = new Float64Array(3);
const sweepMin = new Float64Array(3);
const sweepMax = new Float64Array(3);
const HORIZONTAL_AXES = [0, 2] as const;

function setAabb(body: Body, height: number): void {
  const half = PHYSICS.width / 2;
  aabb[0] = body.x - half;
  aabb[1] = body.y;
  aabb[2] = body.z - half;
  aabb[3] = body.x + half;
  aabb[4] = body.y + height;
  aabb[5] = body.z + half;
}

/**
 * Moves the AABB along one axis by `delta`, stopping at the first collision. Sweeps every cell the
 * move covers, so nothing is tunnelled through. Returns the distance actually moved.
 */
function moveAxis(world: VoxelWorld, tables: RawTables, axis: number, delta: number): number {
  if (delta === 0) return 0;
  const eps = PHYSICS.epsilon;
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
  const x0 = Math.floor(min[0]! + eps);
  const x1 = Math.floor(max[0]! - eps);
  const y0 = Math.floor(min[1]! + eps);
  const y1 = Math.floor(max[1]! - eps);
  const z0 = Math.floor(min[2]! + eps);
  const z1 = Math.floor(max[2]! - eps);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        const n = cellBoxes(world, tables, x, y, z, boxes);
        for (let b = 0; b < n; b++) {
          const o = b * 6;
          // Overlap on the two other axes?
          let overlaps = true;
          for (let a = 0; a < 3; a++) {
            if (a === axis) continue;
            if (!(boxes[o + a]! < hi[a]! - eps && boxes[o + 3 + a]! > lo[a]! + eps)) {
              overlaps = false;
              break;
            }
          }
          if (!overlaps) continue;
          if (delta > 0) {
            const gap = boxes[o + axis]! - hi[axis]!;
            if (gap >= -eps && gap < allowed) allowed = Math.max(0, gap - eps);
          } else {
            const gap = boxes[o + 3 + axis]! - lo[axis]!;
            if (gap <= eps && gap > allowed) allowed = Math.min(0, gap + eps);
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
function overlapsSolid(world: VoxelWorld, tables: RawTables): boolean {
  const eps = PHYSICS.epsilon;
  for (let x = Math.floor(aabb[0]! + eps); x <= Math.floor(aabb[3]! - eps); x++) {
    for (let y = Math.floor(aabb[1]! + eps); y <= Math.floor(aabb[4]! - eps); y++) {
      for (let z = Math.floor(aabb[2]! + eps); z <= Math.floor(aabb[5]! - eps); z++) {
        const n = cellBoxes(world, tables, x, y, z, boxes);
        for (let b = 0; b < n; b++) {
          const o = b * 6;
          if (
            boxes[o]! < aabb[3]! - eps &&
            boxes[o + 3]! > aabb[0]! + eps &&
            boxes[o + 1]! < aabb[4]! - eps &&
            boxes[o + 4]! > aabb[1]! + eps &&
            boxes[o + 2]! < aabb[5]! - eps &&
            boxes[o + 5]! > aabb[2]! + eps
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function isLiquid(world: VoxelWorld, tables: RawTables, x: number, y: number, z: number): boolean {
  return (
    tables.collision[world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))] ===
    COLLISION_LIQUID
  );
}

/** Whether something solid lies under the footprint of the AABB (crouch edge guard). */
function supported(world: VoxelWorld, tables: RawTables): boolean {
  const saved1 = aabb[1]!;
  const saved4 = aabb[4]!;
  aabb[1] = saved1 - 0.05;
  aabb[4] = saved1;
  const result = overlapsSolid(world, tables);
  aabb[1] = saved1;
  aabb[4] = saved4;
  return result;
}

/**
 * One physics tick for a player-sized body: acceleration towards the input velocity, exact
 * constant-gravity integration (y += v·dt − ½·g·dt²), then collisions resolved Y, X, Z.
 */
export function stepBody(
  body: Body,
  input: MoveInput,
  world: VoxelWorld,
  tables: RawTables,
  dt: number,
  out: StepResult,
): StepResult {
  out.landedFrom = 0;
  out.jumped = false;
  // Standing up needs head room.
  const wantCrouch = input.crouch && !body.inWater;
  if (body.crouching && !wantCrouch) {
    setAabb(body, PHYSICS.height);
    body.crouching = overlapsSolid(world, tables);
  } else {
    body.crouching = wantCrouch;
  }
  const height = bodyHeight(body);
  body.inWater = isLiquid(world, tables, body.x, body.y + 0.4, body.z);
  body.feetInWater = body.inWater || isLiquid(world, tables, body.x, body.y + 0.05, body.z);
  body.headInWater = isLiquid(world, tables, body.x, body.y + eyeHeight(body), body.z);
  const sprinting = input.sprint && !body.crouching && !body.inWater && input.forward > 0;
  out.sprinting = sprinting;

  // Horizontal: accelerate towards the wanted velocity.
  const speed = body.inWater
    ? PHYSICS.swim
    : body.crouching
      ? PHYSICS.crouch
      : sprinting
        ? PHYSICS.sprint
        : PHYSICS.walk;
  let fx = input.forward;
  let fs = input.strafe;
  const len = Math.sqrt(fx * fx + fs * fs);
  if (len > 1) {
    fx /= len;
    fs /= len;
  }
  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  const wantX = (-sin * fx + cos * fs) * speed;
  const wantZ = (-cos * fx - sin * fs) * speed;
  let accel = body.inWater
    ? PHYSICS.waterAccel
    : body.onGround
      ? PHYSICS.groundAccel
      : PHYSICS.airAccel;
  if (body.onGround) {
    const below = world.getBlock(Math.floor(body.x), Math.floor(body.y - 0.05), Math.floor(body.z));
    accel *= tables.friction[below]! / 100;
  }
  const dvx = wantX - body.vx;
  const dvz = wantZ - body.vz;
  const dv = Math.sqrt(dvx * dvx + dvz * dvz);
  const maxDv = accel * dt;
  if (dv <= maxDv) {
    body.vx = wantX;
    body.vz = wantZ;
  } else {
    body.vx += (dvx / dv) * maxDv;
    body.vz += (dvz / dv) * maxDv;
  }

  // Jump: buffered presses and coyote time.
  if (input.jump && !body.jumpHeldLast) body.jumpTicks = 0;
  else body.jumpTicks++;
  body.jumpHeldLast = input.jump;
  // Swimming at the surface into a bank with jump held climbs out (the feet clear one block).
  const climbOut = input.jump && body.hitWall && body.feetInWater && !body.headInWater;
  let dy: number;
  if (body.inWater) {
    const g = PHYSICS.gravity * 0.25;
    if (body.onGround && body.jumpTicks <= PHYSICS.jumpBufferTicks && !body.headInWater) {
      // Standing in shallow water: a normal jump.
      body.vy = PHYSICS.jump;
      body.jumpTicks = 99;
      body.onGround = false;
      out.jumped = true;
    } else if (climbOut) {
      body.vy = Math.max(body.vy, PHYSICS.waterExit);
    } else if (input.jump) {
      body.vy = Math.min(PHYSICS.swimUp, body.vy + 30 * dt);
    }
    dy = body.vy * dt - 0.5 * g * dt * dt;
    body.vy = Math.max(-PHYSICS.swim * 1.5, body.vy - g * dt);
  } else {
    if (climbOut) body.vy = Math.max(body.vy, PHYSICS.waterExit);
    const canJump = body.onGround || body.airTicks <= PHYSICS.coyoteTicks;
    if (canJump && body.jumpTicks <= PHYSICS.jumpBufferTicks && body.vy <= 0) {
      body.vy = PHYSICS.jump;
      body.jumpTicks = 99;
      body.airTicks = PHYSICS.coyoteTicks + 1;
      body.onGround = false;
      out.jumped = true;
    }
    dy = body.vy * dt - 0.5 * PHYSICS.gravity * dt * dt;
    body.vy = Math.max(-PHYSICS.terminal, body.vy - PHYSICS.gravity * dt);
  }

  setAabb(body, height);
  // Y first: landing and ceilings.
  const movedY = moveAxis(world, tables, 1, dy);
  const wasOnGround = body.onGround;
  if (movedY !== dy) {
    if (dy < 0) body.onGround = true;
    body.vy = 0;
  } else {
    body.onGround = false;
  }
  if (body.onGround) {
    if (!wasOnGround) out.landedFrom = Math.max(0, body.fallStartY - aabb[1]!);
    body.airTicks = 0;
    body.fallStartY = aabb[1]!;
  } else {
    body.airTicks++;
    if (body.inWater) body.fallStartY = aabb[1]!;
    else body.fallStartY = Math.max(body.fallStartY, aabb[1]!);
  }

  // X then Z; crouching on the ground never walks off an edge.
  body.hitWall = false;
  for (const axis of HORIZONTAL_AXES) {
    const delta = (axis === 0 ? body.vx : body.vz) * dt;
    if (delta === 0) continue;
    const before0 = aabb[axis]!;
    const before3 = aabb[axis + 3]!;
    const moved = moveAxis(world, tables, axis, delta);
    if (body.crouching && body.onGround && !supported(world, tables)) {
      aabb[axis] = before0;
      aabb[axis + 3] = before3;
      if (axis === 0) body.vx = 0;
      else body.vz = 0;
      continue;
    }
    if (moved !== delta) {
      if (axis === 0) body.vx = 0;
      else body.vz = 0;
      body.hitWall = true;
    }
  }

  body.x = (aabb[0]! + aabb[3]!) / 2;
  body.y = aabb[1]!;
  body.z = (aabb[2]! + aabb[5]!) / 2;
  return out;
}
