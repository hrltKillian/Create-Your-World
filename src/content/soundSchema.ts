/**
 * Sound data (docs « Audio »): what each sound material, the player, the places and the clock
 * sound like, and the synthesis recipes. Re-exported by `schema.ts`.
 */
import type { BiomeKey, SfxKey, SoundMaterial, StationKey } from './schema.ts';

/** What a block of a sound material sounds like when broken, hit, placed and walked on. */
export interface BlockSounds {
  readonly break: SfxKey;
  readonly hit: SfxKey;
  readonly place: SfxKey;
  readonly step: SfxKey;
}

/** A pair of sounds for an opening and a closing. */
export interface OpenClose {
  readonly open: SfxKey;
  readonly close: SfxKey;
}

/** The ambient loop of a place by day (day and dawn) and by night (dusk and night). */
export interface DayNightLoops {
  readonly day: SfxKey;
  readonly night: SfxKey;
}

/**
 * Ambient loops (docs « Audio »: no music), crossfaded on the ambience bus: under water first,
 * then in a cave, else the biome's (a biome left out takes `fallback`). They name `loop` recipes.
 */
export interface AmbienceBindings {
  readonly biomes: Readonly<Partial<Record<BiomeKey, DayNightLoops>>>;
  readonly fallback: DayNightLoops;
  readonly cave: SfxKey;
  readonly underwater: SfxKey;
  /** Rain on the leaves and the ground (plan v3 « M34 »), over the place's loop while it rains. */
  readonly rain?: SfxKey;
}

/**
 * Sound effects the engine plays for gameplay actions (keyed by the block's sound material), for
 * the local player, the interface, places and the clock, and the ambient loops.
 */
export interface SoundBindings {
  readonly blocks: Readonly<Record<SoundMaterial, BlockSounds>>;
  readonly pickup: SfxKey;
  /** A liquid hardening where another touches it (lava meeting water). */
  readonly hardens?: SfxKey;
  /** Interface click (bag, slots). */
  readonly click: SfxKey;
  /** One craft of the queue is done (interface bus). */
  readonly craft: SfxKey;
  /** A player's blow landing on a creature, and a creature's blow landing on a player. */
  readonly combat: { readonly hit: SfxKey; readonly hurt: SfxKey };
  /** The local player's own sounds, at the ear. */
  readonly player: {
    readonly jump: SfxKey;
    readonly land: SfxKey;
    /** The body goes into water. */
    readonly splash: SfxKey;
    /** A stroke while swimming. */
    readonly swim: SfxKey;
    readonly eat: SfxKey;
    readonly drink: SfxKey;
    /** Beats while health is under the balance's `health.lowAt`. */
    readonly heartbeat: SfxKey;
    readonly death: SfxKey;
  };
  /** A door or gate toggled (any block with the `open` state). */
  readonly door: OpenClose;
  /** A chest (a `container` block entity) opened and closed. */
  readonly chest: OpenClose;
  /** Crackles of a lit station block near the listener, by station (fire, kilns). */
  readonly lit: Readonly<Partial<Record<StationKey, SfxKey>>>;
  /** Stingers: the sun sets (18:30), a night is survived (06:00). */
  readonly clock: { readonly dusk: SfxKey; readonly dawn: SfxKey };
  /** A lightning strike's thunder, heard after the light (plan v3 « M34 »). */
  readonly thunder?: SfxKey;
  readonly ambience: AmbienceBindings;
}

/**
 * Noise, a tone, resonant modes struck at the start (`modal`: impacts on stone, wood, metal,
 * glass) or a stream of short grains (`grains`: crunch, rustle, patter); plan v4 « M44 ».
 */
export type SfxSource = 'noise' | 'sine' | 'triangle' | 'square' | 'sawtooth' | 'modal' | 'grains';

/**
 * One layer of a synthesized sound: white noise or a tone, through an optional filter, shaped by
 * a linear attack and an exponential decay.
 */
export interface SfxLayer {
  readonly source: SfxSource;
  /** Tones only: frequency (Hz) at the start and at the end (exponential glide). */
  readonly freq?: readonly [number, number];
  /** Tones only (plan v4 « M45 »): the pitch wavers `depth` semitones, `rate` times a second. */
  readonly vibrato?: { readonly rate: number; readonly depth: number };
  /** `modal` only: the struck modes, each its frequency (Hz), ring time to −60 dB (s) and gain. */
  readonly modes?: readonly (readonly [number, number, number])[];
  /**
   * `grains` only: `rate` grains a second on average, each `seconds` long (min, max); with `tone`
   * (min, max Hz) a falling pitch, else noise.
   */
  readonly grains?: {
    readonly rate: number;
    readonly seconds: readonly [number, number];
    readonly tone?: readonly [number, number];
  };
  readonly filter?: {
    readonly type: 'lowpass' | 'highpass' | 'bandpass';
    readonly freq: number;
    readonly q?: number;
  };
  /** Peak gain, 0–1. */
  readonly gain: number;
  /** Seconds before the layer starts. */
  readonly delay?: number;
  /** Seconds to the peak (> 0). */
  readonly attack: number;
  /** Seconds held at the peak before the decay (an ambience's steady bed). */
  readonly hold?: number;
  /** Seconds from the peak to silence. */
  readonly decay: number;
}

/**
 * A synthesized sound effect: its layers are mixed together. One-shots are pre-rendered once at
 * startup; a `loop` (an ambience, longer) is rendered on first use and played looped.
 */
export interface SfxDef {
  readonly key: SfxKey;
  readonly layers: readonly SfxLayer[];
  readonly loop?: boolean;
}
