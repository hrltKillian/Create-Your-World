import type { RawTables } from '../content/registry.ts';
import { clampPitch, type Vec3 } from '../core/angles.ts';
import { CROUCH_EYE_HEIGHT, EYE_HEIGHT, STRIDE } from '../core/player.ts';
import type { LookTarget } from '../input/LookTarget.ts';
import type { PlayerState } from '../sim/player.ts';
import { createRayHit, RAY_SOLID, raycast } from '../world/raycast.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import type { CameraPose } from './WorldView.ts';

export type CameraMode = 'first' | 'third';

/** Third-person offset: 4 m behind the eye and 0.5 m above it. */
const THIRD_DISTANCE = 4;
const THIRD_HEIGHT = 0.5;
/** Distance kept from the first solid block (the near plane is 0.05). */
const WALL_MARGIN = 0.3;
/** Side offset of the four extra probe rays around the main one. */
const PROBE_SPREAD = 0.15;
const hit = createRayHit();

/**
 * View bob (docs « Caméra 1re personne »): 0.035 m up and down, one dip a step (STRIDE, the
 * footsteps' own: the phase turns half a turn a stride).
 */
export const BOB = 0.035;
/** Speed (m/s) from which the bob has its whole amplitude (slower: less); eased at BOB_RATE (1/s). */
const BOB_FULL_SPEED = 3.5;
const BOB_RATE = 8;
/** A move longer than this between two frames (m) is a teleport, not a step. */
const MAX_FRAME_MOVE = 1;
/** Landing dip: DIP_PER_BLOCK m per block fallen, at most DIP_MAX; down in DIP_IN s, up in DIP_OUT. */
const DIP_PER_BLOCK = 0.04;
export const DIP_MAX = 0.14;
const DIP_IN = 0.06;
const DIP_OUT = 0.25;
/** Hurt roll (radians) towards the side hit, in and out like the dip. */
export const HURT_ROLL = 0.07;
const ROLL_IN = 0.06;
const ROLL_OUT = 0.35;
/** Sprint widens the view (degrees), eased at FOV_RATE (1/s), snapped within FOV_SNAP. */
export const SPRINT_FOV = 8;
const FOV_RATE = 10;
const FOV_SNAP = 0.01;

/** An envelope over time `t` (s): 0 → 1 in `rise` s (a quarter sine), back to 0 in `fall` s. */
export function pulse(t: number, rise: number, fall: number): number {
  if (t < rise) return Math.sin((Math.PI / 2) * (t / rise));
  if (t < rise + fall) return Math.cos((Math.PI / 2) * ((t - rise) / fall));
  return 0;
}

/**
 * Owns the view angles (input writes them every frame) and places the camera: at the interpolated
 * eye in first person, or behind the head in third person, pulled in front of walls. In first
 * person the camera bobs while walking (`viewBob`), dips on a landing (`land`), rolls towards the
 * side of a blow taken (`hurt`) and widens while sprinting (`fovOffset`); the eye (the aim's
 * origin) never moves with them.
 */
