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

/**
 * The ambience of a place (plan v5 « M53 »): a long bed, looped, and sounds dropped into it at
 * random times around the listener (gusts, rustles, lapping, far thunder), so that it never
 * sounds like a loop. The bed names a `loop` recipe, the events one-shots.
 */
export interface AmbienceDef {
  readonly bed: SfxKey;
  readonly events?: readonly AmbientEvent[];
}

/** A sound of an ambience, every `every` seconds (min, max), `distance` blocks (min, max) away. */
export interface AmbientEvent {
  readonly sound: SfxKey;
  readonly every: readonly [number, number];
  readonly distance: readonly [number, number];
}

/** The ambience of a place by day (day and dawn) and by night (dusk and night). */
export interface DayNightAmbience {
  readonly day: AmbienceDef;
  readonly night: AmbienceDef;
}

/**
 * Ambiences (docs « Audio »: no music), crossfaded on the ambience bus: under water first, then
 * in a cave, else the biome's (a biome left out takes `fallback`).
 */
export interface AmbienceBindings {
  readonly biomes: Readonly<Partial<Record<BiomeKey, DayNightAmbience>>>;
  readonly fallback: DayNightAmbience;
  readonly cave: AmbienceDef;
  readonly underwater: AmbienceDef;
  /** Rain over the place's while it rains (plan v3 « M34 »), by what is over the ear. */
  readonly rain?: RainAmbience;
}

/**
 * The rain as it sounds in the open, on water just under the ear, under a canopy, under a roof
 * (plan v5 « M54 »).
 */
export interface RainAmbience {
  readonly open: AmbienceDef;
  readonly water: AmbienceDef;
  readonly leaves: AmbienceDef;
  readonly roof: AmbienceDef;
}

/**
 * The interface's sounds (plan v5 « M54 »): a button pressed, a tab or a picker chosen, a stack
 * taken onto the cursor, put into a slot or thrown beside the panel, a craft done, and each kind
 * of screen opening and closing (the Bag and the slot screens, the map, a journal, the menus).
 */
export interface UiSounds {
  readonly button: SfxKey;
  readonly tab: SfxKey;
  readonly take: SfxKey;
  readonly put: SfxKey;
  readonly throw: SfxKey;
  readonly craft: SfxKey;
  readonly bag: OpenClose;
  readonly map: OpenClose;
  readonly book: OpenClose;
  readonly menu: OpenClose;
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
  /** The interface's sounds (plan v5 « M54 »). */
  readonly ui: UiSounds;
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
    /** A swing of the arm or the held tool (plan v5 « M54 »). */
    readonly swing: SfxKey;
  };
  /** A door or gate toggled (any block with the `open` state). */
  readonly door: OpenClose;
  /** A chest (a `container` block entity) opened and closed. */
  readonly chest: OpenClose;
  /** Crackles of a lit station block near the listener, by station (fire, kilns). */
  readonly lit: Readonly<Partial<Record<StationKey, SfxKey>>>;
  /** The fire block burning, and lava bubbling, near the listener (plan v5 « M54 »). */
  readonly burning?: SfxKey;
  readonly lava?: SfxKey;
  /** Stingers: the sun sets (18:30), a night is survived (06:00). */
  readonly clock: { readonly dusk: SfxKey; readonly dawn: SfxKey };
  /**
   * A lightning strike's thunder, heard after the light (plan v3 « M34 »): its crack close by, its
   * rumble far off (plan v5 « M54 »).
   */
  readonly thunder?: { readonly near: SfxKey; readonly far: SfxKey };
  readonly ambience: AmbienceBindings;
}

/**
 * The sources of a layer (plan v4 « M44 », plan v5 « M53 »): white, pink or brown noise; a tone;
 * resonant modes struck at once (`modal`); a stream of short grains (`grains`); and the models of
 * real sounds: a body struck through a contact of some hardness (`impact`), bubbles ringing at
 * their Minnaert pitch (`bubbles`), the pops of a fire (`crackle`), turbulent air (`wind`) and a
 * voice, glottal pulses through a vocal tract (`voice`).
 */
