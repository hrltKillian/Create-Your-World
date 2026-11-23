import type { SimEvent } from '../sim/events.ts';

/** The part of the engine the cues use (a fake in tests). */
export interface CuePlayer {
  play(key: string, x: number, y: number, z: number, pitch?: number): boolean;
}

/** Pickups closer together than this (ms) form a series whose pitch rises. */
const SERIES_MS = 600;
/** One semitone up per pickup of a series, at most an octave. */
const SEMITONE = 2 ** (1 / 12);
const SERIES_MAX = 12;

/**
 * Event-to-audio bridge. The simulation already turns breaking, hitting, placing and picking up
 * into `sound` events at world positions (blockBroken, blockPlaced and itemPickedUp come with
 * one), so the bridge plays those; it only adds the rising pitch of a series of pickups.
 */
export class AudioCues {
  private readonly player: CuePlayer;
  private readonly pickupKey: string | undefined;
  private readonly now: () => number;
  private lastPickup = Number.NEGATIVE_INFINITY;
  private series = 0;

  constructor(player: CuePlayer, pickupKey: string | undefined, now?: () => number) {
    this.player = player;
    this.pickupKey = pickupKey;
    this.now = now ?? (() => performance.now());
  }

  onEvent(event: SimEvent): void {
    if (event.type !== 'sound') return;
    const pitch = event.sfx === this.pickupKey ? this.pickupPitch() : 1;
    this.player.play(event.sfx, event.x, event.y, event.z, pitch);
  }

  private pickupPitch(): number {
    const now = this.now();
    this.series = now - this.lastPickup < SERIES_MS ? Math.min(SERIES_MAX, this.series + 1) : 0;
    this.lastPickup = now;
    return SEMITONE ** this.series;
  }
}
