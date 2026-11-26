import type { BlockSounds, SfxDef, SfxLayer, SoundMaterial } from '../../schema.ts';
import {
  bubbles,
  burst,
  crackle,
  crunch,
  type Filter,
  footstep,
  impact,
  type Modes,
  type Surface,
  voice,
} from './sfxParts.ts';
import { sounds } from './sounds.ts';

/*
 * The blocks' sounds and the things of the world (plan v5 « M54 »), each modelled on its source:
 * a material struck through a contact as hard as it is (the modes its body rings with, the grains
 * that crunch or rustle off it), a foot's heel then toe on it, a door's hinge creaking and its
 * wood landing in the frame, a chest's lid, a stack into the pack, steam off cooling lava.
 */

/** How a material sounds: its body, how hard a blow lands on it, its grains and their colour. */
interface Material {
  readonly modes: Modes;
  /** A blow's contact on it (s): short on stone and glass, long on soil and cloth. */
  readonly contact: number;
  /** Grains a second that crunch or rustle off it when struck, and their colour. */
  readonly grains: number;
  readonly filter: Filter;
  /** What falls when it breaks: debris pops (rate, Hz) over its crumble (s). */
  readonly debris: readonly [number, number, number];
  readonly crumble: number;
}

const MATERIALS: Readonly<Record<SoundMaterial, Material>> = {
  // Dense rock: a hard, short knock, grit.
  stone: {
    modes: [
      [1180, 0.035, 0.6],
      [2310, 0.025, 0.4],
      [3720, 0.018, 0.25],
      [5100, 0.012, 0.15],
    ],
    contact: 0.0007,
    grains: 140,
    filter: { type: 'bandpass', freq: 2200, q: 0.8 },
    debris: [60, 900, 3200],
    crumble: 0.22,
  },
  // Packed earth: a dull thud, crumbs.
  soil: {
    modes: [
      [140, 0.05, 0.6],
      [310, 0.03, 0.3],
    ],
    contact: 0.006,
    grains: 120,
    filter: { type: 'lowpass', freq: 1100, q: 0.7 },
    debris: [25, 200, 700],
    crumble: 0.2,
  },
  // Loose sand: no body, a soft hiss of grains.
  sand: {
    modes: [],
    contact: 0.008,
    grains: 600,
    filter: { type: 'bandpass', freq: 3600, q: 0.6 },
    debris: [0, 0, 0],
    crumble: 0.3,
  },
  // Gravel: pebbles knocking together.
  gravel: {
    modes: [
      [900, 0.02, 0.4],
      [2100, 0.015, 0.3],
    ],
    contact: 0.002,
    grains: 320,
    filter: { type: 'bandpass', freq: 1500, q: 1 },
    debris: [90, 700, 2600],
    crumble: 0.25,
  },
  // Timber: a hollow thock, the board ringing a little.
  wood: {
    modes: [
      [240, 0.11, 0.6],
      [560, 0.08, 0.35],
      [1080, 0.05, 0.2],
      [1890, 0.03, 0.12],
    ],
    contact: 0.0015,
    grains: 40,
    filter: { type: 'bandpass', freq: 1900, q: 1.2 },
    debris: [40, 800, 2400],
    crumble: 0.12,
  },
  // Leaves: a dry rustle, a twig's tick.
  leaves: {
    modes: [[2600, 0.01, 0.3]],
    contact: 0.003,
    grains: 700,
    filter: { type: 'highpass', freq: 2800, q: 0.7 },
    debris: [50, 2000, 5000],
    crumble: 0.25,
  },
  // Glass: a hard, bright ping, shards tinkling.
  glass: {
    modes: [
      [2650, 0.28, 0.5],
      [4180, 0.2, 0.3],
      [6870, 0.14, 0.18],
    ],
    contact: 0.0003,
    grains: 0,
    filter: { type: 'highpass', freq: 3500, q: 0.7 },
    debris: [300, 3000, 9000],
    crumble: 0.35,
  },
  // Water: no body, its bubbles (see waterSounds).
  water: {
    modes: [],
    contact: 0.01,
    grains: 0,
    filter: { type: 'lowpass', freq: 1200, q: 0.7 },
    debris: [0, 0, 0],
    crumble: 0.2,
  },
  // Metal plate: a clang that rings.
  metal: {
    modes: [
      [520, 0.9, 0.5],
      [1340, 0.7, 0.35],
      [2470, 0.5, 0.25],
      [3950, 0.35, 0.15],
    ],
    contact: 0.0005,
    grains: 0,
    filter: { type: 'bandpass', freq: 3000, q: 2 },
    debris: [30, 1500, 4000],
    crumble: 0.1,
  },
  // Cloth and hide: a muffled pat, fibres brushing.
  cloth: {
    modes: [[180, 0.03, 0.5]],
    contact: 0.012,
    grains: 260,
    filter: { type: 'lowpass', freq: 1800, q: 0.7 },
    debris: [0, 0, 0],
    crumble: 0.15,
  },
};

