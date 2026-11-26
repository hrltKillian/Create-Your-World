import type { CreatureSound, SfxDef, SfxKey, SfxLayer } from '../../schema.ts';
import {
  bubbles,
  burst,
  crackle,
  crunch,
  footstep,
  impact,
  type Modes,
  type Throat,
  VOWELS,
  voice,
} from './sfxParts.ts';

/*
 * The creatures' voices and steps (plan v5 « M54 », decision 39): each drawn from its body. A
 * voice is glottal pulses through a vocal tract as long as the throat (twice a human's for the
 * Shagback, the formants an octave down), rough or clear, breathy or not; shells knock, chitin
 * clicks, wings buzz, bills clatter; a step is the creature's feet on the ground, hooves, pads,
 * claws or toes, as heavy as it is.
 */

/** The throats: tract length to an adult human's, vowel, breath, jitter, shimmer, growl. */
const THROATS = {
  // A small grazer's nasal bleat.
  trotter: { tract: 0.75, formants: VOWELS.e, breath: 0.25, jitter: 0.03, shimmer: 0.18 },
  // A huge chest: a deep, rough bellow.
  shagback: {
    tract: 2.3,
    formants: VOWELS.o,
    breath: 0.35,
    jitter: 0.05,
    shimmer: 0.3,
    rough: 0.45,
  },
  // A stalker's growl, all breath and rasp.
  prowler: { tract: 1.5, formants: VOWELS.u, breath: 0.6, jitter: 0.08, shimmer: 0.4, rough: 0.7 },
  // A long throat inside a shell: a hollow, slow rumble.
  shellback: {
    tract: 2.6,
    formants: VOWELS.o,
    breath: 0.3,
    jitter: 0.06,
    shimmer: 0.35,
    rough: 0.5,
  },
  // A soft, breathy hum.
  glimmerback: { tract: 1.1, formants: VOWELS.u, breath: 0.5, jitter: 0.015, shimmer: 0.1 },
  // A wader's harsh croak.
  reedwader: {
    tract: 0.55,
    formants: VOWELS.a,
    breath: 0.3,
    jitter: 0.06,
    shimmer: 0.35,
    rough: 0.5,
  },
} as const satisfies Record<string, Throat>;

/** Hooves on the ground: small and hard, or heavy. */
const HOOF: Modes = [
  [620, 0.02, 0.5],
  [1450, 0.012, 0.3],
];
const HEAVY: Modes = [
  [75, 0.08, 0.7],
  [160, 0.05, 0.4],
  [340, 0.03, 0.2],
];
/** A shell: its hollow knock. */
const SHELL: Modes = [
  [185, 0.16, 0.6],
  [415, 0.12, 0.4],
  [770, 0.08, 0.25],
  [1310, 0.05, 0.12],
];
/** Chitin and a bill: hard, tiny, bright. */
const CHITIN: Modes = [
  [3100, 0.012, 0.5],
  [5200, 0.008, 0.3],
];
const BILL: Modes = [
  [1700, 0.02, 0.5],
  [3900, 0.012, 0.3],
];
/** A soft paw or a toe on soil. */
const PAD: Modes = [[130, 0.04, 0.5]];

const SOIL = { type: 'lowpass', freq: 1200, q: 0.7 } as const;
const GRIT = { type: 'bandpass', freq: 1800, q: 0.8 } as const;

/** Clicks in a series (mandibles, a bill's clatter): `count` of them, `gap` s apart. */
const clicks = (modes: Modes, count: number, gap: number, gain: number, delay = 0): SfxLayer[] =>
  Array.from({ length: count }, (_, i) =>
    impact(modes, 0.0004, gain * (1 - i * 0.05), { delay: delay + i * gap * (1 + (i % 3) * 0.12) }),
  );

/** A wing's buzz: a beating sawtooth, wavering. */
const buzz = (
  pitch: readonly [number, number],
  gain: number,
  seconds: number,
  delay = 0,
): SfxLayer => ({
  source: 'sawtooth',
  freq: pitch,
  vibrato: { rate: 23, depth: 0.6 },
  filter: { type: 'bandpass', freq: 900, q: 0.9 },
  gain,
  attack: 0.03,
  hold: seconds,
  decay: 0.08,
  delay,
});

/** A body falling to the ground. */
const fall = (modes: Modes, delay: number, gain = 0.8): SfxLayer[] => [
  impact(modes, 0.012, gain, { delay }),
  crunch(SOIL, 180, gain * 0.5, 0.1, { delay: delay + 0.01 }),
];

const T = THROATS;

