import type { BlockSounds, SfxDef, SoundMaterial } from '../../schema.ts';
import { crunch, type Filter, type Modes, noise, struck, tone } from './sfxParts.ts';
import { sounds } from './sounds.ts';

/**
 * How a material sounds (plan v4 « M44 »): the colour of its noise, the modes its body rings with
 * when struck (stone knock, wood thock, glass ring, metal clang) and the crunch of its grains.
 */
interface MaterialVoice {
  readonly filter: Filter;
  readonly modes?: Modes;
  /** Crunch grains a second when it breaks (gravel, sand, leaves, snow); 0 for none. */
  readonly crunch: number;
  /** Decay of the break noise (s). */
  readonly length: number;
}

const VOICES: Readonly<Record<SoundMaterial, MaterialVoice>> = {
  stone: {
    filter: { type: 'bandpass', freq: 1600, q: 0.9 },
    modes: [
      [190, 0.08, 0.6],
      [527, 0.05, 0.3],
      [1213, 0.03, 0.2],
    ],
    crunch: 60,
    length: 0.2,
  },
  soil: { filter: { type: 'lowpass', freq: 650, q: 0.7 }, crunch: 40, length: 0.22 },
  sand: { filter: { type: 'bandpass', freq: 3200, q: 0.5 }, crunch: 220, length: 0.25 },
  gravel: { filter: { type: 'bandpass', freq: 1300, q: 1.1 }, crunch: 160, length: 0.14 },
  wood: {
    filter: { type: 'bandpass', freq: 900, q: 1.4 },
    modes: [
      [300, 0.12, 0.6],
      [687, 0.08, 0.25],
      [1452, 0.05, 0.12],
    ],
    crunch: 0,
    length: 0.14,
  },
  leaves: { filter: { type: 'highpass', freq: 2400, q: 0.7 }, crunch: 180, length: 0.16 },
  glass: {
    filter: { type: 'highpass', freq: 3800, q: 0.7 },
    modes: [
      [2600, 0.35, 0.5],
      [4157, 0.25, 0.3],
      [6880, 0.18, 0.15],
    ],
    crunch: 90,
    length: 0.12,
  },
  water: {
    filter: { type: 'lowpass', freq: 1100, q: 1 },
    modes: [
      [420, 0.12, 0.6],
      [1090, 0.06, 0.2],
    ],
    crunch: 0,
    length: 0.2,
  },
  metal: {
    filter: { type: 'bandpass', freq: 2600, q: 3 },
    modes: [
      [880, 0.5, 0.5],
      [2413, 0.42, 0.3],
      [3971, 0.3, 0.2],
      [5260, 0.22, 0.1],
    ],
    crunch: 0,
    length: 0.1,
  },
  cloth: { filter: { type: 'lowpass', freq: 450, q: 0.6 }, crunch: 0, length: 0.12 },
};

/**
 * Break (long, with crunch), hit (short, brighter), place (a low thud) and step (a soft scuff,
 * a little crunch for the crunchy ones) of one material; its modes ring through all four.
 */
function materialSfx(keys: BlockSounds, voice: MaterialVoice): SfxDef[] {
  const { filter, modes } = voice;
  const broken = [noise(filter, 0.55, voice.length)];
  const hit = [noise(filter, 0.35, 0.05, 0, 1.25)];
  const place = [noise(filter, 0.4, 0.08, 0, 0.8), tone('sine', 150, 90, 0.35, 0.07)];
  const step = [noise(filter, 0.22, 0.06, 0, 0.9), tone('sine', 120, 80, 0.12, 0.05)];
  if (voice.crunch > 0) {
    broken.push(crunch(filter, voice.crunch, 0.4, voice.length * 0.6, 0.02));
    step.push(crunch(filter, voice.crunch * 1.5, 0.18, 0.05));
  }
  if (modes) {
    broken.push(struck(modes, 0.32));
    hit.push(struck(modes, 0.24, 0.4, 1.1));
    place.push(struck(modes, 0.26, 0.6, 0.9));
    step.push(struck(modes, 0.08, 0.3, 0.8));
  }
  return [
    { key: keys.break, layers: broken },
    { key: keys.hit, layers: hit },
    { key: keys.place, layers: place },
    { key: keys.step, layers: step },
  ];
}

/**
 * Synthesis recipes (never sampled) of the blocks' sounds, the pickup, the click and the blows of
 * combat; the other one-shots are in playerSfx.ts, the loops in ambienceSfx.ts.
 */
export const sfx: readonly SfxDef[] = [
  ...(Object.keys(VOICES) as SoundMaterial[]).flatMap((m) =>
    materialSfx(sounds.blocks[m], VOICES[m]),
  ),
  {
    // A rising two-note pop.
    key: sounds.pickup,
    layers: [
      { source: 'sine', freq: [620, 930], gain: 0.4, attack: 0.004, decay: 0.11 },
      {
        source: 'triangle',
        freq: [1240, 1400],
        gain: 0.15,
        attack: 0.003,
        decay: 0.08,
        delay: 0.035,
      },
    ],
  },
  {
    key: sounds.click,
    layers: [
      { source: 'triangle', freq: [1500, 1100], gain: 0.25, attack: 0.001, decay: 0.035 },
      noise({ type: 'highpass', freq: 4000 }, 0.12, 0.012),
    ],
  },
  {
    // A dull thump with a short slap on top: a blow landing on a hide.
    key: sounds.combat.hit,
    layers: [
      tone('sine', 140, 70, 0.5, 0.12),
      noise({ type: 'bandpass', freq: 1400, q: 1.2 }, 0.4, 0.05),
      noise({ type: 'lowpass', freq: 500 }, 0.3, 0.09, 0.01),
    ],
  },
  {
    // A low knock and a gasp of breath: the player is struck.
    key: sounds.combat.hurt,
    layers: [
      tone('triangle', 220, 110, 0.4, 0.16),
      noise({ type: 'bandpass', freq: 900, q: 0.9 }, 0.3, 0.18, 0.02),
    ],
  },
];
