import type { SfxDef, SfxLayer } from '../../schema.ts';
import { crunch, type Filter, noise, tone } from './sfxParts.ts';
import { sounds } from './sounds.ts';

const LOW: Filter = { type: 'lowpass', freq: 500 };
const WOOD: Filter = { type: 'bandpass', freq: 900, q: 1.4 };
const WATER: Filter = { type: 'lowpass', freq: 1800, q: 0.8 };

/** A soft note with a slow fade (stingers, chimes): `attack` s in, `decay` s out. */
const note = (freq: number, gain: number, delay: number, decay: number): SfxLayer => ({
  source: 'sine',
  freq: [freq, freq * 0.995],
  gain,
  attack: 0.04,
  decay,
  delay,
});

/** Short pops of noise at the given delays (crackles, crunches). */
const pops = (filter: Filter, gain: number, delays: readonly number[]): SfxLayer[] =>
  delays.map((delay, i) => noise(filter, gain * (1 - i * 0.08), 0.02, delay, 1 + (i % 3) * 0.15));

/** A creaking hinge: a slow sawtooth glide through a lowpass. */
const creak = (from: number, to: number, gain: number, decay: number): SfxLayer => ({
  source: 'sawtooth',
  freq: [from, to],
  filter: { type: 'lowpass', freq: 900, q: 2 },
  gain,
  attack: 0.04,
  decay,
});

const { player, door, chest, clock } = sounds;