export type SfxSource =
  | 'noise'
  | 'pink'
  | 'brown'
  | 'sine'
  | 'triangle'
  | 'square'
  | 'sawtooth'
  | 'modal'
  | 'grains'
  | 'impact'
  | 'bubbles'
  | 'crackle'
  | 'wind'
  | 'voice';

/** A formant of a vocal tract: frequency (Hz, for an adult human's tract), bandwidth (Hz), gain. */
export type Formant = readonly [number, number, number];

/**
 * One layer of a synthesized sound: a source, through an optional filter, shaped by a linear
 * attack, a hold and an exponential decay.
 */
export interface SfxLayer {
  readonly source: SfxSource;
  /** Tones only: frequency (Hz) at the start and at the end (exponential glide). */
  readonly freq?: readonly [number, number];
  /** Tones only (plan v4 « M45 »): the pitch wavers `depth` semitones, `rate` times a second. */
  readonly vibrato?: { readonly rate: number; readonly depth: number };
  /**
   * `modal` and `impact`: the body's modes, each its frequency (Hz), ring time to −60 dB (s) and
   * gain.
   */
  readonly modes?: readonly (readonly [number, number, number])[];
  /**
   * `impact` only: how long the contact lasts (s): short for a hard blow (every mode rings, a
   * bright click), long for a soft one (the high modes stay quiet, a dull thud).
   */
  readonly contact?: number;
  /**
   * `grains` only: `rate` grains a second on average, each `seconds` long (min, max); with `tone`
   * (min, max Hz) a falling pitch, else noise.
   */
  readonly grains?: {
    readonly rate: number;
    readonly seconds: readonly [number, number];
    readonly tone?: readonly [number, number];
  };
  /** `bubbles` only: `rate` bubbles a second, their radii (mm, min and max). */
  readonly bubbles?: { readonly rate: number; readonly radius: readonly [number, number] };
  /** `crackle` only: `rate` pops a second, each ringing at a pitch in `freq` (Hz, min and max). */
  readonly crackle?: { readonly rate: number; readonly freq: readonly [number, number] };
  /**
   * `wind` only: `gusts` a second on average, rising the level by `depth` (0–1), the air's band
   * wandering within `band` (Hz, min and max) as they blow.
   */
  readonly wind?: {
    readonly gusts: number;
    readonly depth: number;
    readonly band: readonly [number, number];
  };
  /**
   * `voice` only: the pitch (Hz) at the start and the end; `tract` the vocal tract's length to an
   * adult human's (2: twice as long, every formant an octave lower); `formants` of the vowel;
   * `breath` the share of breath noise; `jitter` and `shimmer` the shares of a period's pitch and
   * level drawn at random each period; `rough` the share every other pulse loses (a growl).
   */
  readonly voice?: {
    readonly pitch: readonly [number, number];
    readonly tract: number;
    readonly formants: readonly Formant[];
    readonly breath: number;
    readonly jitter: number;
    readonly shimmer: number;
    readonly rough?: number;
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
 * The loudness each class of sounds is rendered at (plan v5 « M53 »): the highest short-term RMS
 * (50 ms) of a sound, in dB of full scale. The interface and the steps under the blows, voices
 * and the weather over them, the ambience's beds and events quietest.
 */
export const SFX_LEVELS = {
  ui: -24,
  step: -27,
  impact: -21,
  player: -21,
  voice: -19,
  weather: -17,
  event: -27,
  bed: -33,
} as const;
export type SfxLevel = keyof typeof SFX_LEVELS;

/** Fewest variants a one-shot is rendered in (plan v5 « M53 »: never the same sound twice). */
export const MIN_VARIANTS = 4;

/**
 * A synthesized sound effect: its layers are mixed together and rendered at the loudness of its
 * `level` class. One-shots are rendered in `variants` takes (MIN_VARIANTS by default), the first
 * at startup, the others in spare time; a `loop` (an ambience's bed, longer) is rendered on first
 * use and played looped.
 */
export interface SfxDef {
  readonly key: SfxKey;
  readonly layers: readonly SfxLayer[];
  readonly loop?: boolean;
  readonly level?: SfxLevel;
  readonly variants?: number;
}
