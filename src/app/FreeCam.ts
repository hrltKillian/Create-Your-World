import { clampPitch } from '../core/angles.ts';
import type { InputManager } from '../input/InputManager.ts';
import type { LookTarget } from '../input/LookTarget.ts';
import type { CameraPose } from '../render/WorldView.ts';

/**
 * Developer free camera (M1–M2), driven by the InputManager's actions: the movement keys fly,
 * jump rises, crouch sinks and sprint goes faster. Mouse look comes from the same manager
 * (Pointer Lock, or dragging with `?noLock=1`).
 */
export class FreeCam implements LookTarget {
  readonly pose: CameraPose;
  speed = 12;
  private readonly input: InputManager;

  constructor(input: InputManager, pose: CameraPose) {
    this.input = input;
    this.pose = { ...pose };
  }

  get yaw(): number {
    return this.pose.yaw;
  }

  set yaw(value: number) {
    this.pose.yaw = value;
  }

  get pitch(): number {
    return this.pose.pitch;
  }

  set pitch(value: number) {
    this.pose.pitch = value;
  }

  addLook(dYaw: number, dPitch: number): void {
    this.pose.yaw += dYaw;
    this.pose.pitch = clampPitch(this.pose.pitch + dPitch);
  }

  set(pose: Partial<CameraPose>): void {
    Object.assign(this.pose, pose);
  }

  update(dt: number): void {
    const input = this.input;
    input.applyMouseLook(this);
    const forward = input.axis('forward', 'back');
    const strafe = input.axis('right', 'left');
    const lift = input.axis('jump', 'crouch');
    if (forward === 0 && strafe === 0 && lift === 0) return;
    const speed = this.speed * (input.isDown('sprint') ? 4 : 1) * dt;
    const sin = Math.sin(this.pose.yaw);
    const cos = Math.cos(this.pose.yaw);
    this.pose.x += (-sin * forward + cos * strafe) * speed;
    this.pose.z += (-cos * forward - sin * strafe) * speed;
    this.pose.y += lift * speed;
  }
}
