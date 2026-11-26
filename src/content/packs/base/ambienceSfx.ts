import type { SfxDef, SfxKey, SfxLayer } from '../../schema.ts';
import { air, bubbles, burst, crackle, crunch, impact, voice } from './sfxParts.ts';

/*
 * The ambiences (plan v5 « M54 », decision 32): long beds of the place's air, leaves, water or
 * stone, and the sounds dropped into them at random around the ear: gusts, rustles, a twig
 * snapping, a branch creaking, water lapping, mud bubbling, drips, a pebble falling. Only the
 * world's own sounds: nothing that calls, sings or chirps, so that no ambience is ever taken for
 * a creature.
 */

/** Seconds of a bed: long enough that its loop is not heard under its events. */
const BED = 20;

/** A bed: its layers held BED seconds, faded in and out over half a second. */
const bed = (key: SfxKey, layers: readonly SfxLayer[]): SfxDef => ({
  key,
  loop: true,
  level: 'bed',
  layers: layers.map((layer) => ({ ...layer, attack: 0.5, hold: BED, decay: 0.5, delay: 0 })),
});

const event = (key: SfxKey, layers: readonly SfxLayer[]): SfxDef => ({
  key,
  level: 'event',
  layers,
});

const LEAVES = { type: 'highpass', freq: 2600, q: 0.7 } as const;
const GRASS = { type: 'highpass', freq: 3800, q: 0.6 } as const;
const SAND = { type: 'bandpass', freq: 3400, q: 0.5 } as const;

/** The keys of the beds and events, shared with the bindings (sounds.ts). */
export const AMBIENCE = {
  meadowDay: 'sfx:bed_meadow_day',
  meadowNight: 'sfx:bed_meadow_night',
  forestDay: 'sfx:bed_forest_day',
  forestNight: 'sfx:bed_forest_night',
  lake: 'sfx:bed_lake',
  marsh: 'sfx:bed_marsh',
  cold: 'sfx:bed_cold',
  desertDay: 'sfx:bed_desert_day',
  desertNight: 'sfx:bed_desert_night',
  cave: 'sfx:bed_cave',
  underwater: 'sfx:bed_underwater',
  rainOpen: 'sfx:bed_rain_open',
  rainWater: 'sfx:bed_rain_water',
  rainLeaves: 'sfx:bed_rain_leaves',
  rainRoof: 'sfx:bed_rain_roof',
  grassGust: 'sfx:amb_grass_gust',
  leafGust: 'sfx:amb_leaf_gust',
  twig: 'sfx:amb_twig',
  creak: 'sfx:amb_branch_creak',
  lap: 'sfx:amb_water_lap',
  mud: 'sfx:amb_mud',
  snowGust: 'sfx:amb_snow_gust',
  sandGust: 'sfx:amb_sand_gust',
  drip: 'sfx:amb_drip',
  pebbles: 'sfx:amb_pebbles',
  rise: 'sfx:amb_bubbles_rise',
  bigDrop: 'sfx:amb_rain_drop',
  gutter: 'sfx:amb_gutter',
} as const satisfies Record<string, SfxKey>;

const A = AMBIENCE;

/** A branch creaking in the wind: wood straining, a slow stick-slip. */
const CREAK = {
  tract: 1.6,
  formants: [
    [300, 120, 1],
    [820, 160, 0.5],
    [1900, 240, 0.2],
  ],
  breath: 0.1,
  jitter: 0.35,
  shimmer: 0.5,
  rough: 0.4,
} as const;

/**
 * A drop falling into water: its plip, the one bubble it traps ringing at its Minnaert pitch and
 * rising as it closes, over the tap of the impact.
 */
const drop = (radius: number, gain: number): SfxLayer[] => {
  const pitch = 3260 / radius;
  return [
    { source: 'sine', freq: [pitch, pitch * 1.5], gain, attack: 0.001, decay: 0.05 },
    impact([[pitch * 0.7, 0.01, 0.3]], 0.0008, gain * 0.3),
  ];
};

