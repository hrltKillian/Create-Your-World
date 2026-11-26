import type { SfxLayer, SfxSource } from '../../schema.ts';

/** Building blocks of the base pack's sound recipes (sfx.ts, playerSfx.ts, ambienceSfx.ts). */

export type Filter = NonNullable<SfxLayer['filter']>;

/** A burst of filtered noise `decay` s long after `delay`, its filter frequency × `pitch`. */
export const noise = (
  filter: Filter,
  gain: number,
  decay: number,
  delay = 0,
  pitch = 1,
): SfxLayer => ({
  source: 'noise',
  filter: { ...filter, freq: filter.freq * pitch },
  gain,
  attack: 0.003,
  decay,
  delay,
});

/** A tone gliding from `from` to `to` Hz, `decay` s long after `delay`. */
export const tone = (
  source: SfxSource,
  from: number,
  to: number,
  gain: number,
  decay: number,
  delay = 0,
): SfxLayer => ({ source, freq: [from, to], gain, attack: 0.002, decay, delay });

/** Resonant modes: frequency (Hz), ring time (s), gain. */
export type Modes = readonly (readonly [number, number, number])[];

/**
 * Modes struck at once (plan v4 « M44 »): each rings `ring` × its own time, at `pitch` × its
 * frequency, after `delay`; the layer lasts as long as the longest.
 */
export const struck = (modes: Modes, gain: number, ring = 1, pitch = 1, delay = 0): SfxLayer => {
  const scaled = modes.map(([f, r, g]) => [f * pitch, r * ring, g] as const);
  const longest = Math.max(...scaled.map(([, r]) => r));
  return { source: 'modal', modes: scaled, gain, attack: 0.001, hold: longest, decay: 0.02, delay };
};

/** A crunch (plan v4 « M44 »): `rate` grains a second of filtered noise for `seconds`, after `delay`. */
export const crunch = (
  filter: Filter,
  rate: number,
  gain: number,
  seconds: number,
  delay = 0,
): SfxLayer => ({
  source: 'grains',
  grains: { rate, seconds: [0.002, 0.007] },
  filter,
  gain,
  attack: 0.002,
  hold: seconds,
  decay: 0.03,
  delay,
});
