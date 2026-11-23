import type { RawTables } from '../content/registry.ts';
import { clampPitch } from '../core/angles.ts';
import { CROUCH_EYE_HEIGHT, EYE_HEIGHT } from '../core/player.ts';
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
 * Owns the view angles (input writes them every frame) and places the camera: at the interpolated
 * eye in first person, or behind the head in third person, pulled in front of walls.
 */
export class CameraRig implements LookTarget {
  yaw = 0;
  pitch = 0;
  mode: CameraMode = 'first';
  /** Current third-person distance (smoothed), for tests. */
  distance = 0;
  readonly pose: CameraPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  private eye = EYE_HEIGHT;

  addLook(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = clampPitch(this.pitch + dPitch);
  }

  toggleMode(): void {
    this.mode = this.mode === 'first' ? 'third' : 'first';
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
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 14);
    const eyeY = y + this.eye;
    this.pose.yaw = this.yaw;
    this.pose.pitch = this.pitch;
    if (this.mode === 'first') {
      this.pose.x = x;
      this.pose.y = eyeY;
      this.pose.z = z;
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
}
