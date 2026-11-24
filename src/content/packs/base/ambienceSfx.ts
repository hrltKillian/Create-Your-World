import { hashUnit } from '../../../core/hash.ts';
import type { SfxDef, SfxLayer } from '../../schema.ts';
import { type Filter, noise, tone } from './sfxParts.ts';
import { LOOPS } from './sounds.ts';

/** Length of every ambience loop (s). */
const LOOP = 6;
/** Fade in and out of a bed at the rendering's ends (s), blended away by the loop's wrap. */
const EDGE = 0.005;

/** A steady layer of filtered noise across the whole loop. */
const bed = (filter: Filter, gain: number): SfxLayer => ({
  ...noise(filter, gain, EDGE),
  attack: EDGE,
  hold: LOOP - 2 * EDGE,
});

/**
 * `count` moments spread over the loop, each jittered within its share (the same every time:
 * hashed from `seed`), leaving `tail` seconds before the loop's end so nothing rings past it.
 */
function moments(count: number, seed: number, tail: number): number[] {
  const share = (LOOP - tail) / count;
  return Array.from({ length: count }, (_, i) => (i + 0.1 + 0.8 * hashUnit(seed, i)) * share);
}

/** A swell (bee, gust, hiss): `rise` s up then `fall` s down, starting at `delay`. */
const swell = (layer: SfxLayer, rise: number, fall: number, delay: number): SfxLayer => ({
  ...layer,
  attack: rise,
  decay: fall,
  delay,
});

/** Day: a leafy hiss, bees passing and bird chirps. */
const insectsDay: SfxLayer[] = [
  bed({ type: 'highpass', freq: 3500 }, 0.02),
  ...moments(2, 1, 1.8).map((t) =>
    swell(
      { ...tone('sawtooth', 190, 210, 0.03, 0), filter: { type: 'lowpass', freq: 900 } },
      0.8,
      0.9,
      t,
    ),
  ),
  ...moments(4, 2, 0.3).flatMap((t) => [
    tone('sine', 2600, 3400, 0.05, 0.06, t),
    tone('sine', 2800, 3600, 0.04, 0.05, t + 0.09),
  ]),
];

/** Night: crickets, three pulses a chirp, over a low murmur. */
const insectsNight: SfxLayer[] = [
  bed({ type: 'lowpass', freq: 300 }, 0.02),
  ...moments(10, 3, 0.2).flatMap((t) =>
    [0, 0.05, 0.1].map((p) => ({ ...tone('sine', 4400, 4380, 0.04, 0.02, t + p), attack: 0.003 })),
  ),
];

/** The marsh: croaks and a whining buzz over still water. */
const marsh: SfxLayer[] = [
  bed({ type: 'lowpass', freq: 400 }, 0.03),
  ...moments(5, 4, 0.4).flatMap((t) =>
    [0, 0.14].map((p) => ({
      ...tone('sawtooth', 130, 110, 0.12, 0.12, t + p),
      filter: { type: 'lowpass' as const, freq: 600 },
      attack: 0.01,
    })),
  ),
  ...moments(2, 5, 2.2).map((t) => swell(tone('sine', 620, 640, 0.015, 0), 1, 1, t)),
];

/** Open heights: a wind bed and gusts. */
const wind: SfxLayer[] = [
  bed({ type: 'bandpass', freq: 500, q: 0.5 }, 0.1),
  ...moments(3, 6, 2.3).map((t) =>
    swell(noise({ type: 'bandpass', freq: 800, q: 0.8 }, 0.12, 0), 1, 1.2, t),
  ),
];

/** The desert by day: a dry wind and hissing sand. */
const sand: SfxLayer[] = [
  bed({ type: 'bandpass', freq: 450, q: 0.5 }, 0.07),
  ...moments(3, 7, 1.9).map((t) =>
    swell(noise({ type: 'highpass', freq: 5000 }, 0.05, 0), 0.8, 1, t),
  ),
];

/** Caves: a deep rumble and drips, each with its echo. */
const cave: SfxLayer[] = [
  bed({ type: 'lowpass', freq: 120 }, 0.06),
  ...moments(6, 8, 0.3).flatMap((t) => [
    tone('sine', 1200, 2100, 0.15, 0.05, t),
    tone('sine', 1200, 2100, 0.05, 0.05, t + 0.13),
  ]),
];

/** Under water: a muffled wash and bubbles rising. */
const bubbles: SfxLayer[] = [
  bed({ type: 'lowpass', freq: 400 }, 0.12),
  ...moments(12, 9, 0.1).map((t) => tone('sine', 300, 1100, 0.08, 0.03, t)),
];

/** The ambience loops (docs « Audio »: insects, wind, sand, bubbles, cave drips; no music). */
export const ambienceSfx: readonly SfxDef[] = [
  { key: LOOPS.insectsDay, loop: true, layers: insectsDay },
  { key: LOOPS.insectsNight, loop: true, layers: insectsNight },
  { key: LOOPS.marsh, loop: true, layers: marsh },
  { key: LOOPS.wind, loop: true, layers: wind },
  { key: LOOPS.sand, loop: true, layers: sand },
  { key: LOOPS.cave, loop: true, layers: cave },
  { key: LOOPS.bubbles, loop: true, layers: bubbles },
];
