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

/** What a surface sounds like underfoot (plan v5 « M53 »): its body's modes and its grains. */
export interface Surface {
  /** The body struck by the heel and the toe (empty: a soft ground, only its grains). */
  readonly modes: Modes;
  /** How long a foot's contact lasts on it (s): short on stone, long on moss. */
  readonly contact: number;
  /** Its grains crunching, a second, and their colour. */
  readonly grains: number;
  readonly filter: Filter;
}

/** Seconds from the heel to the toe of a step. */
const TOE_DELAY = 0.085;

/**
 * A footstep (plan v5 « M53 »): the heel's blow on the surface, then the toe's a little after and
 * lighter, each crunching the surface's grains for a moment.
 */
export const footstep = (surface: Surface, gain: number): SfxLayer[] => {
  const blow = (g: number, delay: number): SfxLayer[] => [
    ...(surface.modes.length > 0
      ? [
          {
            source: 'impact' as const,
            modes: surface.modes,
            contact: surface.contact,
            gain: g,
            attack: 0.001,
            hold: Math.max(...surface.modes.map(([, ring]) => ring)),
            decay: 0.02,
            delay,
          },
        ]
      : []),
    { ...crunch(surface.filter, surface.grains, g * 0.8, 0.05, delay), attack: surface.contact },
  ];
  return [...blow(gain, 0), ...blow(gain * 0.6, TOE_DELAY)];
};
