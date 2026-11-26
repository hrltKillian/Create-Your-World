import type { AmbienceBindings, AmbienceDef, BiomeKey } from '../content/schema.ts';

/** Ambience rules (docs « Audio »). */
export const AMBIENCE = {
  /** A new bed fades in and the old one out over this time (s). */
  fadeSeconds: 3,
  /** Events drop out while their bed is fainter than this. */
  eventsFrom: 0.3,
} as const;

/** Where the listener is, as the ambience reads it (filled by the client every frame). */
export interface AmbiencePlace {
  /** The biome under the listener (undefined outside the loaded world). */
  biome: string | undefined;
  /** Dusk or night: the night ambiences. */
  night: boolean;
  cave: boolean;
  underwater: boolean;
}

/** The ambience of a place: under water, else in a cave, else the biome's by day or by night. */
export function ambienceOf(
  bindings: AmbienceBindings,
  place: Readonly<AmbiencePlace>,
): AmbienceDef {
  if (place.underwater) return bindings.underwater;
  if (place.cave) return bindings.cave;
  const both = (place.biome && bindings.biomes[place.biome as BiomeKey]) || bindings.fallback;
  return place.night ? both.night : both.day;
}

/** The part of the engine the ambience drives (a fake in tests). */
export interface LoopPlayer {
  /** Sets a bed's gain (0 stops it). */
  setLoop(key: string, gain: number): void;
  /** Plays an event at a world position, on the ambience bus. */
  playAmbient(key: string, x: number, y: number, z: number): void;
}

/**
 * An ambience bus (plan v5 « M53 »): the bed of the place sounds at `level`; when the place
 * changes, the new bed rises while every other one falls, linearly over AMBIENCE.fadeSeconds (a
 * change back half-way turns both around from where they are, without a jump). Its events drop in
 * at random times, each in a random direction around the ear, so that the bed's loop is never
 * heard as one.
 */
export class Ambience {
  private readonly player: LoopPlayer;
  private readonly random: () => number;
  private readonly layers: { readonly key: string; gain: number }[] = [];
  private current: AmbienceDef | null = null;
  /** Seconds before each event of the current ambience. */
  private waits: number[] = [];

  /** `random`: a source in [0, 1) (Math.random; a fixed one in tests). */
  constructor(player: LoopPlayer, random: () => number = Math.random) {
    this.player = player;
    this.random = random;
  }

  /**
   * One frame of `seconds`: `def` is the ambience the place wants (null: silence), at `level`
   * (0–1: the rain's strength), heard by an ear at (x, y, z).
   */
  update(
    def: AmbienceDef | null,
    seconds: number,
    x: number,
    y: number,
    z: number,
    level = 1,
  ): void {
    if (def !== this.current) {
      this.current = def;
      if (def && !this.layers.some((layer) => layer.key === def.bed))
        this.layers.push({ key: def.bed, gain: 0 });
      this.waits = (def?.events ?? []).map((event) => this.between(event.every));
    }
    const step = seconds / AMBIENCE.fadeSeconds;
    const bed = def?.bed;
    let heard = 0;
    // Backwards: a silent layer leaves the list in place.
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i]!;
      const target = layer.key === bed ? level : 0;
      layer.gain =
        layer.gain < target
          ? Math.min(target, layer.gain + step)
          : Math.max(target, layer.gain - step);
      this.player.setLoop(layer.key, layer.gain);
      if (layer.key === bed) heard = layer.gain;
      else if (layer.gain === 0) this.layers.splice(i, 1);
    }
    const events = def?.events;
    if (!events || heard < AMBIENCE.eventsFrom) return;
    for (let e = 0; e < events.length; e++) {
      this.waits[e] = this.waits[e]! - seconds;
      if (this.waits[e]! > 0) continue;
      const event = events[e]!;
      this.waits[e] = this.between(event.every);
      const angle = this.random() * Math.PI * 2;
      const distance = this.between(event.distance);
      const rise = (this.random() - 0.3) * 4;
      this.player.playAmbient(
        event.sound,
        x + Math.cos(angle) * distance,
        y + rise,
        z + Math.sin(angle) * distance,
      );
    }
  }

  /** Silence at once (the world closes). */
  stop(): void {
    for (const layer of this.layers) this.player.setLoop(layer.key, 0);
    this.layers.length = 0;
    this.current = null;
    this.waits = [];
  }

  /** A number drawn between the pair's two ends. */
  private between([min, max]: readonly [number, number]): number {
    return min + (max - min) * this.random();
  }
}
