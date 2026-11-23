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
