import type { RawTables } from '../content/registry.ts';
import { CROUCH_EYE_HEIGHT, EYE_HEIGHT } from '../core/player.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import { aabb, isLiquid, moveAxis, overlapsSolid, solidCell, supported } from './collision.ts';

/** Player movement constants (docs/conception.md « Joueur »). */
export const PHYSICS = {
  width: 0.6,
  height: 1.8,
  crouchHeight: 1.5,
  eye: EYE_HEIGHT,
  crouchEye: CROUCH_EYE_HEIGHT,
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
  /** Height the feet clear above a bank's top when climbing out of water. */
  bankClearance: 0.1,
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
  /** Direction (−1, 0, 1) of horizontal moves blocked last tick, per axis (climbing out of water). */
  wallX: number;
  wallZ: number;
  crouching: boolean;
  /** Ticks since the body last stood on ground (coyote time). */
  airTicks: number;
  /** Ticks since jump was last held (jump buffer): 0 while held, large once released. */
  jumpTicks: number;
  /** Highest y since leaving the ground (fall damage). */
  fallStartY: number;
}

export interface MoveInput {
  /** −1…1 along the view (forward) and to the right (strafe). */
  forward: number;
  strafe: number;
  /** Jump key held (swimming up and climbing out of water need nothing more). */
  jump: boolean;
  /** A real jump may start (the simulation clears it when stamina is too low). */
  jumpAllowed: boolean;
  sprint: boolean;
  crouch: boolean;
  /** Multiplies the speed the body moves at (1; eating or drinking slows the player). */
  speedFactor: number;
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
  const body: Body = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    onGround: false,
    inWater: false,
    feetInWater: false,
    headInWater: false,
    wallX: 0,
    wallZ: 0,
    crouching: false,
    airTicks: 0,
    jumpTicks: 99,
    fallStartY: 0,
  };
  resetBody(body, x, y, z);
  return body;
}

/** Puts a body at rest at a position (spawn, teleport): airborne, the fall measured from there. */
export function resetBody(body: Body, x: number, y: number, z: number): void {
  body.x = x;
  body.y = y;
  body.z = z;
  body.vx = 0;
  body.vy = 0;
  body.vz = 0;
  body.onGround = false;
  body.airTicks = 0;
  body.fallStartY = y;
}

export function bodyHeight(body: Body): number {
  return body.crouching ? PHYSICS.crouchHeight : PHYSICS.height;
}

export function eyeHeight(body: Body): number {
  return body.crouching ? PHYSICS.crouchEye : PHYSICS.eye;
}

const HORIZONTAL_AXES = [0, 2] as const;

/** Puts the collision box around a body of the given height. */
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
 * Upward speed that lifts the feet `bankClearance` over the bank the body is swimming into, when
 * that bank's top is at most one block above the water surface and has head room; 0 otherwise
 * (cliffs, piers too high, underwater steps): then the swimmer just swims up.
 */
function waterExitSpeed(body: Body, world: VoxelWorld, tables: RawTables): number {
  if (body.wallX === 0 && body.wallZ === 0) return 0;
  const bx = Math.floor(body.x);
  const bz = Math.floor(body.z);
  // Surface: the first non-liquid cell above the feet.
  let surface = Math.floor(body.y + 0.05);
  for (let i = 0; i < 3 && isLiquid(world, tables, bx, surface, bz); i++) surface++;
  const reach = PHYSICS.width / 2 + 0.05;
  const cx = body.wallX !== 0 ? Math.floor(body.x + body.wallX * reach) : bx;
  const cz = body.wallX === 0 ? Math.floor(body.z + body.wallZ * reach) : bz;
  let top: number;
  if (solidCell(world, tables, cx, surface, cz)) top = surface + 1;
  else if (solidCell(world, tables, cx, surface - 1, cz)) top = surface;
  else return 0;
  if (solidCell(world, tables, cx, top, cz) || solidCell(world, tables, cx, top + 1, cz)) return 0;
  const rise = top + PHYSICS.bankClearance - body.y;
  return rise > 0 ? Math.sqrt(2 * PHYSICS.gravity * rise) : 0;
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
  updateCrouch(body, input, world, tables);
  const height = bodyHeight(body);
  body.inWater = isLiquid(world, tables, body.x, body.y + 0.4, body.z);
  body.feetInWater = body.inWater || isLiquid(world, tables, body.x, body.y + 0.05, body.z);
  body.headInWater = isLiquid(world, tables, body.x, body.y + eyeHeight(body), body.z);
  const sprinting = input.sprint && !body.crouching && !body.inWater && input.forward > 0;
  out.sprinting = sprinting;
  accelerate(body, input, world, tables, sprinting, dt);
  const dy = jumpAndGravity(body, input, world, tables, dt, out);
  setAabb(body, height);
  moveY(body, world, tables, dy, out);
  moveXZ(body, world, tables, dt);
  body.x = (aabb[0]! + aabb[3]!) / 2;
  body.y = aabb[1]!;
  body.z = (aabb[2]! + aabb[5]!) / 2;
  return out;
}

