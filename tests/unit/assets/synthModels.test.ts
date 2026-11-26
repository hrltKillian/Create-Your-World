import { describe, expect, it } from 'vitest';
import { loudness, PEAK, synthesize } from '../../../src/assets/procedural/synth.ts';
import { contactSpectrum } from '../../../src/assets/procedural/synthModels.ts';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { footstep } from '../../../src/content/packs/base/sfxParts.ts';
import { SFX_LEVELS, type SfxDef, type SfxLayer } from '../../../src/content/schema.ts';

/*
 * Plan v5 « M53 » (decision 32): models of real sounds, takes that differ, noises without a
 * tonal line, every sound at the loudness of its class.
 */

const RATE = 22_050;
const one = (key: string, layer: Partial<SfxLayer>, def: Partial<SfxDef> = {}): SfxDef => ({
  key: key as SfxDef['key'],
  layers: [{ gain: 1, attack: 0.002, hold: 0.5, decay: 0.05, source: 'noise', ...layer }],
  ...def,
});

/** Power spectrum averaged over windows of 1024 samples (Hann), Welch's way. */
function spectrum(samples: Float32Array, size = 1024): Float64Array {
  const out = new Float64Array(size / 2);
  let frames = 0;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let start = 0; start + size <= samples.length; start += size / 2) {
    for (let i = 0; i < size; i++) {
      re[i] = samples[start + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < size / 2; k++) out[k] = out[k]! + re[k]! * re[k]! + im[k]! * im[k]!;
    frames++;
  }
  for (let k = 0; k < out.length; k++) out[k] = out[k]! / Math.max(1, frames);
  return out;
}

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len)
      for (let k = 0; k < len / 2; k++) {
        const [c, s] = [Math.cos(angle * k), Math.sin(angle * k)];
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * c - im[b]! * s;
        const ti = re[b]! * s + im[b]! * c;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
      }
  }
}

/** The strongest bin over the median of its neighbourhood (a tonal line stands far out). */
function line(power: Float64Array): number {
  let worst = 0;
  for (let k = 12; k < power.length - 12; k++) {
    const around = [...power.slice(k - 10, k + 11)].sort((a, b) => a - b);
    worst = Math.max(worst, power[k]! / Math.max(around[10]!, 1e-20));
  }
  return worst;
}

/** The bin of the strongest power above `fromHz`. */
const peakHz = (power: Float64Array, fromHz = 60) => {
  let best = Math.ceil((fromHz / RATE) * 1024);
  for (let k = best; k < power.length; k++) if (power[k]! > power[best]!) best = k;
  return (best * RATE) / 1024;
};

describe('models of real sounds (plan v5 « M53 »)', () => {
  it('keeps the noises free of any tonal line: white, pink, brown, wind', () => {
    for (const source of ['noise', 'pink', 'brown'] as const)
      expect(
        line(spectrum(synthesize(one(`sfx:t_${source}`, { source, hold: 1 }), RATE))),
        source,
      ).toBeLessThan(12);
    const wind = one('sfx:t_wind', {
      source: 'wind',
      wind: { gusts: 0.5, depth: 0.6, band: [200, 1200] },
      hold: 1.5,
    });
    expect(line(spectrum(synthesize(wind, RATE)))).toBeLessThan(12);
    // A tone is a line, by contrast.
    expect(
      line(spectrum(synthesize(one('sfx:t_tone', { source: 'sine', freq: [700, 700] }), RATE))),
    ).toBeGreaterThan(100);
  });

  it('pinks and browns the noise: less power in the highs', () => {
    const highShare = (source: 'noise' | 'pink' | 'brown') => {
      const p = spectrum(synthesize(one(`sfx:t_${source}`, { source, hold: 1 }), RATE));
      const low = p.slice(4, 40).reduce((a, b) => a + b, 0);
      const high = p.slice(200, 236).reduce((a, b) => a + b, 0);
      return high / low;
    };
    expect(highShare('pink')).toBeLessThan(highShare('noise') / 3);
    expect(highShare('brown')).toBeLessThan(highShare('pink') / 3);
  });

  it('strikes a body: a hard contact rings its high mode, a soft one hardly', () => {
    expect(contactSpectrum(100, 0.001)).toBeGreaterThan(0.95);
    expect(contactSpectrum(4000, 0.004)).toBeLessThan(0.05);
    const hit = (contact: number) =>
      spectrum(
        synthesize(
          one('sfx:t_impact', {
            source: 'impact',
            contact,
            modes: [
              [300, 0.3, 0.6],
              [3200, 0.3, 0.6],
            ],
            hold: 0.3,
          }),
          RATE,
        ),
      );
    const share = (p: Float64Array) =>
      p[Math.round((3200 / RATE) * 1024)]! / p[Math.round((300 / RATE) * 1024)]!;
    expect(share(hit(0.0003))).toBeGreaterThan(share(hit(0.004)) * 20);
  });

  it('rings bubbles at their Minnaert pitch: smaller ones higher', () => {
    const at = (radius: number) =>
      peakHz(
        spectrum(
          synthesize(
            one('sfx:t_bubbles', {
              source: 'bubbles',
              bubbles: { rate: 30, radius: [radius, radius * 1.05] },
              hold: 1,
            }),
            RATE,
          ),
        ),
      );
    expect(at(2)).toBeGreaterThan(1300);
    expect(at(2)).toBeLessThan(2100);
    expect(at(4)).toBeLessThan(at(2) * 0.65);
  });

  it('pops a fire: loud cracks among many small ticks', () => {
    const s = synthesize(
      one('sfx:t_crackle', {
        source: 'crackle',
        crackle: { rate: 60, freq: [1500, 5000] },
        hold: 2,
      }),
      RATE,
    );
    const peaks: number[] = [];
    for (let i = 0; i < s.length; i += 256) {
      let m = 0;
      for (let j = i; j < Math.min(s.length, i + 256); j++) m = Math.max(m, Math.abs(s[j]!));
      if (m > 0.01) peaks.push(m);
    }
    peaks.sort((a, b) => a - b);
    expect(peaks.length).toBeGreaterThan(40);
    expect(peaks[peaks.length - 1]!).toBeGreaterThan(peaks[Math.floor(peaks.length / 2)]! * 2.5);
  });

  it('speaks through its vowel: the formants move down with a longer tract', () => {
    const vowel = (tract: number) =>
      spectrum(
        synthesize(
          one('sfx:t_voice', {
            source: 'voice',
            voice: {
              pitch: [110, 110],
              tract,
              formants: [[800, 90, 1]],
              breath: 0,
              jitter: 0,
              shimmer: 0,
            },
            hold: 1,
          }),
          RATE,
        ),
      );
    expect(peakHz(vowel(1), 300)).toBeGreaterThan(650);
    expect(peakHz(vowel(1), 300)).toBeLessThan(950);
    expect(peakHz(vowel(2), 200)).toBeLessThan(500);
    // Jitter and a growl roughen the pitch: its harmonics blur into one another.
    const rough = synthesize(
      one('sfx:t_rough', {
        source: 'voice',
        voice: {
          pitch: [110, 110],
          tract: 1,
          formants: [[800, 90, 1]],
          breath: 0.2,
          jitter: 0.08,
          shimmer: 0.3,
          rough: 0.5,
        },
        hold: 1,
      }),
      RATE,
    );
    expect(line(spectrum(rough))).toBeLessThan(line(vowel(1)));
  });
});

