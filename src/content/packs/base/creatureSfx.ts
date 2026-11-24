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
 * Creature voices (docs « Audio »: five per creature, synthesized): soft bleats for the Trotter,
 * low bellows for the Shagback, rasps and screeches for the Prowler, chitters and buzzing for the
 * Swarmling, shell clacks and rumbles for the Shellback. The Trotter never attacks.
 */
const VOICES = {
  trotter: {
    idle: [
      tone('triangle', [520, 610], 0.22, [0.02, 0.16]),
      tone('triangle', [610, 470], 0.18, [0.02, 0.18], 0.14),
    ],
    alert: [
      hiss('bandpass', 1800, 0.4, [0.005, 0.12], 0, 2),
      tone('square', [700, 900], 0.1, [0.005, 0.08], 0, 2400),
    ],
    hurt: [tone('sawtooth', [900, 480], 0.3, [0.005, 0.22], 0, 2600)],
    death: [
      tone('triangle', [720, 210], 0.3, [0.01, 0.6]),
      hiss('lowpass', 600, 0.25, [0.005, 0.25], 0.45),
    ],
  },
  shagback: {
    idle: [tone('sawtooth', [92, 80], 0.3, [0.06, 0.5], 0, 420)],
    alert: [
      tone('sawtooth', [140, 185], 0.4, [0.04, 0.45], 0, 700),
      tone('square', [70, 92], 0.18, [0.04, 0.45], 0, 300),
    ],
    hurt: [
      tone('sawtooth', [210, 120], 0.4, [0.01, 0.25], 0, 900),
      hiss('lowpass', 500, 0.25, [0.005, 0.15]),
    ],
    attack: [
      hiss('bandpass', 420, 0.5, [0.01, 0.3], 0, 1),
      tone('sawtooth', [110, 160], 0.3, [0.02, 0.35], 0, 600),
    ],
    death: [tone('sawtooth', [150, 55], 0.4, [0.05, 1.2], 0, 500)],
  },
  prowler: {
    idle: [hiss('bandpass', 900, 0.2, [0.1, 0.4], 0, 4), tone('sine', [56, 50], 0.22, [0.1, 0.5])],
    alert: [
      hiss('highpass', 3000, 0.35, [0.02, 0.35]),
      tone('square', [300, 620], 0.12, [0.01, 0.25], 0, 1500),
    ],
    hurt: [
      tone('sawtooth', [320, 180], 0.4, [0.005, 0.2], 0, 1400),
      hiss('bandpass', 1200, 0.3, [0.005, 0.15], 0, 2),
    ],
    attack: [
      tone('sawtooth', [500, 920], 0.4, [0.01, 0.25], 0, 1800),
      hiss('highpass', 2500, 0.3, [0.005, 0.2]),
    ],
    death: [tone('sawtooth', [600, 120], 0.35, [0.02, 0.9], 0, 1200)],
  },
  swarmling: {
    idle: [
      hiss('highpass', 4000, 0.2, [0.002, 0.02]),
      hiss('highpass', 4400, 0.18, [0.002, 0.02], 0.06),
      hiss('highpass', 3800, 0.16, [0.002, 0.02], 0.12),
    ],
    alert: [tone('square', [220, 265], 0.18, [0.01, 0.3], 0, 1800)],
    hurt: [tone('triangle', [2200, 1400], 0.25, [0.003, 0.1])],
    attack: [
      hiss('bandpass', 3000, 0.35, [0.002, 0.05], 0, 2),
      hiss('highpass', 5000, 0.2, [0.005, 0.15], 0.05),
    ],
    death: [
      tone('sine', [900, 200], 0.3, [0.003, 0.15]),
      hiss('highpass', 3000, 0.2, [0.01, 0.4], 0.05),
    ],
  },
  shellback: {
    idle: [hiss('lowpass', 300, 0.35, [0.06, 0.4]), tone('sine', [70, 60], 0.2, [0.06, 0.4])],
    alert: [
      hiss('bandpass', 1100, 0.45, [0.002, 0.06], 0, 3),
      hiss('bandpass', 1000, 0.4, [0.002, 0.06], 0.12, 3),
      tone('triangle', [180, 160], 0.15, [0.005, 0.1]),
    ],
    hurt: [
      tone('triangle', [240, 200], 0.35, [0.003, 0.18]),
      hiss('bandpass', 900, 0.3, [0.002, 0.08], 0, 4),
    ],
    attack: [
      tone('sawtooth', [80, 120], 0.45, [0.05, 0.7], 0, 500),
      hiss('lowpass', 400, 0.35, [0.05, 0.6]),
    ],
    death: [
      hiss('lowpass', 250, 0.5, [0.01, 0.8]),
      tone('sawtooth', [120, 40], 0.3, [0.02, 1], 0, 400),
    ],
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
