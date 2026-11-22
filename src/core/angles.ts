/** Largest view pitch (radians): 89° up or down, so the view never flips over. */
export const PITCH_LIMIT = (89 * Math.PI) / 180;

export function clampPitch(pitch: number): number {
  return Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
}
