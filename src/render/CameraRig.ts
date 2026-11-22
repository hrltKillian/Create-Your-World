import { FLAG_SOLID, type RawTables } from '../content/registry.ts';
import type { LookTarget } from '../input/LookTarget.ts';
import type { PlayerState } from '../sim/player.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import type { CameraPose } from './WorldView.ts';

export type CameraMode = 'first' | 'third';

const THIRD_DISTANCE = 4;
const THIRD_HEIGHT = 0.5;
const MIN_DISTANCE = 0.6;
const CROUCH_EYE = 1.27;
const STAND_EYE = 1.62;

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
  private eye = STAND_EYE;

  addLook(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch += dPitch;
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
    const targetEye = b.crouching ? CROUCH_EYE : STAND_EYE;
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
    // Behind the head along the view direction, stopping before solid blocks.
    const cp = Math.cos(this.pitch);
    const dirX = Math.sin(this.yaw) * cp;
    const dirY = -Math.sin(this.pitch);
    const dirZ = Math.cos(this.yaw) * cp;
    const headY = eyeY + THIRD_HEIGHT;
    let free = THIRD_DISTANCE;
    for (let d = 0.1; d <= THIRD_DISTANCE; d += 0.1) {
      const state = world.getBlock(
        Math.floor(x + dirX * d),
        Math.floor(headY + dirY * d),
        Math.floor(z + dirZ * d),
      );
      if ((tables.flags[state]! & FLAG_SOLID) !== 0) {
        free = Math.max(MIN_DISTANCE, d - 0.3);
        break;
      }
    }
    // Pull in at once, ease out slowly.
    this.distance =
      free < this.distance ? free : this.distance + (free - this.distance) * Math.min(1, dt * 12);
    this.pose.x = x + dirX * this.distance;
    this.pose.y = headY + dirY * this.distance;
    this.pose.z = z + dirZ * this.distance;
    return this.pose;
  }
}
