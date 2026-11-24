import type { BlockSounds, SfxDef, SfxSource, SoundMaterial } from '../../schema.ts';
import { type Filter, noise, tone } from './sfxParts.ts';
import { sounds } from './sounds.ts';

/** How a material sounds: the colour of its noise, an optional resonance and its crunch. */
interface MaterialVoice {
  readonly filter: Filter;
  /** Resonance (wood knock, glass ring, metal clang): waveform, pitch (Hz) and ring time (s). */
  readonly body?: { readonly source: SfxSource; readonly freq: number; readonly ring: number };
  /** Short noise grains after the break (gravel crunch, leaf rustle). */
  readonly grains: number;
  /** Decay of the break noise (s). */
  readonly length: number;
}

const VOICES: Readonly<Record<SoundMaterial, MaterialVoice>> = {
  stone: {
    filter: { type: 'bandpass', freq: 1600, q: 0.9 },
    body: { source: 'sine', freq: 190, ring: 0.08 },
    grains: 2,
    length: 0.2,
  },
  soil: { filter: { type: 'lowpass', freq: 650, q: 0.7 }, grains: 1, length: 0.22 },
  sand: { filter: { type: 'bandpass', freq: 3200, q: 0.5 }, grains: 3, length: 0.25 },
  gravel: { filter: { type: 'bandpass', freq: 1300, q: 1.1 }, grains: 4, length: 0.12 },
  wood: {
    filter: { type: 'bandpass', freq: 900, q: 1.4 },
    body: { source: 'triangle', freq: 300, ring: 0.12 },
    grains: 1,
    length: 0.14,
  },
  leaves: { filter: { type: 'highpass', freq: 2400, q: 0.7 }, grains: 3, length: 0.16 },
  glass: {
    filter: { type: 'highpass', freq: 3800, q: 0.7 },
    body: { source: 'sine', freq: 2600, ring: 0.35 },
    grains: 3,
    length: 0.12,
  },
  water: {
    filter: { type: 'lowpass', freq: 1100, q: 1 },
    body: { source: 'sine', freq: 420, ring: 0.12 },
    grains: 2,
    length: 0.2,
  },
  metal: {
    filter: { type: 'bandpass', freq: 2600, q: 3 },
    body: { source: 'triangle', freq: 880, ring: 0.5 },
    grains: 0,
    length: 0.1,
  },
  cloth: { filter: { type: 'lowpass', freq: 450, q: 0.6 }, grains: 0, length: 0.12 },
};

/** Gap between two crunch grains (s). */
const GRAIN_GAP = 0.045;

/**
 * Break (long, with crunch), hit (short, brighter), place (a low thud) and step (a soft scuff,
 * one grain of crunch for the crunchy ones) of one material.
 */
function materialSfx(keys: BlockSounds, voice: MaterialVoice): SfxDef[] {
  const { filter, body } = voice;
  const broken = [noise(filter, 0.55, voice.length)];
  for (let g = 1; g <= voice.grains; g++)
    broken.push(noise(filter, 0.3, 0.05, g * GRAIN_GAP, 1 + g * 0.1));
  const hit = [noise(filter, 0.35, 0.05, 0, 1.25)];
  const place = [noise(filter, 0.4, 0.08, 0, 0.8), tone('sine', 150, 90, 0.35, 0.07)];
  const step = [noise(filter, 0.22, 0.06, 0, 0.9), tone('sine', 120, 80, 0.12, 0.05)];
  if (voice.grains > 1) step.push(noise(filter, 0.12, 0.03, GRAIN_GAP * 0.6, 1.15));
  if (body) {
    broken.push(tone(body.source, body.freq, body.freq * 0.85, 0.3, body.ring));
    hit.push(tone(body.source, body.freq * 1.1, body.freq, 0.22, body.ring * 0.4));
    place.push(tone(body.source, body.freq * 0.9, body.freq * 0.8, 0.25, body.ring * 0.6));
    step.push(tone(body.source, body.freq * 0.8, body.freq * 0.7, 0.08, body.ring * 0.3));
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