/** A material's break, hit, place and step. */
function materialSfx(keys: BlockSounds, m: Material): SfxDef[] {
  const body = (gain: number, contact = m.contact, delay = 0): SfxLayer[] =>
    m.modes.length > 0 ? [impact(m.modes, contact, gain, { delay })] : [];
  const grit = (gain: number, seconds: number, delay = 0): SfxLayer[] =>
    m.grains > 0 ? [crunch(m.filter, m.grains, gain, seconds, { delay })] : [];
  const [rate, lo, hi] = m.debris;
  const debris =
    rate > 0 ? [crackle(rate, [lo, hi], 0.5, m.crumble, { delay: 0.02 }, m.filter)] : [];
  const surface: Surface = {
    modes: m.modes,
    contact: m.contact * 2.5,
    grains: m.grains,
    filter: m.filter,
  };
  return [
    {
      key: keys.break,
      level: 'impact',
      layers: [
        ...body(0.8),
        ...grit(0.7, m.crumble),
        ...debris,
        ...body(0.3, m.contact * 2, m.crumble * 0.7),
      ],
    },
    { key: keys.hit, level: 'impact', layers: [...body(0.8), ...grit(0.5, 0.04)] },
    {
      key: keys.place,
      level: 'impact',
      layers: [
        ...body(0.8, m.contact * 3),
        ...grit(0.4, 0.06),
        burst('pink', { type: 'lowpass', freq: 400 }, 0.3, 0.06),
      ],
    },
    { key: keys.step, level: 'step', layers: footstep(surface, 0.8) },
  ];
}

/** Water's own: a splash of bubbles for every action, a wade for a step. */
function waterSfx(keys: BlockSounds): SfxDef[] {
  const splash = (gain: number, seconds: number): SfxLayer[] => [
    bubbles(90, [1, 6], gain, seconds),
    burst('noise', { type: 'bandpass', freq: 1800, q: 0.6 }, gain * 0.5, seconds),
  ];
  return [
    { key: keys.break, level: 'impact', layers: splash(0.8, 0.3) },
    { key: keys.hit, level: 'impact', layers: splash(0.6, 0.12) },
    {
      key: keys.place,
      level: 'impact',
      layers: [...splash(0.8, 0.2), bubbles(20, [5, 12], 0.6, 0.25)],
    },
    {
      key: keys.step,
      level: 'step',
      layers: [
        bubbles(60, [2, 8], 0.8, 0.12),
        burst('pink', { type: 'lowpass', freq: 900 }, 0.5, 0.15, { attack: 0.02 }),
      ],
    },
  ];
}

/** A short « uh »: the vowel of a grunt. */
const VOWEL_UH = [
  [520, 90, 1],
  [1190, 110, 0.4],
  [2390, 160, 0.2],
] as const;

/** A hinge's creak: wood rubbing on iron, a stick-slip as rough as a voice. */
const HINGE = {
  tract: 1,
  formants: [
    [420, 140, 1],
    [1050, 180, 0.5],
    [2300, 260, 0.2],
  ],
  breath: 0.15,
  jitter: 0.3,
  shimmer: 0.45,
  rough: 0.3,
} as const;
/** A small iron latch. */
const LATCH: Modes = [
  [2900, 0.03, 0.5],
  [4700, 0.02, 0.3],
];
/** A plank door's or a chest lid's body landing. */
const PLANK: Modes = [
  [120, 0.12, 0.6],
  [290, 0.08, 0.35],
  [610, 0.05, 0.2],
];

