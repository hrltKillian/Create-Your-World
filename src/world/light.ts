/** Packed voxel light: sky light (0–15) in the high nibble, block light (0–15) in the low nibble. */

/** Brightest level of a channel (open sky, the strongest emitters). */
export const MAX_LIGHT = 15;

/** Full sky light and no block light (open air, above the world). */
export const FULL_SKY = 0xf0;

/** Bit shift of each channel inside a packed light value. */
export const SKY_SHIFT = 4;
export const BLOCK_SHIFT = 0;

/** Sky light (0–15) of a packed light value. */
export function skyOf(packed: number): number {
  return packed >> 4;
}

/** Block light (0–15, from emitting blocks) of a packed light value. */
export function blockOf(packed: number): number {
  return packed & 15;
}

/**
 * The light rule (docs « Éclairage »): a step into a block of light filter `filter` costs
 * 1 + filter, except full sky light falling straight down (`skyDown`) through a filter-0 block,
 * which keeps 15. Opaque blocks have filter 15, so nothing gets through them.
 */
export function passLight(level: number, filter: number, skyDown: boolean): number {
  return skyDown && level === MAX_LIGHT && filter === 0 ? MAX_LIGHT : level - 1 - filter;
}
