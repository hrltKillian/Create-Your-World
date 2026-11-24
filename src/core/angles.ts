/** Largest view pitch (radians): 89° up or down, so the view never flips over. */
export const PITCH_LIMIT = (89 * Math.PI) / 180;

export function clampPitch(pitch: number): number {
  return Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Unit view direction for a yaw (0 looks north, −z; positive turns towards −x) and a pitch
 * (positive looks up), written into `out`.
 */
export function lookVector(yaw: number, pitch: number, out: Vec3): Vec3 {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}

/** Yaw of a direction on the ground plane (lookVector's convention: 0 looks towards −z). */
export function yawOf(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** The yaw and pitch that look from `eye` towards `at` (the inverse of lookVector). */
export function anglesTo(eye: Readonly<Vec3>, at: Readonly<Vec3>): { yaw: number; pitch: number } {
  const dx = at.x - eye.x;
  const dy = at.y - eye.y;
  const dz = at.z - eye.z;
  return { yaw: yawOf(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}