/** The local player's own sounds, the craft chime, doors, chests, lit stations and the stingers. */
export const playerSfx: readonly SfxDef[] = [
  // A short breath and the swish of clothes.
  {
    key: player.jump,
    layers: [
      noise({ type: 'bandpass', freq: 1200, q: 1 }, 0.2, 0.08),
      tone('triangle', 180, 260, 0.1, 0.07),
    ],
  },
  // Feet hitting the ground: a low thump.
  {
    key: player.land,
    layers: [tone('sine', 110, 55, 0.45, 0.12), noise({ type: 'lowpass', freq: 400 }, 0.3, 0.08)],
  },
  // Lava meeting water: a long steam hiss over a few crackles.
  {
    key: sounds.hardens!,
    layers: [
      noise({ type: 'highpass', freq: 2600, q: 0.7 }, 0.35, 0.9),
      ...pops({ type: 'bandpass', freq: 1400, q: 1.2 }, 0.18, [0.05, 0.13, 0.22, 0.34]),
    ],
  },
  // Into the water: a wash of noise, then a bubble.
  {
    key: player.splash,
    layers: [
      noise(WATER, 0.5, 0.35),
      ...pops({ type: 'bandpass', freq: 3000, q: 1 }, 0.2, [0.04, 0.09, 0.15]),
      tone('sine', 500, 900, 0.15, 0.08, 0.05),
    ],
  },
  // A stroke: a slow whoosh of water.
  {
    key: player.swim,
    layers: [
      { ...noise({ type: 'bandpass', freq: 900, q: 0.8 }, 0.25, 0.25), attack: 0.06 },
      tone('sine', 380, 620, 0.08, 0.06, 0.12),
    ],
  },
  // Three bites with a chew under them, crunching grain by grain (plan v4 « M45 »).
  {
    key: player.eat,
    layers: [
      ...pops({ type: 'bandpass', freq: 2200, q: 1.5 }, 0.3, [0, 0.09, 0.18]),
      noise(LOW, 0.2, 0.25),
      crunch({ type: 'bandpass', freq: 1800, q: 1 }, 70, 0.25, 0.22),
    ],
  },
  // Two gulps, each with its bubble.
  {
    key: player.drink,
    layers: [
      tone('sine', 300, 520, 0.25, 0.09),
      tone('sine', 280, 500, 0.22, 0.09, 0.16),
      {
        source: 'grains',
        grains: { rate: 14, seconds: [0.01, 0.025], tone: [350, 700] },
        gain: 0.18,
        attack: 0.005,
        hold: 0.26,
        decay: 0.03,
      },
    ],
  },
  // Lub-dub.
  {
    key: player.heartbeat,
    layers: [tone('sine', 60, 45, 0.6, 0.12), tone('sine', 55, 42, 0.45, 0.1, 0.16)],
  },
  // A falling groan and a thud.
  {
    key: player.death,
    layers: [
      { ...tone('triangle', 300, 90, 0.4, 0.8), filter: { type: 'lowpass', freq: 1200 } },
      noise({ type: 'lowpass', freq: 600 }, 0.3, 0.6, 0.1),
      tone('sine', 80, 40, 0.35, 1, 0.5),
    ],
  },
  // A rising two-note chime and a light tick: an item made.
  {
    key: sounds.craft,
    layers: [
      note(660, 0.22, 0, 0.25),
      note(990, 0.2, 0.08, 0.35),
      noise({ type: 'highpass', freq: 5000 }, 0.1, 0.015),
    ],
  },
  { key: door.open, layers: [creak(180, 260, 0.12, 0.3), noise(WOOD, 0.2, 0.06, 0.25)] },
  {
    key: door.close,
    layers: [
      noise(WOOD, 0.4, 0.08),
      tone('triangle', 260, 200, 0.25, 0.1),
      tone('sine', 110, 70, 0.3, 0.1),
    ],
  },
  // A lower creak, then the latch.
  {
    key: chest.open,
    layers: [creak(140, 200, 0.1, 0.25), noise({ type: 'highpass', freq: 3000 }, 0.15, 0.02, 0.22)],
  },
  {
    key: chest.close,
    layers: [
      noise(WOOD, 0.35, 0.07, 0, 0.8),
      tone('sine', 120, 80, 0.3, 0.08),
      noise({ type: 'highpass', freq: 3000 }, 0.15, 0.02, 0.06),
    ],
  },
  // A campfire: pops and crackles over a soft roar.
  {
    key: sounds.lit['station:campfire']!,
    layers: [
      { ...noise({ type: 'lowpass', freq: 700 }, 0.12, 0.3), attack: 0.08 },
      ...pops({ type: 'highpass', freq: 2500 }, 0.25, [0, 0.07, 0.19, 0.31]),
      crunch({ type: 'highpass', freq: 3000 }, 40, 0.2, 0.3),
    ],
  },
  // A kiln: a deeper roar, fewer pops.
  {
    key: sounds.lit['station:kiln']!,
    layers: [
      { ...noise({ type: 'lowpass', freq: 350 }, 0.25, 0.4), attack: 0.1 },
      ...pops({ type: 'bandpass', freq: 1500, q: 1 }, 0.15, [0.05, 0.27]),
    ],
  },
  // Thunder (plan v3 « M34 », v4 « M45 »): a tearing crack, then a low rumble rolling away in
  // waves, each a little later and lower.
  {
    key: sounds.thunder!,
    layers: [
      noise({ type: 'highpass', freq: 1800 }, 0.35, 0.12),
      crunch({ type: 'bandpass', freq: 900, q: 0.7 }, 120, 0.3, 0.2),
      { ...noise({ type: 'lowpass', freq: 140 }, 0.6, 1.6, 0.05), attack: 0.25 },
      { ...noise({ type: 'lowpass', freq: 320 }, 0.25, 1, 0.4), attack: 0.3 },
      { ...noise({ type: 'lowpass', freq: 110 }, 0.35, 0.75, 0.8), attack: 0.35 },
    ],
  },
  // Dusk: three notes falling away. Dawn: the same notes rising.
  {
    key: clock.dusk,
    layers: [note(523, 0.16, 0, 1), note(392, 0.15, 0.35, 1), note(262, 0.15, 0.7, 1.1)],
  },
  {
    key: clock.dawn,
    layers: [note(262, 0.15, 0, 1), note(392, 0.15, 0.35, 1), note(523, 0.16, 0.7, 1.1)],
  },
];
