import type { AmbienceBindings, BiomeKey } from '../content/schema.ts';

/** Ambience rules (docs « Audio »). */
export const AMBIENCE = {
  /** A new loop fades in and the old one out over this time (s). */
  fadeSeconds: 3,
} as const;

/** Where the listener is, as the ambience reads it (filled by the client every frame). */
export interface AmbiencePlace {
  /** The biome under the listener (undefined outside the loaded world). */
  biome: string | undefined;
  /** Dusk or night: the night loops. */
  night: boolean;
  cave: boolean;
  underwater: boolean;
}

/** The loop for a place: under water, else in a cave, else the biome's by day or by night. */
export function ambienceKey(bindings: AmbienceBindings, place: Readonly<AmbiencePlace>): string {
  if (place.underwater) return bindings.underwater;
  if (place.cave) return bindings.cave;
  const loops = (place.biome && bindings.biomes[place.biome as BiomeKey]) || bindings.fallback;
  return place.night ? loops.night : loops.day;
}

/** The part of the engine the ambience drives (a fake in tests). */
export interface LoopPlayer {
  /** Sets a loop's gain (0 stops it). */
  setLoop(key: string, gain: number): void;
}

/**
 * The ambience bus: the loop of the place sounds at full gain; when the place changes, the new
 * loop rises while every other one falls, linearly over AMBIENCE.fadeSeconds (a change back
 * half-way turns both around from where they are, without a jump).
 */
export class Ambience {
  private readonly player: LoopPlayer;
  private readonly layers: { readonly key: string; gain: number }[] = [];
  private current: string | null = null;

  constructor(player: LoopPlayer) {
    this.player = player;
  }

  /** One frame of `seconds`: `key` is the loop the place wants (null: silence). */
  update(key: string | null, seconds: number): void {
    if (key !== this.current) {
      this.current = key;
      if (key !== null && !this.layers.some((layer) => layer.key === key))
        this.layers.push({ key, gain: 0 });
    }
    const step = seconds / AMBIENCE.fadeSeconds;
    // Backwards: a silent layer leaves the list in place.
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i]!;
      const rising = layer.key === this.current;
      layer.gain = rising ? Math.min(1, layer.gain + step) : Math.max(0, layer.gain - step);
      this.player.setLoop(layer.key, layer.gain);
      if (!rising && layer.gain === 0) this.layers.splice(i, 1);
    }
  }

  /** Silence at once (the world closes). */
  stop(): void {
    for (const layer of this.layers) this.player.setLoop(layer.key, 0);
    this.layers.length = 0;
    this.current = null;
  }
}
