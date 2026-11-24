/**
 * Graphics quality presets (docs « Rendu », « Réglages » → graphismes): each sets a default render
 * distance, the cap on the drawing buffer's pixel ratio (`min(DPR, cap)`) and whether particles
 * are drawn. Medium is the default and the preset the bench thresholds are measured on.
 */

export const QUALITIES = ['low', 'medium', 'high'] as const;
export type Quality = (typeof QUALITIES)[number];

export interface QualityPreset {
  /** Render distance in columns (presets 4 / 6 / 8 of « Streaming »). */
  readonly renderDistance: number;
  /** Upper bound of the pixel ratio (« préréglages 1 / 1,5 / 2 »). */
  readonly pixelRatio: number;
  readonly particles: boolean;
}

export const QUALITY_PRESETS: Readonly<Record<Quality, QualityPreset>> = {
  low: { renderDistance: 4, pixelRatio: 1, particles: false },
  medium: { renderDistance: 6, pixelRatio: 1.5, particles: true },
  high: { renderDistance: 8, pixelRatio: 2, particles: true },
};

export const DEFAULT_QUALITY: Quality = 'medium';

/** A preset name (`?quality=`), or null when absent or unknown. */
export function parseQuality(value: string | null): Quality | null {
  return QUALITIES.find((q) => q === value) ?? null;
}