/** Crouch phase: follows the input (never in water), but standing up needs head room. */
function updateCrouch(body: Body, input: MoveInput, world: VoxelWorld, tables: RawTables): void {
  const wantCrouch = input.crouch && !body.inWater;
  if (body.crouching && !wantCrouch) {
    setAabb(body, PHYSICS.height);
    body.crouching = overlapsSolid(world, tables);
  } else {
    body.crouching = wantCrouch;
  }
}

/** Horizontal phase: accelerates the velocity towards the wanted one (ground friction applies). */
function accelerate(
  body: Body,
  input: MoveInput,
  world: VoxelWorld,
  tables: RawTables,
  sprinting: boolean,
  dt: number,
): void {
  const mode = body.inWater
    ? PHYSICS.swim
    : body.crouching
      ? PHYSICS.crouch
      : sprinting
        ? PHYSICS.sprint
        : PHYSICS.walk;
  const speed = mode * input.speedFactor;
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
}

/**
 * Jump and gravity phase: a held jump jumps again on each landing (a tap shortly before landing
 * still counts: the jump buffer), with coyote time after leaving an edge but never twice in the
 * air; swimming and climbing out of water. Updates the vertical speed and returns the vertical
 * move of this tick.
 */
function jumpAndGravity(
  body: Body,
  input: MoveInput,
  world: VoxelWorld,
  tables: RawTables,
  dt: number,
  out: StepResult,
): number {
  if (input.jump) body.jumpTicks = 0;
  else body.jumpTicks++;
  // Swimming at the surface into a climbable bank with jump held lifts the feet onto it.
  const exit =
    input.jump && body.feetInWater && !body.headInWater ? waterExitSpeed(body, world, tables) : 0;
  if (body.inWater) {
    if (
      input.jumpAllowed &&
      body.onGround &&
      body.jumpTicks <= PHYSICS.jumpBufferTicks &&
      !body.headInWater
    ) {
      // Standing in shallow water: a normal jump.
      body.vy = PHYSICS.jump;
      body.jumpTicks = 99;
      body.onGround = false;
      out.jumped = true;
    } else if (exit > 0) {
      body.vy = Math.max(body.vy, exit);
    } else if (input.jump && body.vy < PHYSICS.swimUp) {
      body.vy = Math.min(PHYSICS.swimUp, body.vy + 30 * dt);
    }
    // Water slows swimming speeds only: a jump or a climb out keeps full gravity.
    const g = body.vy > PHYSICS.swimUp ? PHYSICS.gravity : PHYSICS.gravity * 0.25;
    const dy = body.vy * dt - 0.5 * g * dt * dt;
    body.vy = Math.max(-PHYSICS.swim * 1.5, body.vy - g * dt);
    return dy;
  }
  if (exit > 0) body.vy = Math.max(body.vy, exit);
  const canJump = input.jumpAllowed && (body.onGround || body.airTicks <= PHYSICS.coyoteTicks);
  if (canJump && body.jumpTicks <= PHYSICS.jumpBufferTicks && body.vy <= 0) {
    body.vy = PHYSICS.jump;
    body.jumpTicks = 99;
    body.airTicks = PHYSICS.coyoteTicks + 1;
    body.onGround = false;
    out.jumped = true;
  }
  const dy = body.vy * dt - 0.5 * PHYSICS.gravity * dt * dt;
  body.vy = Math.max(-PHYSICS.terminal, body.vy - PHYSICS.gravity * dt);
  return dy;
}

/** Y phase (on the AABB): landing and ceilings, ground contact and the height a fall started from. */
function moveY(
  body: Body,
  world: VoxelWorld,
  tables: RawTables,
  dy: number,
  out: StepResult,
): void {
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
}

/** X/Z phase (on the AABB): X then Z; crouching on the ground never walks off an edge. */
function moveXZ(body: Body, world: VoxelWorld, tables: RawTables, dt: number): void {
  body.wallX = 0;
  body.wallZ = 0;
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
      if (axis === 0) {
        body.vx = 0;
        body.wallX = Math.sign(delta);
      } else {
        body.vz = 0;
        body.wallZ = Math.sign(delta);
      }
    }
  }
}
