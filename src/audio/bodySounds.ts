import type { CuePlayer } from './cues.ts';

/** Footsteps, strokes and the heartbeat (docs « Audio »: pas, eau, cœur). */
export const BODY_SOUNDS = {
  /** Metres walked on the ground per footstep (2.5 steps a second at walking speed). */
  stride: 1.7,
  /** Metres swum per stroke. */
  stroke: 2.2,
  /** Seconds between heartbeats just under the threshold, and near 0 health. */
  slowBeat: 1,
  fastBeat: 0.6,
  /** Metres a frame may move past the fastest speed before it counts as a teleport. */
  slack: 0.05,
} as const;

/** The local player once a frame, as the body sounds read it (the client fills one and reuses it). */
export interface BodyFrame {
  /** Feet position. */
  x: number;
  y: number;
  z: number;
  /** Simulated seconds since the last frame (0 while paused or between fixed steps). */
  seconds: number;
  onGround: boolean;
  inWater: boolean;
  /** Footstep of the surface under the feet (undefined: nothing to step on). */
  step: string | undefined;
  health: number;
  dead: boolean;
}

export interface BodyKeys {
  readonly swim: string;
  readonly splash: string;
  readonly heartbeat: string;
}

/**
 * The sounds of the local player's body: a footstep every stride on the ground, a splash on going
 * into water and a stroke every few metres in it, and the heartbeat while health is low. At most
 * one footstep or stroke a frame, so a long fixed-step walk or a teleport never sounds a burst.
 */
export class BodySounds {
  private readonly player: Pick<CuePlayer, 'playLocal'>;
  private readonly keys: BodyKeys;
  private readonly lowAt: number;
  private readonly maxSpeed: number;
  private x = Number.NaN;
  private y = Number.NaN;
  private z = Number.NaN;
  private walked = 0;
  private swum = 0;
  private wasInWater = false;
  /** Seconds to the next heartbeat. */
  private beat = 0;

  /** `lowAt`: health under which the heart beats; `maxSpeed`: the fastest walk or swim (m/s). */
  constructor(
    player: Pick<CuePlayer, 'playLocal'>,
    keys: BodyKeys,
    lowAt: number,
    maxSpeed: number,
  ) {
    this.player = player;
    this.keys = keys;
    this.lowAt = lowAt;
    this.maxSpeed = maxSpeed;
  }

  update(f: Readonly<BodyFrame>): void {
    const dx = f.x - this.x;
    const dy = f.y - this.y;
    const dz = f.z - this.z;
    this.x = f.x;
    this.y = f.y;
    this.z = f.z;
    const flat = Math.sqrt(dx * dx + dz * dz);
    // NaN (the first frame) fails too: no sound for a move that was not a walk.
    if (flat <= this.maxSpeed * f.seconds + BODY_SOUNDS.slack) this.move(f, flat, Math.abs(dy));
    else {
      this.walked = 0;
      this.swum = 0;
      this.wasInWater = f.inWater;
    }
    this.heart(f);
  }

  private move(f: Readonly<BodyFrame>, flat: number, rise: number): void {
    if (f.inWater && !this.wasInWater) this.player.playLocal(this.keys.splash);
    this.wasInWater = f.inWater;
    if (f.inWater)
      this.swum = this.advance(this.swum + flat + rise, BODY_SOUNDS.stroke, this.keys.swim);
    else if (f.onGround && f.step)
      this.walked = this.advance(this.walked + flat, BODY_SOUNDS.stride, f.step);
  }

  /** Plays `key` once a whole `length` is covered; returns the distance kept for the next one. */
  private advance(distance: number, length: number, key: string): number {
    if (distance < length) return distance;
    this.player.playLocal(key);
    return distance % length;
  }

  private heart(f: Readonly<BodyFrame>): void {
    if (f.dead || f.health <= 0 || f.health >= this.lowAt) {
      this.beat = 0;
      return;
    }
    this.beat -= f.seconds;
    if (this.beat > 0) return;
    this.player.playLocal(this.keys.heartbeat);
    const { fastBeat, slowBeat } = BODY_SOUNDS;
    this.beat = fastBeat + ((slowBeat - fastBeat) * f.health) / this.lowAt;
  }
}
