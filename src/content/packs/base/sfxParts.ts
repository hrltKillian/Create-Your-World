import type { Formant, SfxLayer } from '../../schema.ts';

/*
 * Building blocks of the base pack's sound recipes (plan v5 « M54 »): each a layer of one of the
 * synthesizer's models of real sounds (assets/procedural/synthModels.ts), in the terms a sound is
 * made of: a body struck, grains crunching, bubbles, a fire's pops, air moving, a voice.
 */

export type Filter = NonNullable<SfxLayer['filter']>;

/** Resonant modes: frequency (Hz), ring time (s), gain. */
export type Modes = readonly (readonly [number, number, number])[];

/** Where a layer starts and how its envelope opens: delay, attack, hold (s). */
export interface When {
  readonly delay?: number;
  readonly attack?: number;
  readonly hold?: number;
}

/**
 * A body struck (`impact`): its modes ring from a contact `contact` seconds long (short: hard and
 * bright, long: soft and dull), each mode's ring scaled by `ring` and its pitch by `pitch`.
 */
export const impact = (
  modes: Modes,
  contact: number,
  gain: number,
  { delay = 0, ring = 1, pitch = 1 }: { delay?: number; ring?: number; pitch?: number } = {},
): SfxLayer => {
  const scaled = modes.map(([f, r, g]) => [f * pitch, r * ring, g] as const);
  return {
    source: 'impact',
    modes: scaled,
    contact,
    gain,
    attack: 0.0008,
    hold: Math.max(...scaled.map(([, r]) => r)),
    decay: 0.02,
    delay,
  };
};

/** Grains crunching (`grains` of noise), `rate` a second for `seconds`, in a filter's colour. */
export const crunch = (
  filter: Filter,
  rate: number,
  gain: number,
  seconds: number,
  {
    delay = 0,
    attack = 0.002,
    grain = [0.002, 0.007] as readonly [number, number],
  }: {
    delay?: number;
    attack?: number;
    grain?: readonly [number, number];
  } = {},
): SfxLayer => ({
  source: 'grains',
  grains: { rate, seconds: grain },
  filter,
  gain,
  attack,
  hold: seconds,
  decay: 0.03,
  delay,
});

/** A burst of noise (white, pink or brown) through a filter, `decay` s long. */
export const burst = (
  source: 'noise' | 'pink' | 'brown',
  filter: Filter,
  gain: number,
  decay: number,
  { delay = 0, attack = 0.002, hold = 0 }: When = {},
): SfxLayer => ({ source, filter, gain, attack, hold, decay, delay });

/** Bubbles (`bubbles`), `rate` a second, of radii (mm) for `seconds`. */
export const bubbles = (
  rate: number,
  radius: readonly [number, number],
  gain: number,
  seconds: number,
  { delay = 0, attack = 0.002 }: When = {},
  filter?: Filter,
): SfxLayer => ({
  source: 'bubbles',
  bubbles: { rate, radius },
  ...(filter ? { filter } : {}),
  gain,
  attack,
  hold: seconds,
  decay: 0.05,
  delay,
});

/** A fire's pops (`crackle`), `rate` a second, ringing within `freq` Hz, for `seconds`. */
export const crackle = (
  rate: number,
  freq: readonly [number, number],
  gain: number,
  seconds: number,
  { delay = 0, attack = 0.01 }: When = {},
  filter?: Filter,
): SfxLayer => ({
  source: 'crackle',
  crackle: { rate, freq },
  ...(filter ? { filter } : {}),
  gain,
  attack,
  hold: seconds,
  decay: 0.08,
  delay,
});

/** Air moving (`wind`): gusts a second, their depth, the band it wanders in, for `seconds`. */
export const air = (
  gusts: number,
  depth: number,
  band: readonly [number, number],
  gain: number,
  seconds: number,
  { delay = 0, attack = 0.3 }: When = {},
): SfxLayer => ({
  source: 'wind',
  wind: { gusts, depth, band },
  gain,
  attack,
  hold: seconds,
  decay: Math.min(0.5, seconds / 2 + 0.05),
  delay,
});

/** A voice's character: its tract, breath, roughness and the vowel it shapes. */
export interface Throat {
  /** The vocal tract's length to an adult human's. */
  readonly tract: number;
  readonly formants: readonly Formant[];
  readonly breath: number;
  readonly jitter: number;
  readonly shimmer: number;
  readonly rough?: number;
}

/** A voice (`voice`) through a throat, its pitch gliding from one to the other (Hz). */
export const voice = (
  throat: Throat,
  pitch: readonly [number, number],
  gain: number,
  decay: number,
  { delay = 0, attack = 0.02, hold = 0 }: When = {},
  filter?: Filter,
): SfxLayer => ({
  source: 'voice',
  voice: { pitch, ...throat },
  ...(filter ? { filter } : {}),
  gain,
  attack,
  hold,
  decay,
  delay,
});

/** An adult human's vowels: formant frequency, bandwidth and gain. */
export const VOWELS = {
  a: [
    [730, 90, 1],
    [1090, 110, 0.5],
    [2440, 170, 0.25],
  ],
  o: [
    [570, 80, 1],
    [840, 100, 0.5],
    [2410, 160, 0.2],
  ],
  u: [
    [300, 70, 1],
    [870, 100, 0.3],
    [2240, 150, 0.15],
  ],
  e: [
    [530, 80, 1],
    [1840, 120, 0.5],
    [2480, 170, 0.3],
  ],
  i: [
    [270, 60, 1],
    [2290, 140, 0.4],
    [3010, 200, 0.3],
  ],
} as const satisfies Record<string, readonly Formant[]>;

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
export const footstep = (surface: Surface, gain: number, toe = TOE_DELAY): SfxLayer[] => {
  const blow = (g: number, delay: number): SfxLayer[] => [
    ...(surface.modes.length > 0 ? [impact(surface.modes, surface.contact, g, { delay })] : []),
    ...(surface.grains > 0
      ? [crunch(surface.filter, surface.grains, g * 0.8, 0.05, { delay, attack: surface.contact })]
      : []),
  ];
  return [...blow(gain, 0), ...blow(gain * 0.6, toe)];
};
