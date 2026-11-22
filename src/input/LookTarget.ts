/** Whatever owns the view angles (the camera rig). Input adds mouse movement to it every frame. */
export interface LookTarget {
  yaw: number;
  pitch: number;
  /** Adds a mouse delta already scaled to radians. */
  addLook(dYaw: number, dPitch: number): void;
}

export const PITCH_LIMIT = (89 * Math.PI) / 180;

export function clampPitch(pitch: number): number {
  return Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
}
