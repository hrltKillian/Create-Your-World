import { describe, expect, it } from 'vitest';
import { type BodyFrame, BodySounds } from '../../../src/audio/bodySounds.ts';
import { FLAG_SOLID } from '../../../src/content/registry.ts';
import { EYE_HEIGHT } from '../../../src/core/player.ts';
import {
  BOB,
  type CameraMode,
  CameraRig,
  DIP_MAX,
  HURT_ROLL,
  pulse,
  SPRINT_FOV,
} from '../../../src/render/CameraRig.ts';
import { PHYSICS } from '../../../src/sim/physics.ts';
import { createPlayer } from '../../../src/sim/player.ts';
import type { VoxelWorld } from '../../../src/world/VoxelWorld.ts';
import { FakePlayer } from '../../helpers/fakeAudio.ts';
import { flatWorld } from '../../helpers/flatWorld.ts';
import { registry } from '../../helpers/registry.ts';

const STONE = registry.defaultState('block:stone');
const GRASS_PLANT = registry.defaultState('block:tall_grass');

function solidAt(w: VoxelWorld, x: number, y: number, z: number): boolean {
  const state = w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  return (registry.tables.flags[state]! & FLAG_SOLID) !== 0;
}

/** Third-person pose after the camera settles (2 s of 60 fps frames). */
function settle(
  w: VoxelWorld,
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
  mode: CameraMode = 'back',
) {
  const player = createPlayer(1, x, y, z, 2, registry.pack.balance);
  const rig = new CameraRig();
  rig.mode = mode;
  rig.yaw = yaw;
  rig.pitch = pitch;
  for (let i = 0; i < 120; i++) rig.update(player, 1, w, registry.tables, 1 / 60);
  return rig;
}

/** The camera and the points 0.06 around it (near plane) are outside solid blocks. */
function clear(w: VoxelWorld, rig: CameraRig): boolean {
  const { x, y, z } = rig.pose;
  const d = 0.06;
  return [
    [0, 0, 0],
    [d, 0, 0],
    [-d, 0, 0],
    [0, d, 0],
    [0, -d, 0],
    [0, 0, d],
    [0, 0, -d],
  ].every(([a, b, c]) => !solidAt(w, x + a!, y + b!, z + c!));
}

describe('third-person camera', () => {
  it('V turns through first person, behind, in front and first person again (plan v5 « M46 »)', () => {
    const rig = new CameraRig();
    const seen: CameraMode[] = [rig.mode];
    for (let i = 0; i < 3; i++) {
      rig.toggleMode();
      seen.push(rig.mode);
    }
    expect(seen).toEqual(['first', 'back', 'front', 'first']);
  });

  it('in front: about 4 m ahead along the look, turned back towards the player', () => {
    const w = flatWorld();
    // Looking north (−z), a little down: the camera ahead, lower, looking south and up.
    const rig = settle(w, 0.5, 64, 0.5, 0, -0.2, 'front');
    expect(rig.pose.z).toBeLessThan(0.5 - 3.5);
    expect(rig.pose.x).toBeCloseTo(0.5, 2);
    expect(rig.pose.yaw).toBeCloseTo(Math.PI, 6);
    expect(rig.pose.pitch).toBeCloseTo(0.2, 6);
    expect(clear(w, rig)).toBe(true);
  });

  it('sits about 4 m behind and 0.5 m above the eye in the open, through plants', () => {
    const w = flatWorld();
    for (let z = 0; z < 8; z++) w.setBlock(0, 64, z, GRASS_PLANT);
    const rig = settle(w, 0.5, 64, 0.5, 0, 0);
    expect(rig.distance).toBeCloseTo(Math.hypot(4, 0.5), 2);
    expect(rig.pose.z).toBeCloseTo(0.5 + 4, 2);
    expect(rig.pose.y).toBeCloseTo(64 + 1.62 + 0.5, 2);
  });

  it('stops in front of a wall 2 m behind the player', () => {
    const w = flatWorld();
    for (let x = -3; x <= 3; x++) for (let y = 64; y < 69; y++) w.setBlock(x, y, 2, STONE);
    const rig = settle(w, 0.5, 64, 0, 0, 0);
    expect(rig.distance).toBeLessThan(2);
    expect(rig.pose.z).toBeLessThan(2 - 0.05);
    expect(clear(w, rig)).toBe(true);
  });

  it('stays out of a wall the player is leaning against', () => {
    const w = flatWorld();
    for (let x = -3; x <= 3; x++) for (let y = 64; y < 69; y++) w.setBlock(x, y, 1, STONE);
    const rig = settle(w, 0.5, 64, 0.7, 0, 0);
    expect(clear(w, rig)).toBe(true);
    expect(rig.distance).toBeLessThan(0.3);
  });

  it('never enters the rock of a two-high, one-wide tunnel, whatever the view', () => {
    const w = flatWorld();
    for (let x = -4; x <= 4; x++) {
      for (let z = -30; z <= 30; z++) {
        for (let y = 64; y <= 67; y++) if (x !== 0 || y >= 66) w.setBlock(x, y, z, STONE);
      }
    }
    for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 12) {
      for (let pitch = -1.4; pitch <= 1.4; pitch += 0.35) {
        const rig = settle(w, 0.5, 64, 0.5, yaw, pitch);
        expect(clear(w, rig), `yaw ${yaw.toFixed(2)} pitch ${pitch.toFixed(2)}`).toBe(true);
      }
    }
  });

  it('stays out of a low ceiling while crouching', () => {
    const w = flatWorld();
    for (let x = -4; x <= 4; x++) for (let z = -8; z <= 8; z++) w.setBlock(x, 66, z, STONE);
    const player = createPlayer(1, 0.5, 64, 0.5, 2, registry.pack.balance);
    player.body.crouching = true;
    for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 6) {
      for (const pitch of [-1.2, -0.4, 0, 0.6, 1.2]) {
        const rig = new CameraRig();
        rig.mode = 'back';
        rig.yaw = yaw;
        rig.pitch = pitch;
        for (let i = 0; i < 120; i++) rig.update(player, 1, w, registry.tables, 1 / 60);
        expect(clear(w, rig)).toBe(true);
      }
    }
  });
});