export class CameraRig implements LookTarget {
  yaw = 0;
  pitch = 0;
  mode: CameraMode = 'first';
  /** Current third-person distance (smoothed), for tests. */
  distance = 0;
  readonly pose: CameraPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fovOffset: 0 };
  /** The interpolated eye, where the client's aim starts (the camera, in first person). */
  readonly eye: Vec3 = { x: 0, y: 0, z: 0 };
  /** View bob on (Settings). */
  viewBob = true;
  /** Degrees added to the field of view (sprinting, eased). */
  fovOffset = 0;
  private eyeHeight = EYE_HEIGHT;
  /** Bob phase (radians, half a turn a step) and amplitude factor (0…1, eased). */
  private bobPhase = 0;
  private bobScale = 0;
  /** The interpolated feet at the last frame (NaN before the first). */
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  /** Seconds since the last landing and its dip (m); since the last blow and its side (±1). */
  private sinceLand = Number.POSITIVE_INFINITY;
  private dipDepth = 0;
  private sinceHurt = Number.POSITIVE_INFINITY;
  private hurtSide = 0;

  addLook(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = clampPitch(this.pitch + dPitch);
  }

  toggleMode(): void {
    this.mode = this.mode === 'first' ? 'third' : 'first';
  }

  /** The player landed after falling `fall` blocks: the view dips, deeper for a longer fall. */
  land(fall: number): void {
    this.dipDepth = Math.min(DIP_MAX, DIP_PER_BLOCK * fall);
    this.sinceLand = 0;
  }

  /** A blow struck the player from (x, z): the view rolls towards that side. */
  hurt(x: number, z: number): void {
    // Along the view's right (cos yaw, −sin yaw): positive on the right.
    const across = (x - this.eye.x) * Math.cos(this.yaw) - (z - this.eye.z) * Math.sin(this.yaw);
    this.hurtSide = across >= 0 ? 1 : -1;
    this.sinceHurt = 0;
  }

  /** The bob's vertical offset now (m): −BOB at each footfall, +BOB between, 0 at rest. */
  bobOffset(): number {
    return this.viewBob ? -BOB * this.bobScale * Math.cos(2 * this.bobPhase) : 0;
  }

  /** Updates the camera pose for a player, interpolated between the last two ticks. */
  update(
    player: Readonly<PlayerState>,
    alpha: number,
    world: VoxelWorld,
    tables: RawTables,
    dt: number,
  ): CameraPose {
    const b = player.body;
    const x = player.prevX + (b.x - player.prevX) * alpha;
    const y = player.prevY + (b.y - player.prevY) * alpha;
    const z = player.prevZ + (b.z - player.prevZ) * alpha;
    const targetEye = b.crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 14);
    const eyeY = y + this.eyeHeight;
    this.eye.x = x;
    this.eye.y = eyeY;
    this.eye.z = z;
    this.pose.yaw = this.yaw;
    this.pose.pitch = this.pitch;
    this.feel(player, x, z, dt);
    this.pose.fovOffset = this.fovOffset;
    this.pose.roll = 0;
    if (this.mode === 'first') {
      // The bob sways across the view at half the step rate, along its right (cos yaw, −sin yaw).
      const side = this.viewBob ? BOB * 0.5 * this.bobScale * Math.sin(this.bobPhase) : 0;
      const dip = this.dipDepth * pulse(this.sinceLand, DIP_IN, DIP_OUT);
      this.pose.x = x + Math.cos(this.yaw) * side;
      this.pose.y = eyeY + this.bobOffset() - dip;
      this.pose.z = z - Math.sin(this.yaw) * side;
      // A positive roll leans the view left: towards a blow from the right it is negative.
      this.pose.roll = -this.hurtSide * HURT_ROLL * pulse(this.sinceHurt, ROLL_IN, ROLL_OUT);
      this.distance = 0;
      return this.pose;
    }
    // From the eye (always inside the player's own box) towards the point behind and above it,
    // stopping WALL_MARGIN before the first solid block on any of five parallel probe rays.
    const cp = Math.cos(this.pitch);
    const ox = Math.sin(this.yaw) * cp * THIRD_DISTANCE;
    const oy = -Math.sin(this.pitch) * THIRD_DISTANCE + THIRD_HEIGHT;
    const oz = Math.cos(this.yaw) * cp * THIRD_DISTANCE;
    const length = Math.sqrt(ox * ox + oy * oy + oz * oz);
    const ux = ox / length;
    const uy = oy / length;
    const uz = oz / length;
    // Unit vectors across the ray: horizontal right, and up = right × direction.
    let rx = -uz;
    let rz = ux;
    const rl = Math.sqrt(rx * rx + rz * rz) || 1;
    rx /= rl;
    rz /= rl;
    const vx = -rz * uy;
    const vy = rz * ux - rx * uz;
    const vz = rx * uy;
    let free = length;
    for (let probe = 0; probe < 5; probe++) {
      const side = probe === 1 ? 1 : probe === 2 ? -1 : 0;
      const up = probe === 3 ? 1 : probe === 4 ? -1 : 0;
      const px = x + (rx * side + vx * up) * PROBE_SPREAD;
      const py = eyeY + vy * up * PROBE_SPREAD;
      const pz = z + (rz * side + vz * up) * PROBE_SPREAD;
      raycast(world, tables, px, py, pz, ux, uy, uz, free + WALL_MARGIN, hit, RAY_SOLID);
      if (hit.hit) free = Math.min(free, Math.max(0, hit.distance - WALL_MARGIN));
    }
    // Pull in at once, ease out slowly.
    this.distance =
      free < this.distance ? free : this.distance + (free - this.distance) * Math.min(1, dt * 12);
    this.pose.x = x + ux * this.distance;
    this.pose.y = eyeY + uy * this.distance;
    this.pose.z = z + uz * this.distance;
    return this.pose;
  }

  /**
   * Advances the view's feel by a frame: the bob follows the ground the interpolated feet (x, z)
   * covered while on dry ground, easing out in the air, in water or at rest; the dip and the roll
   * age; the field of view eases towards +SPRINT_FOV while sprinting in first person.
   */
  private feel(player: Readonly<PlayerState>, x: number, z: number, dt: number): void {
    const b = player.body;
    const onFoot = b.onGround && !b.inWater;
    let moved = Math.hypot(x - this.lastX, z - this.lastZ);
    this.lastX = x;
    this.lastZ = z;
    // NaN on the first frame; a teleport or a respawn is no step either: the stride starts again.
    if (!(moved <= MAX_FRAME_MOVE)) {
      moved = 0;
      this.bobPhase = 0;
    }
    // The ground the footsteps count (audio/bodySounds.ts: on foot, out of water), so each one
    // falls at the bottom of a dip.
    if (onFoot) this.bobPhase = (this.bobPhase + (moved * Math.PI) / STRIDE) % (Math.PI * 2);
    const walking = onFoot && dt > 0;
    const scale = walking ? Math.min(1, moved / dt / BOB_FULL_SPEED) : 0;
    this.bobScale += (scale - this.bobScale) * Math.min(1, dt * BOB_RATE);
    this.sinceLand += dt;
    this.sinceHurt += dt;
    const fov = player.sprinting && this.mode === 'first' ? SPRINT_FOV : 0;
    this.fovOffset += (fov - this.fovOffset) * Math.min(1, dt * FOV_RATE);
    if (Math.abs(fov - this.fovOffset) < FOV_SNAP) this.fovOffset = fov;
  }
}
