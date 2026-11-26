import { describe, expect, it } from 'vitest';
import { biquad, PEAK, SFX_SAMPLE_RATE, synthesize } from '../../../src/assets/procedural/synth.ts';
import { basePack } from '../../../src/content/packs/base/index.ts';
import type { SfxDef, SfxLayer } from '../../../src/content/schema.ts';
import { sfxSeconds } from '../../../src/content/validateSounds.ts';

const RATE = 22_050;
const one = (key: string, layer: SfxLayer): SfxDef => ({
  key: key as SfxDef['key'],
  layers: [layer],
});
const rms = (s: Float32Array, from = 0, to = s.length) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += s[i]! * s[i]!;
  return Math.sqrt(sum / Math.max(1, to - from));
};

describe('the synthesizer (plan v4 « M44 »)', () => {
  it('renders every recipe of the pack the same twice, its length, never clipping', () => {
    const t0 = performance.now();
    for (const def of basePack.sfx ?? []) {
      if (def.loop) continue;
      const a = synthesize(def, RATE);
      expect(a.length, def.key).toBe(Math.max(1, Math.ceil(sfxSeconds(def) * RATE)));
      let peak = 0;
      for (const v of a) peak = Math.max(peak, Math.abs(v));
      expect(peak, def.key).toBeLessThanOrEqual(PEAK + 1e-6);
      expect(Number.isFinite(peak), def.key).toBe(true);
      expect(synthesize(def, RATE)).toEqual(a);
    }
    // The startup's one-shots stay cheap (half the rate here: twice as many samples in the game).
    expect(performance.now() - t0).toBeLessThan(4000);
  });

  it('strikes modes that ring and fade, the longest last', () => {
    const s = synthesize(
      one('sfx:test_modal', {
        source: 'modal',
        modes: [
          [440, 0.05, 0.6],
          [1300, 0.6, 0.3],
        ],
        gain: 1,
        attack: 0.001,
        hold: 0.6,
        decay: 0.01,
      }),
      RATE,
    );
    const early = rms(s, 0, RATE * 0.03);
    const late = rms(s, RATE * 0.3, RATE * 0.35);
    expect(early).toBeGreaterThan(late * 2);
    expect(late).toBeGreaterThan(0.003);
  });

  it('scatters grains: silence between them, and more of them at a higher rate', () => {
    const grains = (rate: number) =>
      synthesize(
        one('sfx:test_grains', {
          source: 'grains',
          grains: { rate, seconds: [0.003, 0.006] },
          gain: 1,
          attack: 0.001,
          hold: 1,
          decay: 0.01,
        }),
        RATE,
      );
    const bursts = (s: Float32Array) => {
      let n = 0;
      let quiet = true;
      for (const v of s) {
        if (Math.abs(v) > 0.05 && quiet) n++;
        quiet = Math.abs(v) < 0.01;
      }
      return n;
    };
    expect(bursts(grains(200))).toBeGreaterThan(bursts(grains(20)));
    expect(bursts(grains(20))).toBeGreaterThan(5);
  });

  it('filters: a low-pass keeps a low tone and cuts a high one', () => {
    const tone = (hz: number) => {
      const s = new Float32Array(RATE / 4);
      for (let i = 0; i < s.length; i++) s[i] = Math.sin((2 * Math.PI * hz * i) / RATE);
      biquad(s, 'lowpass', 500, 0.7, RATE);
      return rms(s, s.length / 2);
    };
    expect(tone(100)).toBeGreaterThan(0.6);
    expect(tone(5000)).toBeLessThan(0.05);
  });

  it('renders at the game rate by default', () => {
    expect(SFX_SAMPLE_RATE).toBe(44_100);
  });
});
