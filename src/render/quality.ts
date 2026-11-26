/**
 * Graphics quality presets (docs « Rendu », « Réglages » → graphismes): each sets a default render
 * distance, the cap on the drawing buffer's pixel ratio (`min(DPR, cap)`), whether particles
 * are drawn, the sun's shadow map (plan v4 « M37 », decision 28) and bloom (« M40 »). Medium is the default and
 * the preset the bench thresholds are measured on.
 */

export const QUALITIES = ['low', 'medium', 'high'] as const;
export type Quality = (typeof QUALITIES)[number];

export interface QualityPreset {
  /** Render distance in columns (presets 4 / 6 / 8 of « Streaming »). */
  readonly renderDistance: number;
  /** Upper bound of the pixel ratio (« préréglages 1 / 1,5 / 2 »). */
  readonly pixelRatio: number;
  readonly particles: boolean;
  /** Texels a side of the sun's shadow map (0: no shadows; `SHADOW_SIZES`). */
  readonly shadows: number;
  /** Bloom round what shines, with a multisampled frame (plan v4 « M40 »). */
  readonly bloom: boolean;
}

/** Sizes of the sun's shadow map, none first (`SunShadow`: 48 blocks a side per 1024). */
export const SHADOW_SIZES: readonly number[] = [0, 1024, 2048];

export const QUALITY_PRESETS: Readonly<Record<Quality, QualityPreset>> = {
  low: { renderDistance: 4, pixelRatio: 1, particles: false, shadows: 0, bloom: false },
  medium: { renderDistance: 6, pixelRatio: 1.5, particles: true, shadows: 1024, bloom: false },
  high: { renderDistance: 8, pixelRatio: 2, particles: true, shadows: 2048, bloom: true },
};

export const DEFAULT_QUALITY: Quality = 'medium';

/** A preset name (`?quality=`), or null when absent or unknown. */
export function parseQuality(value: string | null): Quality | null {
  return QUALITIES.find((q) => q === value) ?? null;
}
