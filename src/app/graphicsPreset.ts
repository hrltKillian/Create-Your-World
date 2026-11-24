import { QUALITIES, QUALITY_PRESETS, type Quality } from '../render/quality.ts';
import type { App } from './App.ts';

/**
 * Applies a graphics preset now (`render.setQuality`): the drawing buffer's pixel-ratio cap and
 * the render distance of the open world (the particles switch arrives with the settings screen).
 * Returns the preset and the pixel ratio in use.
 */
export function applyQuality(app: App, quality: Quality) {
  if (!QUALITIES.includes(quality))
    throw new Error(`Unknown quality "${quality}" (${QUALITIES.join(', ')})`);
  const preset = QUALITY_PRESETS[quality];
  app.renderer?.setMaxPixelRatio(preset.pixelRatio);
  app.session?.setRenderDistance(preset.renderDistance);
  return { quality, ...preset, pixelRatio: app.renderer?.webgl.getPixelRatio() ?? 0 };
}