export const ambienceSfx: readonly SfxDef[] = [
  // Grass under a light breeze; by night the air drops.
  bed(A.meadowDay, [air(0.12, 0.55, [250, 1400], 0.8, BED), crunch(GRASS, 30, 0.15, BED)]),
  bed(A.meadowNight, [air(0.08, 0.35, [140, 650], 0.8, BED)]),
  // Leaves stirring overhead, the trunks' low air.
  bed(A.forestDay, [
    air(0.18, 0.6, [900, 3600], 0.7, BED),
    air(0.1, 0.4, [120, 500], 0.5, BED),
    crunch(LEAVES, 60, 0.15, BED),
  ]),
  bed(A.forestNight, [
    air(0.12, 0.45, [700, 2600], 0.6, BED),
    air(0.07, 0.3, [100, 400], 0.5, BED),
  ]),
  // Open water lapping at the bank under the wind.
  bed(A.lake, [
    air(0.1, 0.4, [200, 1100], 0.6, BED),
    bubbles(3, [6, 14], 0.5, BED),
    burst('brown', { type: 'lowpass', freq: 380 }, 0.4, 1),
  ]),
  // The Sporefen: still, damp air, mud breathing out thick bubbles.
  bed(A.marsh, [
    air(0.05, 0.3, [120, 500], 0.6, BED),
    bubbles(1.5, [12, 20], 0.6, BED, {}, { type: 'lowpass', freq: 500 }),
  ]),
  // Cold heights: a hard wind with gusts whistling, snow hissing.
  bed(A.cold, [
    air(0.25, 0.8, [320, 2600], 0.9, BED),
    burst('pink', { type: 'highpass', freq: 5000 }, 0.15, 1),
  ]),
  // The desert: dry wind, sand hissing along the ground; by night the wind falls.
  bed(A.desertDay, [air(0.15, 0.55, [220, 1300], 0.8, BED), crunch(SAND, 160, 0.2, BED)]),
  bed(A.desertNight, [air(0.08, 0.35, [150, 700], 0.7, BED)]),
  // A cave: the stone's deep hush.
  bed(A.cave, [
    burst('brown', { type: 'lowpass', freq: 140 }, 0.7, 1),
    air(0.04, 0.3, [80, 260], 0.4, BED),
  ]),
  // Under water: pressure in the ears, bubbles rising.
  bed(A.underwater, [
    burst('brown', { type: 'lowpass', freq: 280 }, 0.8, 1),
    bubbles(5, [1, 4], 0.4, BED, {}, { type: 'lowpass', freq: 1800 }),
  ]),
  // Rain: on open ground and grass, drumming on leaves, tapping on a roof.
  bed(A.rainOpen, [
    burst('pink', { type: 'highpass', freq: 1600 }, 0.6, 1),
    crunch({ type: 'bandpass', freq: 3200, q: 0.6 }, 350, 0.5, BED),
  ]),
  // Rain on open water: every drop a tiny bubble plinking, the surface hissing.
  bed(A.rainWater, [
    bubbles(500, [0.7, 2.2], 0.6, BED),
    burst('pink', { type: 'highpass', freq: 3000 }, 0.4, 1),
  ]),
  bed(A.rainLeaves, [
    crunch({ type: 'highpass', freq: 2200, q: 0.6 }, 700, 0.7, BED),
    burst('pink', { type: 'highpass', freq: 2500 }, 0.4, 1),
  ]),
  bed(A.rainRoof, [
    crackle(260, [700, 2600], 0.7, BED, {}, { type: 'lowpass', freq: 3000 }),
    burst('pink', { type: 'lowpass', freq: 900 }, 0.3, 1),
  ]),
  // Events.
  event(A.grassGust, [
    air(0.6, 0.7, [400, 2400], 0.8, 2.5, { attack: 0.8 }),
    crunch(GRASS, 120, 0.3, 2, { attack: 0.6 }),
  ]),
  event(A.leafGust, [
    air(0.6, 0.8, [1200, 4200], 0.8, 2.5, { attack: 0.7 }),
    crunch(LEAVES, 400, 0.4, 2, { attack: 0.6 }),
  ]),
  event(A.twig, [
    impact(
      [
        [2300, 0.01, 0.5],
        [3700, 0.008, 0.3],
      ],
      0.0005,
      0.7,
    ),
    crunch(LEAVES, 200, 0.3, 0.05),
  ]),
  event(A.creak, [
    voice(CREAK, [45, 60], 0.7, 0.3, { attack: 0.2, hold: 0.6 }, { type: 'lowpass', freq: 1800 }),
  ]),
  event(A.lap, [
    burst('pink', { type: 'lowpass', freq: 700 }, 0.6, 0.35, { attack: 0.12 }),
    bubbles(25, [4, 10], 0.5, 0.3, { delay: 0.05 }),
  ]),
  event(A.mud, [bubbles(4, [13, 19], 0.8, 0.5, {}, { type: 'lowpass', freq: 400 })]),
  event(A.snowGust, [
    air(0.8, 0.8, [500, 3200], 0.9, 2.5, { attack: 0.6 }),
    burst('pink', { type: 'highpass', freq: 4500 }, 0.4, 1.5, { attack: 0.5 }),
  ]),
  event(A.sandGust, [
    air(0.7, 0.7, [300, 1800], 0.8, 2.5, { attack: 0.6 }),
    crunch(SAND, 500, 0.5, 2, { attack: 0.5 }),
  ]),
  event(A.drip, drop(2.5, 0.8)),
  event(A.pebbles, [
    impact(
      [
        [1100, 0.02, 0.5],
        [2600, 0.015, 0.3],
      ],
      0.0007,
      0.6,
    ),
    impact(
      [
        [1300, 0.02, 0.5],
        [3000, 0.015, 0.3],
      ],
      0.0007,
      0.4,
      { delay: 0.14 },
    ),
    impact(
      [
        [1500, 0.02, 0.5],
        [3300, 0.015, 0.3],
      ],
      0.0007,
      0.25,
      { delay: 0.25 },
    ),
  ]),
  event(A.rise, [bubbles(30, [2, 6], 0.7, 0.5, { attack: 0.05 }, { type: 'lowpass', freq: 2200 })]),
  event(A.bigDrop, drop(4, 0.7)),
  event(A.gutter, [...drop(3, 0.6), ...drop(3.5, 0.5).map((layer) => ({ ...layer, delay: 0.3 }))]),
];
