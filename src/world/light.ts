/** Packed voxel light: sky light (0–15) in the high nibble, block light (0–15) in the low nibble. */

/** Full sky light and no block light (open air, above the world). */
export const FULL_SKY = 0xf0;

/** Sky light (0–15) of a packed light value. */
export function skyOf(packed: number): number {
  return packed >> 4;
}

/** Block light (0–15, from emitting blocks) of a packed light value. */
export function blockOf(packed: number): number {
  return packed & 15;
}
