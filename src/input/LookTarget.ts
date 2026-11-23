/**
 * Whatever owns the view angles (the camera rig or the free camera). Input adds mouse movement to
 * it every frame.
 */
export interface LookTarget {
  yaw: number;
  pitch: number;
  /** Adds a mouse delta already scaled to radians. */
  addLook(dYaw: number, dPitch: number): void;
}

export { clampPitch } from '../core/angles.ts';
