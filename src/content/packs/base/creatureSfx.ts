import type { CreatureSound, SfxDef, SfxKey, SfxLayer, SfxSource } from '../../schema.ts';

type FilterType = NonNullable<SfxLayer['filter']>['type'];

/** A tone gliding from `from` to `to` Hz, optionally through a lowpass at `lowpass` Hz. */
const tone = (
  source: SfxSource,
  [from, to]: readonly [number, number],
  gain: number,
  [attack, decay]: readonly [number, number],
  delay = 0,
  lowpass?: number,
): SfxLayer => ({
  source,
  freq: [from, to],
  gain,
  attack,
  decay,
  delay,
  ...(lowpass ? { filter: { type: 'lowpass', freq: lowpass } } : {}),
});

/** Filtered noise: breath, hiss, clicks and thuds. */
const hiss = (
  type: FilterType,
  freq: number,
  gain: number,
  [attack, decay]: readonly [number, number],
  delay = 0,
  q = 0.8,
): SfxLayer => ({ source: 'noise', filter: { type, freq, q }, gain, attack, decay, delay });

/**
 * A voiced call (plan v4 « M45 »): a source at a pitch gliding over `pitch` and wavering by
 * `vibrato`, heard through the formants of the creature's throat (band-pass frequency, share):
 * the vowel that makes each species recognisable.
 */
const call = (
  source: SfxSource,
  pitch: readonly [number, number],
  formants: readonly (readonly [number, number])[],
  gain: number,
  [attack, decay]: readonly [number, number],
  delay = 0,
  vibrato = { rate: 5, depth: 0.25 },
): SfxLayer[] =>
  formants.map(([freq, share]) => ({
    source,
    freq: [pitch[0], pitch[1]],
    gain: gain * share,
    attack,
    decay,
    delay,
    vibrato,
    filter: { type: 'bandpass', freq, q: 5 },
  }));

/** Struck resonances (shells, crystals): frequency, ring time, gain. */
const struck = (
  modes: readonly (readonly [number, number, number])[],
  gain: number,
  delay = 0,
): SfxLayer => ({
  source: 'modal',
  modes,
  gain,
  attack: 0.001,
  hold: Math.max(...modes.map(([, ring]) => ring)),
  decay: 0.02,
  delay,
});

/** Chittering: pitched clicks at `rate` a second for `seconds`. */
const chitter = (
  rate: number,
  [low, high]: readonly [number, number],
  gain: number,
  seconds: number,
): SfxLayer => ({
  source: 'grains',
  grains: { rate, seconds: [0.003, 0.008], tone: [low, high] },
  gain,
  attack: 0.005,
  hold: seconds,
  decay: 0.04,
});

/** The throats of Veyra's fauna: formants (Hz, share) of each species' vowel. */
const THROAT = {
  trotter: [
    [650, 1],
    [1800, 0.6],
    [2700, 0.3],
  ],
  shagback: [
    [350, 1],
    [800, 0.5],
    [2300, 0.2],
  ],
  prowler: [
    [900, 1],
    [1400, 0.7],
    [3200, 0.4],
  ],
  shellback: [
    [300, 1],
    [620, 0.5],
  ],
  reedwader: [
    [700, 1],
    [1100, 0.7],
    [2500, 0.3],
  ],
} as const;

/** A shell's knock and a crystal's chime (struck modes). */
const SHELL = [
  [620, 0.08, 0.6],
  [1430, 0.05, 0.3],
  [2650, 0.03, 0.15],
] as const;
const CRYSTAL = [
  [1320, 0.6, 0.5],
  [2210, 0.45, 0.3],
  [3150, 0.3, 0.2],
] as const;

/**
 * Creature voices (docs « Audio », plan v4 « M45 »): each species calls through its own throat
 * (formants) with its own waver: the Trotter bleats « eh », the Shagback bellows « oo », the
 * Prowler warbles a raspy « ah », the Reedwader honks; the Swarmling chitters, the Shellback's
 * shell knocks under a rumble, the Glimmerback chimes like struck crystal and whistles. The
 * Trotter and the Glimmerback never attack.
 */
