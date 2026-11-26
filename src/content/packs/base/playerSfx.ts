import type { SfxDef, SfxLayer } from '../../schema.ts';
import {
  air,
  bubbles,
  burst,
  crackle,
  crunch,
  impact,
  type Modes,
  type Throat,
  VOWELS,
  voice,
} from './sfxParts.ts';
import { sounds } from './sounds.ts';

/*
 * The player's own sounds, fires, lava, thunder and the colony's bell (plan v5 « M54 »), each
 * modelled on its source: a body's push and landing, water swallowing it, bites and gulps, a heart,
 * a last breath, a swing through the air; a fire's pops over its roar, lava's thick bubbles; the
 * thunder's crack and its rumble rolling down the bolt; a bell rung far off at dusk and dawn.
 */

const { player, clock } = sounds;

/** The survivor's breath and voice: an adult's tract, breathy. */
const BREATH: Throat = { tract: 1, formants: VOWELS.a, breath: 0.7, jitter: 0.03, shimmer: 0.15 };
const GROAN: Throat = {
  tract: 1,
  formants: VOWELS.o,
  breath: 0.45,
  jitter: 0.05,
  shimmer: 0.25,
  rough: 0.3,
};

/** The body landing on the ground: the heels, the knees taking it. */
const BODY: Modes = [
  [85, 0.07, 0.6],
  [190, 0.05, 0.35],
  [420, 0.03, 0.15],
];

/** A bronze bell of the colony: its partials (hum, prime, tierce, quint, nominal…) to its pitch. */
const BELL = [0.5, 1, 1.183, 1.506, 2, 2.514, 3.011] as const;
const bell = (pitch: number, gain: number, delay: number): SfxLayer =>
  impact(
    BELL.map(
      (ratio, i) =>
        [pitch * ratio, 3.2 / (1 + i * 0.35), [0.5, 1, 0.6, 0.35, 0.45, 0.2, 0.15][i]!] as const,
    ),
    0.0015,
    gain,
    { delay },
  );

/** A bite: the teeth crunching through, then the chew's dull knock. */
const bite = (delay: number): SfxLayer[] => [
  crunch({ type: 'bandpass', freq: 2400, q: 0.8 }, 420, 0.8, 0.06, { delay }),
  impact([[160, 0.03, 0.5]], 0.008, 0.4, { delay: delay + 0.05 }),
];

/** A gulp: the throat's thump and the bubble of air going down. */
const gulp = (delay: number): SfxLayer[] => [
  impact([[130, 0.04, 0.6]], 0.01, 0.6, { delay }),
  bubbles(40, [7, 11], 0.7, 0.05, { delay: delay + 0.02 }),
];

/** A heartbeat's « lub », then its quieter « dub ». */
const beat = (delay: number, gain: number): SfxLayer =>
  impact(
    [
      [48, 0.09, 0.7],
      [78, 0.06, 0.4],
    ],
    0.02,
    gain,
    { delay },
  );

/** A fire's sound: its pops over the roar of its flames. */
const fire = (pops: number, roar: number, seconds: number): SfxLayer[] => [
  crackle(pops, [1200, 7000], 0.7, seconds),
  air(1.5, 0.4, [120, 420], roar, seconds, { attack: 0.15 }),
];

/**
 * The thunder (plan v5 « M54 »): close by, the crack of the shock wave and the rumble of the
 * channel's every turn arriving later and lower; far off, the rumble alone, darker and slower.
 */
const thunder = (near: boolean): SfxLayer[] => [
  ...(near
    ? [
        burst('noise', { type: 'highpass', freq: 900 }, 0.9, 0.08),
        burst('pink', { type: 'lowpass', freq: 1400 }, 0.8, 0.5, { delay: 0.02 }),
      ]
    : []),
  crackle(
    near ? 34 : 18,
    [35, near ? 220 : 120],
    0.8,
    near ? 2.6 : 3.4,
    { delay: near ? 0.05 : 0.2, attack: near ? 0.05 : 0.6 },
    {
      type: 'lowpass',
      freq: near ? 700 : 260,
    },
  ),
  burst('brown', { type: 'lowpass', freq: near ? 320 : 160 }, 0.9, near ? 2 : 2.4, {
    delay: near ? 0.08 : 0.3,
    attack: near ? 0.25 : 0.9,
    hold: near ? 1.2 : 1.6,
  }),
];

