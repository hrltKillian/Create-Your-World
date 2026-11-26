import { hashUnit } from '../core/hash.ts';

/**
 * The room a sound is heard in (plan v4 « M44 »): its reverberation, generated (no recorded
 * impulse response). Pure: an impulse response is the same for a place and a rate everywhere.
 */

export const REVERB_PLACES = ['open', 'forest', 'indoor', 'cave'] as const;
export type ReverbPlace = (typeof REVERB_PLACES)[number];

export interface ReverbDef {
  /** Time for the tail to fall 60 dB (s). */
  readonly seconds: number;
  /** Share of each sound sent into the room. */
  readonly wet: number;
  /** How much darker the tail grows (air and walls drink the highs), 0–1. */
  readonly darkness: number;
  /** Early reflections in the first EARLY_SECONDS: walls, trunks. */
  readonly early: number;
}

export const REVERBS: Readonly<Record<ReverbPlace, ReverbDef>> = {
  open: { seconds: 0.45, wet: 0.06, darkness: 0.3, early: 2 },
  forest: { seconds: 1, wet: 0.14, darkness: 0.5, early: 9 },
  indoor: { seconds: 0.7, wet: 0.22, darkness: 0.4, early: 12 },
  cave: { seconds: 2.6, wet: 0.42, darkness: 0.65, early: 16 },
};

const EARLY_SECONDS = 0.08;
const RING = Math.log(1000);

/**
 * The stereo impulse response of a place at `rate`: decaying noise, decorrelated between the ears,
 * darker as it fades, with its early reflections; scaled to unit energy.
 */
export function impulseResponse(
  place: ReverbPlace,
  rate: number,
): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const def = REVERBS[place];
  const length = Math.max(1, Math.round(def.seconds * rate));
  const channels: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [
    new Float32Array(length),
    new Float32Array(length),
  ];
  const seed = REVERB_PLACES.indexOf(place) * 1009 + 17;
  channels.forEach((out, ear) => {
    const fall = Math.exp(-RING / length);
    let amp = 1;
    let low = 0;
    for (let i = 0; i < length; i++) {
      const smooth = 1 - def.darkness * (i / length);
      low += smooth * (hashUnit(seed, ear, i) * 2 - 1 - low);
      out[i] = low * amp;
      amp *= fall;
    }
    for (let k = 0; k < def.early; k++) {
      const at = Math.floor(hashUnit(seed, ear, -1 - k) * EARLY_SECONDS * rate);
      if (at < length) out[at] = out[at]! + (0.8 - (0.5 * k) / def.early) * (k % 2 ? 1 : -1);
    }
    let energy = 0;
    for (let i = 0; i < length; i++) energy += out[i]! * out[i]!;
    const scale = 1 / Math.sqrt(Math.max(energy, 1e-9));
    for (let i = 0; i < length; i++) out[i] = out[i]! * scale;
  });
  return channels;
}

/** Speed of sound (blocks a second). */
const SOUND_SPEED = 343;
/** The pitch shift never goes past this, either way. */
const MOST_SHIFT = 0.08;

/**
 * The Doppler factor of a sound from a source moving at (vx, vy, vz) (blocks a second), the ear at
 * (dx, dy, dz) from it: above 1 coming closer, below going away.
 */
export function doppler(
  vx: number,
  vy: number,
  vz: number,
  dx: number,
  dy: number,
  dz: number,
): number {
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return 1;
  // Kept well under the speed of sound: the factor stays finite.
  const towards = Math.max(
    -SOUND_SPEED / 2,
    Math.min(SOUND_SPEED / 2, (vx * dx + vy * dy + vz * dz) / d),
  );
  const factor = SOUND_SPEED / (SOUND_SPEED - towards);
  return Math.min(1 + MOST_SHIFT, Math.max(1 - MOST_SHIFT, factor));
}