const VOICES = {
  trotter: {
    idle: [
      ...call('sawtooth', [520, 610], THROAT.trotter, 0.7, [0.02, 0.16], 0, {
        rate: 6,
        depth: 0.4,
      }),
      ...call('sawtooth', [610, 470], THROAT.trotter, 0.6, [0.02, 0.18], 0.14, {
        rate: 6,
        depth: 0.4,
      }),
    ],
    alert: [
      hiss('bandpass', 1800, 0.4, [0.005, 0.12], 0, 2),
      ...call('square', [700, 900], THROAT.trotter, 0.45, [0.005, 0.1], 0, { rate: 9, depth: 0.6 }),
    ],
    hurt: call('sawtooth', [900, 480], THROAT.trotter, 0.9, [0.005, 0.22], 0, {
      rate: 12,
      depth: 0.8,
    }),
    death: [
      ...call('sawtooth', [720, 210], THROAT.trotter, 0.9, [0.01, 0.6], 0, { rate: 4, depth: 0.6 }),
      hiss('lowpass', 600, 0.25, [0.005, 0.25], 0.45),
    ],
  },
  shagback: {
    idle: call('sawtooth', [92, 80], THROAT.shagback, 0.9, [0.06, 0.5], 0, {
      rate: 3.5,
      depth: 0.3,
    }),
    alert: [
      ...call('sawtooth', [140, 185], THROAT.shagback, 1, [0.04, 0.45], 0, { rate: 4, depth: 0.5 }),
      tone('square', [70, 92], 0.18, [0.04, 0.45], 0, 300),
    ],
    hurt: [
      ...call('sawtooth', [210, 120], THROAT.shagback, 1, [0.01, 0.25], 0, { rate: 7, depth: 0.8 }),
      hiss('lowpass', 500, 0.25, [0.005, 0.15]),
    ],
    attack: [
      hiss('bandpass', 420, 0.5, [0.01, 0.3], 0, 1),
      ...call('sawtooth', [110, 160], THROAT.shagback, 0.9, [0.02, 0.35], 0, {
        rate: 5,
        depth: 0.6,
      }),
    ],
    death: call('sawtooth', [150, 55], THROAT.shagback, 1, [0.05, 1.2], 0, {
      rate: 2.5,
      depth: 0.5,
    }),
  },
  prowler: {
    idle: [hiss('bandpass', 900, 0.2, [0.1, 0.4], 0, 4), tone('sine', [56, 50], 0.22, [0.1, 0.5])],
    alert: [
      hiss('highpass', 3000, 0.35, [0.02, 0.35]),
      ...call('sawtooth', [300, 620], THROAT.prowler, 0.6, [0.01, 0.25], 0, {
        rate: 9,
        depth: 1.2,
      }),
    ],
    hurt: [
      ...call('sawtooth', [320, 180], THROAT.prowler, 0.9, [0.005, 0.2], 0, {
        rate: 11,
        depth: 1.4,
      }),
      hiss('bandpass', 1200, 0.3, [0.005, 0.15], 0, 2),
    ],
    attack: [
      ...call('sawtooth', [500, 920], THROAT.prowler, 0.9, [0.01, 0.25], 0, {
        rate: 9,
        depth: 1.2,
      }),
      hiss('highpass', 2500, 0.3, [0.005, 0.2]),
    ],
    death: call('sawtooth', [600, 120], THROAT.prowler, 0.9, [0.02, 0.9], 0, { rate: 6, depth: 1 }),
  },
  swarmling: {
    idle: [chitter(45, [3200, 4800], 0.4, 0.18)],
    alert: [
      chitter(90, [2600, 4200], 0.35, 0.25),
      tone('square', [220, 265], 0.15, [0.01, 0.3], 0, 1800),
    ],
    hurt: [
      chitter(140, [1800, 3200], 0.45, 0.08),
      tone('triangle', [2200, 1400], 0.2, [0.003, 0.1]),
    ],
    attack: [
      hiss('bandpass', 3000, 0.35, [0.002, 0.05], 0, 2),
      chitter(120, [3000, 5200], 0.35, 0.12),
    ],
    death: [tone('sine', [900, 200], 0.3, [0.003, 0.15]), chitter(30, [1500, 2600], 0.3, 0.35)],
  },
  shellback: {
    idle: [
      hiss('lowpass', 300, 0.35, [0.06, 0.4]),
      ...call('sawtooth', [70, 60], THROAT.shellback, 0.6, [0.06, 0.4]),
    ],
    alert: [
      struck(SHELL, 0.45),
      struck(SHELL, 0.4, 0.12),
      tone('triangle', [180, 160], 0.15, [0.005, 0.1]),
    ],
    hurt: [struck(SHELL, 0.5), tone('triangle', [240, 200], 0.3, [0.003, 0.18])],
    attack: [
      ...call('sawtooth', [80, 120], THROAT.shellback, 1, [0.05, 0.7], 0, { rate: 3, depth: 0.4 }),
      hiss('lowpass', 400, 0.35, [0.05, 0.6]),
    ],
    death: [
      hiss('lowpass', 250, 0.5, [0.01, 0.8]),
      ...call('sawtooth', [120, 40], THROAT.shellback, 0.9, [0.02, 1], 0, { rate: 2, depth: 0.5 }),
    ],
  },
  glimmerback: {
    idle: [
      struck(CRYSTAL, 0.25),
      { ...tone('sine', [880, 990], 0.14, [0.03, 0.3], 0.1), vibrato: { rate: 11, depth: 0.5 } },
    ],
    alert: [
      struck(CRYSTAL, 0.4),
      { ...tone('triangle', [1100, 1500], 0.2, [0.005, 0.14]), vibrato: { rate: 14, depth: 0.7 } },
    ],
    hurt: [struck(CRYSTAL, 0.45), tone('triangle', [1200, 600], 0.25, [0.005, 0.25], 0, 3000)],
    death: [
      struck(CRYSTAL, 0.4),
      struck(CRYSTAL, 0.25, 0.3),
      { ...tone('sine', [990, 330], 0.25, [0.02, 0.8]), vibrato: { rate: 6, depth: 1 } },
    ],
  },
  reedwader: {
    idle: call('square', [220, 180], THROAT.reedwader, 0.55, [0.01, 0.18], 0, {
      rate: 7,
      depth: 0.5,
    }),
    alert: [
      ...call('square', [300, 420], THROAT.reedwader, 0.7, [0.005, 0.12], 0, {
        rate: 7,
        depth: 0.6,
      }),
      ...call('square', [300, 420], THROAT.reedwader, 0.7, [0.005, 0.12], 0.16, {
        rate: 7,
        depth: 0.6,
      }),
    ],
    hurt: call('sawtooth', [520, 260], THROAT.reedwader, 0.9, [0.005, 0.2], 0, {
      rate: 10,
      depth: 1,
    }),
    attack: [hiss('bandpass', 2400, 0.4, [0.002, 0.06], 0, 3), struck(SHELL, 0.2)],
    death: call('square', [260, 90], THROAT.reedwader, 0.9, [0.01, 0.7], 0, {
      rate: 4,
      depth: 0.8,
    }),
  },
} as const satisfies Readonly<Record<string, Partial<Record<CreatureSound, readonly SfxLayer[]>>>>;

export type VoicedCreature = keyof typeof VOICES;

const voiceKey = (id: string, sound: string) => `sfx:${id}_${sound}` as SfxKey;

/** The sound keys of a creature's voices (`sfx:<id>_<sound>`), for its `sounds`. */
export function voicesOf(id: VoicedCreature): Partial<Record<CreatureSound, SfxKey>> {
  return Object.fromEntries(Object.keys(VOICES[id]).map((sound) => [sound, voiceKey(id, sound)]));
}

/** Synthesis recipes of every creature voice. */
export const creatureSfx: readonly SfxDef[] = Object.entries(VOICES).flatMap(([id, voices]) =>
  Object.entries(voices).map(([sound, layers]) => ({ key: voiceKey(id, sound), layers })),
);