describe('first-person feel', () => {
  const FRAME = 1 / 60;

  /** A rig over a player on the ground; each frame moves the feet `move` m/s north (−z). */
  function walker() {
    const w = flatWorld();
    const player = createPlayer(1, 0.5, 64, 0.5, 2, registry.pack.balance);
    player.body.onGround = true;
    const rig = new CameraRig();
    const frame = (move = 0) => {
      player.prevZ = player.body.z;
      player.body.z -= move * FRAME;
      rig.update(player, 1, w, registry.tables, FRAME);
      return rig.pose.y - rig.eye.y;
    };
    /** The lowest and highest camera offset from the eye over `seconds` of frames. */
    const range = (seconds: number, move = 0) => {
      let low = Number.POSITIVE_INFINITY;
      let high = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < seconds * 60; i++) {
        const offset = frame(move);
        low = Math.min(low, offset);
        high = Math.max(high, offset);
      }
      return { low, high };
    };
    return { player, rig, frame, range };
  }

  it('bobs 0.035 m while walking, the eye staying put, and eases to rest', () => {
    const { player, rig, frame, range } = walker();
    range(1, 4.3);
    const walking = range(1, 4.3);
    expect(walking.high).toBeCloseTo(BOB, 3);
    expect(walking.low).toBeCloseTo(-BOB, 3);
    // The aim's origin never bobs.
    expect(rig.eye.y).toBe(64 + EYE_HEIGHT);
    expect(Math.abs(rig.pose.x - rig.eye.x)).toBeLessThanOrEqual(BOB / 2);
    // Standing still, in the air or with the bob off: back to the eye.
    range(1);
    expect(Math.abs(frame())).toBeLessThan(1e-3);
    player.body.onGround = false;
    range(1, 4.3);
    expect(Math.abs(frame(4.3))).toBeLessThan(1e-3);
    player.body.onGround = true;
    rig.viewBob = false;
    const off = range(1, 4.3);
    expect([off.low, off.high]).toEqual([0, 0]);
    expect(rig.pose.x).toBe(rig.eye.x);
  });

  it('bobs less while crouch-walking, and a teleport is no step', () => {
    const { frame, range } = walker();
    range(1, 1.6);
    const slow = range(1, 1.6);
    expect(slow.high).toBeLessThan(BOB * 0.6);
    expect(slow.high).toBeGreaterThan(BOB * 0.3);
    range(1);
    expect(Math.abs(frame(600))).toBeLessThan(1e-3);
  });

  it('dips on every footstep: the bob and the footsteps share the stride, after a jump or a teleport too', () => {
    const { player, rig, frame } = walker();
    const heard = new FakePlayer();
    const feet = new BodySounds(heard, registry.pack.sounds!.player, 1, PHYSICS.sprint * 2);
    const f: BodyFrame = {
      x: 0,
      y: 64,
      z: 0,
      seconds: FRAME,
      onGround: true,
      inWater: false,
      step: 'step',
      health: 100,
      dead: false,
    };
    /** Frames at `speed` m/s; the bob (in BOBs) at each footstep after the first second. */
    const walk = (seconds: number, onGround = true, speed: number = PHYSICS.walk) => {
      const bobs: number[] = [];
      player.body.onGround = onGround;
      f.onGround = onGround;
      for (let i = 0; i < seconds * 60; i++) {
        frame(speed);
        const before = heard.calls.length;
        f.x = player.body.x;
        f.z = player.body.z;
        feet.update(f);
        if (heard.calls.length > before && i >= 60) bobs.push(rig.bobOffset() / BOB);
      }
      return bobs;
    };
    /** Every footstep fell at the bottom of a dip (−BOB). */
    const expectDips = (bobs: number[]) => {
      expect(bobs.length).toBeGreaterThan(2);
      expect(Math.max(...bobs)).toBeLessThan(-0.9);
    };
    expectDips(walk(4));
    // A jump forward: no footstep and no bob in the air.
    walk(0.6, false);
    expectDips(walk(4));
    // A teleport (40 m in a frame) starts the stride again.
    walk(1 / 60, true, 40 * 60);
    expectDips(walk(4));
  });

  it('dips on a landing, deeper for a longer fall, then comes back', () => {
    const { rig, frame, range } = walker();
    frame();
    rig.land(10);
    expect(range(0.2).low).toBeCloseTo(-DIP_MAX, 2);
    range(0.3);
    expect(frame()).toBe(0);
    rig.land(1);
    const shallow = range(0.5).low;
    expect(shallow).toBeLessThan(-0.02);
    expect(shallow).toBeGreaterThan(-DIP_MAX / 2);
    expect(rig.eye.y).toBe(64 + EYE_HEIGHT);
  });

  it('rolls towards the side a blow came from, then levels', () => {
    const { rig, frame } = walker();
    frame();
    /** The roll over the next 0.1 s that is farthest from level. */
    const peak = () => {
      let roll = 0;
      for (let i = 0; i < 6; i++) {
        frame();
        if (Math.abs(rig.pose.roll!) > Math.abs(roll)) roll = rig.pose.roll!;
      }
      return roll;
    };
    // Looking north: east is on the right; a negative roll leans the view right.
    rig.hurt(5.5, 0.5);
    expect(peak()).toBeCloseTo(-HURT_ROLL, 2);
    for (let i = 0; i < 30; i++) frame();
    expect(Math.abs(rig.pose.roll!)).toBe(0);
    rig.hurt(-4.5, 0.5);
    expect(peak()).toBeCloseTo(HURT_ROLL, 2);
    // Turned to face east, the same blow from the east comes from straight ahead: rightwards.
    rig.yaw = -Math.PI / 2;
    for (let i = 0; i < 30; i++) frame();
    rig.hurt(0.5, 5.5);
    expect(peak()).toBeLessThan(0);
  });

  it('widens the view by 8° while sprinting in first person, smoothly', () => {
    const { player, rig, frame } = walker();
    player.sprinting = true;
    frame();
    expect(rig.pose.fovOffset).toBeGreaterThan(0);
    expect(rig.pose.fovOffset).toBeLessThan(SPRINT_FOV / 2);
    for (let i = 0; i < 30; i++) frame(6.4);
    expect(rig.pose.fovOffset).toBeCloseTo(SPRINT_FOV, 1);
    player.sprinting = false;
    for (let i = 0; i < 60; i++) frame();
    expect(rig.pose.fovOffset).toBe(0);
    // In third person the view keeps the setting, and never rolls.
    rig.mode = 'back';
    player.sprinting = true;
    rig.hurt(5.5, 0.5);
    for (let i = 0; i < 30; i++) frame(6.4);
    expect([rig.pose.fovOffset, rig.pose.roll]).toEqual([0, 0]);
  });

  it('shapes the dip and the roll with a quick rise and a slower fall', () => {
    expect(pulse(0, 0.1, 0.3)).toBe(0);
    expect(pulse(0.1, 0.1, 0.3)).toBe(1);
    expect(pulse(0.05, 0.1, 0.3)).toBeCloseTo(Math.SQRT1_2, 9);
    expect(pulse(0.25, 0.1, 0.3)).toBeCloseTo(Math.SQRT1_2, 9);
    expect(pulse(0.4, 0.1, 0.3)).toBe(0);
    expect(pulse(Number.POSITIVE_INFINITY, 0.1, 0.3)).toBe(0);
  });
});