/** The local player's own sounds, fires, lava, thunder and the clock's bell. */
export const playerSfx: readonly SfxDef[] = [
  {
    // The push off: a scuff of the soles, clothes swishing, a short breath.
    key: player.jump,
    level: 'player',
    layers: [
      burst('pink', { type: 'bandpass', freq: 700, q: 0.8 }, 0.5, 0.06),
      crunch({ type: 'lowpass', freq: 2400 }, 300, 0.4, 0.08, { delay: 0.01 }),
      voice(BREATH, [260, 220], 0.35, 0.1, { attack: 0.02 }),
    ],
  },
  {
    // The landing: both feet at once, the body's weight, clothes settling.
    key: player.land,
    level: 'player',
    layers: [
      impact(BODY, 0.01, 0.9),
      impact(BODY, 0.012, 0.5, { delay: 0.03, pitch: 1.2 }),
      crunch({ type: 'lowpass', freq: 2000 }, 260, 0.5, 0.1, { delay: 0.01 }),
    ],
  },
  {
    // Into the water: the surface breaking, a cloud of bubbles, the water closing over.
    key: player.splash,
    level: 'player',
    layers: [
      burst('noise', { type: 'bandpass', freq: 1400, q: 0.5 }, 0.8, 0.22),
      bubbles(180, [1, 7], 0.8, 0.35, { delay: 0.02 }),
      bubbles(25, [8, 16], 0.6, 0.4, { delay: 0.08 }),
    ],
  },
  {
    // A stroke: water pushed by the arms, a few bubbles.
    key: player.swim,
    level: 'player',
    layers: [
      burst('pink', { type: 'bandpass', freq: 650, q: 0.7 }, 0.7, 0.28, { attack: 0.09 }),
      bubbles(45, [2, 6], 0.5, 0.25, { delay: 0.05 }),
    ],
  },
  { key: player.eat, level: 'player', layers: [...bite(0), ...bite(0.2), ...bite(0.42)] },
  { key: player.drink, level: 'player', layers: [...gulp(0), ...gulp(0.34), ...gulp(0.7)] },
  {
    key: player.heartbeat,
    level: 'player',
    layers: [beat(0, 0.9), beat(0.19, 0.55)],
  },
  {
    // The last breath going out, then the body falling.
    key: player.death,
    level: 'player',
    layers: [
      voice(GROAN, [150, 70], 0.8, 0.6, { attack: 0.04, hold: 0.3 }),
      impact(BODY, 0.015, 0.9, { delay: 0.75 }),
      crunch({ type: 'lowpass', freq: 1500 }, 200, 0.5, 0.12, { delay: 0.76 }),
    ],
  },
  {
    // A swing: the arm and the tool cutting the air.
    key: player.swing,
    level: 'player',
    layers: [
      burst('noise', { type: 'bandpass', freq: 1100, q: 0.9 }, 0.7, 0.1, { attack: 0.06 }),
      burst('pink', { type: 'lowpass', freq: 600 }, 0.5, 0.12, { attack: 0.05 }),
    ],
  },
  { key: sounds.lit['station:campfire']!, level: 'event', layers: fire(26, 0.5, 1.5) },
  {
    // A kiln: a deep draught roaring through it, a few pops.
    key: sounds.lit['station:kiln']!,
    level: 'event',
    layers: [
      air(0.8, 0.3, [90, 300], 0.8, 1.5, { attack: 0.2 }),
      crackle(8, [800, 3000], 0.4, 1.5),
    ],
  },
  { key: sounds.burning!, level: 'event', layers: fire(45, 0.7, 1.5) },
  {
    // Lava: thick bubbles rising and bursting, now and then a spatter.
    key: sounds.lava!,
    level: 'event',
    layers: [
      bubbles(5, [11, 19], 0.8, 1.4, { attack: 0.05 }, { type: 'lowpass', freq: 600 }),
      crackle(4, [300, 1500], 0.4, 1.4),
      burst('brown', { type: 'lowpass', freq: 200 }, 0.3, 0.6, { attack: 0.3, hold: 0.6 }),
    ],
  },
  { key: sounds.thunder!.near, level: 'weather', layers: thunder(true) },
  { key: sounds.thunder!.far, level: 'weather', layers: thunder(false) },
  // The colony's bell, far off: twice low at dusk, three times higher at dawn.
  {
    key: clock.dusk,
    level: 'ui',
    layers: [
      bell(196, 0.8, 0),
      bell(196, 0.7, 1.4),
      burst('pink', { type: 'lowpass', freq: 300 }, 0.05, 0.1),
    ].map((layer) => ({ ...layer, filter: { type: 'lowpass' as const, freq: 2200 } })),
  },
  {
    key: clock.dawn,
    level: 'ui',
    layers: [bell(262, 0.8, 0), bell(262, 0.7, 0.9), bell(262, 0.6, 1.8)].map((layer) => ({
      ...layer,
      filter: { type: 'lowpass' as const, freq: 2600 },
    })),
  },
];
