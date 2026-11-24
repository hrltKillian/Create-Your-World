import { describe, expect, it } from 'vitest';
import { BODY_SOUNDS, type BodyFrame, BodySounds } from '../../../src/audio/bodySounds.ts';
import { CRACKLE, Crackles } from '../../../src/audio/crackles.ts';
import { STRIDE } from '../../../src/core/player.ts';
import { TICK_SECONDS } from '../../../src/sim/clock.ts';
import { PHYSICS } from '../../../src/sim/physics.ts';
import { FakePlayer } from '../../helpers/fakeAudio.ts';
import { registry } from '../../helpers/registry.ts';

const keys = registry.pack.sounds!.player;
const STEP = 'sfx:step_soil';
const LOW_AT = registry.pack.balance.health.lowAt;

function body() {
  const player = new FakePlayer();
  const sounds = new BodySounds(player, keys, LOW_AT, PHYSICS.sprint * 2);
  const f: BodyFrame = {
    x: 0,
    y: 65,
    z: 0,
    seconds: 0,
    onGround: true,
    inWater: false,
    step: STEP,
    health: 100,
    dead: false,
  };
  /** `frames` frames of `ticks` ticks each, moving `speed` m/s along x. */
  const go = (frames: number, ticks: number, speed: number, patch: Partial<BodyFrame> = {}) => {
    Object.assign(f, patch);
    for (let i = 0; i < frames; i++) {
      f.seconds = ticks * TICK_SECONDS;
      f.x += speed * f.seconds;
      sounds.update(f);
    }
  };
  sounds.update(f);
  return { player, f, go, count: (key: string) => player.keys().filter((k) => k === key).length };
}

describe('BodySounds', () => {
  it('steps once a stride while walking on the ground, never standing or in the air', () => {
    const { go, count } = body();
    // 10 s at walking speed, two ticks a frame.
    go(150, 2, PHYSICS.walk);
    const expected = Math.floor((PHYSICS.walk * 10) / STRIDE);
    expect(count(STEP)).toBe(expected);
    go(150, 2, 0);
    go(150, 2, PHYSICS.walk, { onGround: false });
    go(30, 2, PHYSICS.walk, { onGround: true, step: undefined });
    expect(count(STEP)).toBe(expected);
  });

  it('sounds at most one step a frame: a long fixed-step walk is not a burst', () => {
    const { go, count } = body();
    // 60 ticks of sprinting in one frame cover more than 7 strides.
    go(1, 60, PHYSICS.sprint);
    expect(count(STEP)).toBe(1);
  });

  it('stays silent over a teleport and starts the stride again after it', () => {
    const { player, f, go, count } = body();
    go(3, 2, PHYSICS.walk);
    f.x += 40;
    f.seconds = 2 * TICK_SECONDS;
    go(1, 2, 0);
    expect(player.calls).toEqual([]);
    go(1, 2, STRIDE / (2 * TICK_SECONDS) / 2);
    expect(count(STEP)).toBe(0);
  });

  it('splashes into water and strokes while swimming', () => {
    const { go, count } = body();
    go(1, 2, PHYSICS.swim, { inWater: true, onGround: false });
    expect(count(keys.splash)).toBe(1);
    go(150, 2, PHYSICS.swim);
    expect(count(keys.splash)).toBe(1);
    expect(count(keys.swim)).toBe(Math.floor((PHYSICS.swim * 10.07) / BODY_SOUNDS.stroke));
    expect(count(STEP)).toBe(0);
  });

  it('beats the heart under the threshold, faster when lower, and not once dead', () => {
    const slow = body();
    slow.go(150, 2, 0, { health: LOW_AT - 1 });
    const fast = body();
    fast.go(150, 2, 0, { health: 1 });
    expect(slow.count(keys.heartbeat)).toBeGreaterThanOrEqual(10);
    expect(fast.count(keys.heartbeat)).toBeGreaterThan(slow.count(keys.heartbeat));
    expect(fast.count(keys.heartbeat)).toBeLessThanOrEqual(Math.ceil(10 / BODY_SOUNDS.fastBeat));
    const calm = body();
    calm.go(150, 2, 0, { health: LOW_AT });
    calm.go(150, 2, 0, { health: 0, dead: true });
    expect(calm.count(keys.heartbeat)).toBe(0);
  });
});

describe('Crackles', () => {
  it('crackles every 0.35–0.8 s near a lit station, and not without one', () => {
    const player = new FakePlayer();
    let roll = 0;
    const crackles = new Crackles(player, () => (roll = (roll + 0.37) % 1));
    for (let i = 0; i < 600; i++) crackles.update(1 / 60, 'sfx:fire', 3.5, 65.5, 0.5);
    const plays = player.calls.length;
    expect(plays).toBeGreaterThanOrEqual(Math.floor(10 / CRACKLE.maxSeconds));
    expect(plays).toBeLessThanOrEqual(Math.ceil(10 / CRACKLE.minSeconds));
    expect(player.calls[0]).toEqual({ key: 'sfx:fire', at: 'world', x: 3.5, pitch: 1 });
    for (let i = 0; i < 600; i++) crackles.update(1 / 60, null, 0, 0, 0);
    expect(player.calls.length).toBe(plays);
  });
});