const VOICES = {
  trotter: {
    // A snort through the nose, a soft murmur.
    idle: [
      burst('pink', { type: 'bandpass', freq: 900, q: 0.8 }, 0.6, 0.12, { attack: 0.02 }),
      voice(T.trotter, [230, 210], 0.4, 0.12, { delay: 0.1 }),
    ],
    alert: [voice(T.trotter, [430, 520], 0.9, 0.2, { attack: 0.03, hold: 0.18 })],
    hurt: [
      voice({ ...T.trotter, rough: 0.35 }, [640, 430], 0.9, 0.15, { attack: 0.01, hold: 0.08 }),
    ],
    death: [
      voice({ ...T.trotter, rough: 0.3 }, [470, 170], 0.9, 0.45, { attack: 0.02, hold: 0.35 }),
      ...fall(HEAVY, 0.8, 0.6),
    ],
    step: footstep({ modes: HOOF, contact: 0.001, grains: 80, filter: GRIT }, 0.6, 0.06),
  },
  shagback: {
    idle: [voice(T.shagback, [72, 66], 0.8, 0.3, { attack: 0.08, hold: 0.35 })],
    alert: [
      burst('pink', { type: 'lowpass', freq: 700 }, 0.6, 0.15, { attack: 0.02 }),
      voice(T.shagback, [88, 112], 0.9, 0.3, { delay: 0.12, attack: 0.08, hold: 0.45 }),
    ],
    attack: [
      voice({ ...T.shagback, rough: 0.65, breath: 0.45 }, [95, 80], 1, 0.25, {
        attack: 0.05,
        hold: 0.45,
      }),
    ],
    hurt: [voice(T.shagback, [125, 82], 0.9, 0.2, { attack: 0.02, hold: 0.2 })],
    death: [
      voice(T.shagback, [100, 48], 1, 0.5, { attack: 0.05, hold: 0.9 }),
      ...fall(HEAVY, 1.3, 1),
    ],
    step: footstep({ modes: HEAVY, contact: 0.006, grains: 140, filter: SOIL }, 0.9, 0.1),
  },
  prowler: {
    idle: [voice(T.prowler, [46, 42], 0.7, 0.3, { attack: 0.1, hold: 0.5 })],
    // A hiss through bared teeth.
    alert: [
      burst('pink', { type: 'highpass', freq: 2600 }, 0.8, 0.25, { attack: 0.04, hold: 0.2 }),
      voice(T.prowler, [70, 60], 0.4, 0.2, { attack: 0.06, hold: 0.25 }),
    ],
    // A snarl, the jaws snapping.
    attack: [
      voice({ ...T.prowler, formants: VOWELS.a, rough: 0.8 }, [150, 110], 1, 0.15, {
        attack: 0.02,
        hold: 0.2,
      }),
      impact(BILL, 0.0006, 0.6, { delay: 0.3, pitch: 0.6 }),
    ],
    hurt: [
      voice({ ...T.prowler, formants: VOWELS.a }, [270, 170], 0.9, 0.15, {
        attack: 0.01,
        hold: 0.1,
      }),
    ],
    death: [
      voice({ ...T.prowler, rough: 0.9 }, [95, 38], 0.9, 0.5, { attack: 0.03, hold: 0.6 }),
      ...fall(PAD, 0.9),
    ],
    step: footstep({ modes: PAD, contact: 0.01, grains: 60, filter: SOIL }, 0.35, 0.07),
  },
  swarmling: {
    // Mandibles clicking, a chitter.
    idle: [
      ...clicks(CHITIN, 5, 0.045, 0.6),
      {
        ...crunch(GRIT, 120, 0.3, 0.2),
        grains: { rate: 120, seconds: [0.002, 0.004], tone: [2600, 4800] },
      },
    ],
    alert: [buzz([190, 210], 0.6, 0.45), ...clicks(CHITIN, 4, 0.05, 0.5, 0.1)],
    attack: [
      ...clicks(CHITIN, 8, 0.03, 0.7),
      burst('pink', { type: 'highpass', freq: 3500 }, 0.5, 0.12, { delay: 0.05 }),
    ],
    hurt: [
      { source: 'sine', freq: [2600, 1500], gain: 0.6, attack: 0.005, decay: 0.12 },
      ...clicks(CHITIN, 3, 0.03, 0.6),
    ],
    death: [buzz([200, 60], 0.7, 0.5), crackle(40, [2000, 6000], 0.5, 0.4, { delay: 0.1 })],
    step: [...clicks(CHITIN, 3, 0.03, 0.4)],
  },
  shellback: {
    idle: [
      impact(SHELL, 0.002, 0.7),
      voice(T.shellback, [58, 54], 0.5, 0.3, { delay: 0.1, attack: 0.1, hold: 0.3 }),
    ],
    alert: [
      voice(T.shellback, [55, 78], 1, 0.3, { attack: 0.08, hold: 0.5 }),
      impact(SHELL, 0.003, 0.5, { delay: 0.1 }),
    ],
    // The charge's bellow, claws scraping.
    attack: [
      voice({ ...T.shellback, rough: 0.7 }, [80, 70], 1, 0.2, { attack: 0.04, hold: 0.45 }),
      crunch(GRIT, 260, 0.5, 0.3, { delay: 0.05 }),
    ],
    // The shell's plates cracking under the blow, a grunt.
    hurt: [
      impact(SHELL, 0.0008, 0.9),
      crackle(60, [900, 3000], 0.5, 0.08),
      voice(T.shellback, [90, 60], 0.6, 0.2, { delay: 0.05 }),
    ],
    death: [
      voice(T.shellback, [70, 35], 1, 0.6, { attack: 0.05, hold: 0.7 }),
      impact(SHELL, 0.004, 0.9, { delay: 1.1 }),
      ...fall(HEAVY, 1.12),
    ],
    step: [
      ...footstep({ modes: HEAVY, contact: 0.008, grains: 120, filter: SOIL }, 0.9, 0.12),
      crackle(30, [200, 900], 0.3, 0.1),
    ],
  },
  glimmerback: {
    // A soft hum, its spores ticking like glass.
    idle: [
      voice(T.glimmerback, [180, 190], 0.5, 0.3, { attack: 0.15, hold: 0.4 }),
      impact(
        [
          [4200, 0.25, 0.4],
          [6300, 0.18, 0.2],
        ],
        0.0003,
        0.12,
        { delay: 0.2 },
      ),
    ],
    alert: [
      burst('pink', { type: 'bandpass', freq: 1400, q: 0.9 }, 0.6, 0.1, { attack: 0.01 }),
      voice({ ...T.glimmerback, breath: 0.35 }, [520, 600], 0.7, 0.15, {
        delay: 0.08,
        attack: 0.03,
        hold: 0.12,
      }),
    ],
    hurt: [
      voice({ ...T.glimmerback, rough: 0.25 }, [430, 300], 0.8, 0.15, { attack: 0.01, hold: 0.1 }),
    ],
    death: [
      voice(T.glimmerback, [300, 120], 0.8, 0.5, { attack: 0.03, hold: 0.5 }),
      ...fall(HEAVY, 0.9, 0.5),
    ],
    step: footstep(
      { modes: PAD, contact: 0.006, grains: 100, filter: { type: 'lowpass', freq: 2200 } },
      0.5,
      0.06,
    ),
  },
  reedwader: {
    idle: [voice(T.reedwader, [115, 100], 0.8, 0.12, { attack: 0.01, hold: 0.15 })],
    alert: [voice(T.reedwader, [620, 500], 1, 0.12, { attack: 0.01, hold: 0.22 })],
    // The bill clattering, a squawk.
    attack: [
      ...clicks(BILL, 6, 0.055, 0.7),
      voice(T.reedwader, [700, 560], 0.6, 0.1, { delay: 0.3, hold: 0.1 }),
    ],
    hurt: [
      voice({ ...T.reedwader, rough: 0.35 }, [900, 620], 1, 0.12, { attack: 0.005, hold: 0.1 }),
    ],
    death: [
      voice(T.reedwader, [420, 110], 0.9, 0.4, { attack: 0.02, hold: 0.4 }),
      crunch({ type: 'lowpass', freq: 2500 }, 300, 0.4, 0.3, { delay: 0.3 }),
    ],
    // Long toes wading: a little water, the reeds.
    step: [bubbles(40, [2, 6], 0.5, 0.06), impact(PAD, 0.01, 0.3, { pitch: 2 })],
  },
} as const satisfies Readonly<
  Record<
    string,
    | Readonly<Record<CreatureSound, readonly SfxLayer[]>>
    | Partial<Record<CreatureSound, readonly SfxLayer[]>>
  >
>;

export type VoicedCreature = keyof typeof VOICES;

const voiceKey = (id: string, sound: string) => `sfx:${id}_${sound}` as SfxKey;

/** The sound keys of a creature's voices and steps (`sfx:<id>_<sound>`), for its `sounds`. */
export function voicesOf(id: VoicedCreature): Partial<Record<CreatureSound, SfxKey>> {
  return Object.fromEntries(Object.keys(VOICES[id]).map((sound) => [sound, voiceKey(id, sound)]));
}

/** Synthesis recipes of every creature's voice and steps. */
export const creatureSfx: readonly SfxDef[] = Object.entries(VOICES).flatMap(([id, voices]) =>
  Object.entries(voices).map(([sound, layers]) => ({
    key: voiceKey(id, sound),
    level: sound === 'step' ? ('step' as const) : ('voice' as const),
    layers,
  })),
);
