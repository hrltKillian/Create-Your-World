import type { CuePlayer } from './cues.ts';

/** Seconds between two crackles of a lit station (a random time in between). */
export const CRACKLE = { minSeconds: 0.35, maxSeconds: 0.8 } as const;

/**
 * Lit stations near the listener (docs « Audio »: feu, four): the nearest one crackles now and
 * then at its cell, its sound fading with distance like any other.
 */
export class Crackles {
  private readonly player: Pick<CuePlayer, 'play'>;
  private readonly random: () => number;
  private wait = 0;

  constructor(player: Pick<CuePlayer, 'play'>, random: () => number = Math.random) {
    this.player = player;
    this.random = random;
  }

  /** One frame of `seconds`: `key` is the sound of the nearest lit station at (x, y, z), or null. */
  update(seconds: number, key: string | null, x: number, y: number, z: number): void {
    this.wait -= seconds;
    if (key === null || this.wait > 0) return;
    this.player.play(key, x, y, z);
    const { minSeconds, maxSeconds } = CRACKLE;
    this.wait = minSeconds + (maxSeconds - minSeconds) * this.random();
  }
}
