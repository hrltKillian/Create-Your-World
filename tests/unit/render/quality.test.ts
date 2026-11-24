import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUALITY,
  parseQuality,
  QUALITIES,
  QUALITY_PRESETS,
} from '../../../src/render/quality.ts';

describe('quality presets', () => {
  it('raise the render distance and the pixel-ratio cap from Low to High', () => {
    expect(QUALITIES.map((q) => QUALITY_PRESETS[q].renderDistance)).toEqual([4, 6, 8]);
    expect(QUALITIES.map((q) => QUALITY_PRESETS[q].pixelRatio)).toEqual([1, 1.5, 2]);
    expect(QUALITY_PRESETS.low.particles).toBe(false);
    expect(QUALITY_PRESETS.high.particles).toBe(true);
  });

  it('default to Medium, whose numbers are the bench thresholds’ (RD 6, DPR ≤ 1.5)', () => {
    expect(DEFAULT_QUALITY).toBe('medium');
    expect(QUALITY_PRESETS[DEFAULT_QUALITY]).toMatchObject({ renderDistance: 6, pixelRatio: 1.5 });
  });

  it('parse ?quality= names only', () => {
    expect(parseQuality('high')).toBe('high');
    expect(parseQuality('High')).toBeNull();
    expect(parseQuality(null)).toBeNull();
  });
});
