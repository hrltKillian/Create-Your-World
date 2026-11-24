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