describe('a footstep (plan v5 « M53 »)', () => {
  it('lands the heel, then the toe a little after and lighter', () => {
    const step: SfxDef = {
      key: 'sfx:t_footstep',
      layers: footstep(
        {
          modes: [[220, 0.04, 0.6]],
          contact: 0.003,
          grains: 200,
          filter: { type: 'bandpass', freq: 1500 },
        },
        1,
      ),
    };
    const s = synthesize(step, RATE);
    const energy = (from: number, to: number) => {
      let e = 0;
      for (let i = Math.round(from * RATE); i < Math.round(to * RATE); i++) e += s[i]! * s[i]!;
      return e;
    };
    const heel = energy(0, 0.03);
    const gap = energy(0.06, 0.08);
    const toe = energy(0.085, 0.115);
    expect(heel).toBeGreaterThan(toe);
    expect(toe).toBeGreaterThan(gap * 2);
  });
});

describe('takes and levels (plan v5 « M53 »)', () => {
  const step = one(
    'sfx:t_step',
    { source: 'grains', grains: { rate: 120, seconds: [0.002, 0.006] }, hold: 0.1 },
    { level: 'step' },
  );

  it('renders the same take twice, other takes otherwise', () => {
    expect(synthesize(step, RATE, 2)).toEqual(synthesize(step, RATE, 2));
    const takes = [0, 1, 2, 3].map((v) => synthesize(step, RATE, v));
    for (let a = 0; a < takes.length; a++)
      for (let b = a + 1; b < takes.length; b++) expect(takes[a]).not.toEqual(takes[b]);
  });

  it('brings every sound of a class to its loudness, under full scale', () => {
    for (const level of Object.keys(SFX_LEVELS) as (keyof typeof SFX_LEVELS)[]) {
      const s = synthesize({ ...step, level }, RATE);
      const db = 20 * Math.log10(loudness(s, RATE));
      expect(db, level).toBeCloseTo(SFX_LEVELS[level], 0);
      for (const v of s) expect(Math.abs(v)).toBeLessThanOrEqual(PEAK + 1e-6);
    }
  });

  it('classes every recipe of the pack, and its loudness is its class’s (or its peak’s limit)', () => {
    for (const def of basePack.sfx ?? []) {
      expect(def.level, def.key).toBeDefined();
      const s = synthesize(def, RATE);
      let peak = 0;
      for (const v of s) peak = Math.max(peak, Math.abs(v));
      const db = 20 * Math.log10(loudness(s, RATE));
      if (peak < PEAK - 1e-3)
        expect(Math.abs(db - SFX_LEVELS[def.level!]), def.key).toBeLessThan(0.5);
      else expect(db, def.key).toBeLessThanOrEqual(SFX_LEVELS[def.level!] + 0.5);
    }
  });
});