/**
 * The blocks' sounds (never sampled), a stack picked up, steam off lava meeting water, a blow on
 * a creature and on the player, doors and chests. The player's own are in playerSfx.ts, the
 * interface's in uiSfx.ts, the creatures' in creatureSfx.ts, the ambiences in ambienceSfx.ts.
 */
export const sfx: readonly SfxDef[] = [
  ...(Object.keys(MATERIALS) as SoundMaterial[]).flatMap((m) =>
    m === 'water' ? waterSfx(sounds.blocks[m]) : materialSfx(sounds.blocks[m], MATERIALS[m]),
  ),
  {
    // A stack drawn into the pack: a soft knock and the canvas rustling.
    key: sounds.pickup,
    level: 'player',
    layers: [
      impact(
        [
          [420, 0.03, 0.5],
          [980, 0.02, 0.3],
        ],
        0.003,
        0.6,
      ),
      crunch({ type: 'lowpass', freq: 2600 }, 260, 0.5, 0.07, { delay: 0.01 }),
    ],
  },
  {
    // Lava meeting water: a burst of steam hissing off, the crust cracking as it cools.
    key: sounds.hardens!,
    level: 'impact',
    layers: [
      burst('pink', { type: 'highpass', freq: 2400 }, 0.8, 0.9, { attack: 0.03, hold: 0.3 }),
      crackle(70, [1500, 6000], 0.5, 0.6, { delay: 0.05 }),
      bubbles(40, [2, 6], 0.4, 0.4),
    ],
  },
  {
    // A blow landing on a hide: the body's dull thump, the slap of the skin.
    key: sounds.combat.hit,
    level: 'impact',
    layers: [
      impact(
        [
          [110, 0.06, 0.6],
          [260, 0.04, 0.35],
        ],
        0.005,
        0.9,
      ),
      burst('noise', { type: 'bandpass', freq: 1500, q: 0.9 }, 0.6, 0.04),
    ],
  },
  {
    // The player struck: the thud on the body, a grunt pushed out.
    key: sounds.combat.hurt,
    level: 'player',
    layers: [
      impact([[95, 0.05, 0.6]], 0.006, 0.6),
      voice(
        {
          tract: 1,
          formants: [...VOWEL_UH],
          breath: 0.35,
          jitter: 0.04,
          shimmer: 0.2,
          rough: 0.25,
        },
        [190, 120],
        0.8,
        0.16,
        { attack: 0.01, hold: 0.05 },
      ),
    ],
  },
  {
    // The door swings open on its hinge: the latch lifts, the hinge creaks.
    key: sounds.door.open,
    level: 'impact',
    layers: [
      impact(LATCH, 0.0006, 0.5),
      voice(HINGE, [70, 105], 0.7, 0.18, { delay: 0.04, attack: 0.05, hold: 0.25 }),
    ],
  },
  {
    // The door swings shut: a short creak, the planks land in the frame, the latch drops.
    key: sounds.door.close,
    level: 'impact',
    layers: [
      voice(HINGE, [100, 80], 0.5, 0.08, { attack: 0.03, hold: 0.1 }),
      impact(PLANK, 0.004, 0.9, { delay: 0.17 }),
      impact(LATCH, 0.0006, 0.4, { delay: 0.2 }),
    ],
  },
  {
    // The lid lifts: the hasp clicks, a short creak.
    key: sounds.chest.open,
    level: 'impact',
    layers: [
      impact(LATCH, 0.0006, 0.5),
      voice(HINGE, [90, 130], 0.6, 0.1, { delay: 0.03, attack: 0.04, hold: 0.15 }),
    ],
  },
  {
    // The lid drops: the wooden thump of the box, the hasp.
    key: sounds.chest.close,
    level: 'impact',
    layers: [
      impact(PLANK, 0.004, 0.9, { pitch: 1.3 }),
      impact(LATCH, 0.0006, 0.35, { delay: 0.03 }),
    ],
  },
];
