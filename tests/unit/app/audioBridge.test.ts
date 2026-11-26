import { describe, expect, it } from 'vitest';
import { AudioBridge, LIT_RADIUS, litSounds } from '../../../src/app/AudioBridge.ts';
import { AudioEngine } from '../../../src/audio/AudioEngine.ts';
import { EYE_HEIGHT } from '../../../src/core/player.ts';
import type { CameraPose } from '../../../src/render/WorldView.ts';
import { HOUR_TICKS } from '../../../src/sim/time.ts';
import { registry } from '../../helpers/registry.ts';
import { playerTestSim } from '../../helpers/simHarness.ts';

const sounds = registry.pack.sounds!;

/** A flat world (grass at y 64, the player at 0.5, 65, 0.5) heard by a muted engine. */
function setup() {
  const s = playerTestSim({ seed: 'audio' });
  let clock = 0;
  const audio = new AudioEngine(registry.pack.sfx ?? [], { muted: true, now: () => clock });
  const bridge = new AudioBridge(audio, s.host.view);
  const pose: CameraPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  /** The rain the client's WeatherFeel would hear (plan v3 « M34 »). */
  const weather = { rain: 0 };
  /** `n` frames of 1/60 s heard from the player's eye, the events of the ticks before first. */
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) {
      for (const event of s.events) bridge.onEvent(event);
      s.events.length = 0;
      const b = s.player.body;
      pose.x = b.x;
      pose.y = b.y + EYE_HEIGHT;
      pose.z = b.z;
      clock += 1000 / 60;
      bridge.frame(1 / 60, pose, weather);
      audio.setListener(pose.x, pose.y, pose.z, pose.yaw, pose.pitch);
    }
  };
  frames(1);
  return {
    s,
    audio,
    bridge,
    frames,
    weather,
    heard: (key: string) => audio.log().includes(key),
  };
}

describe('AudioBridge', () => {
  it('steps on the grass while walking, jumps and lands', () => {
    const { s, frames, heard } = setup();
    for (let i = 0; i < 30; i++) {
      s.tick(2, { forward: 1 });
      frames(1);
    }
    expect(heard(registry.blockSfx(s.sim.world.getBlock(0, 64, -5), 'step')!)).toBe(true);
    s.tick(1, { jump: true });
    s.tick(25);
    frames(1);
    expect(heard(sounds.player.jump)).toBe(true);
    expect(heard(sounds.player.land)).toBe(true);
  });

  it('crackles near a lit campfire, within the scan radius only', () => {
    const { s, frames, heard } = setup();
    s.put(LIT_RADIUS + 3, 65, 0, 'block:campfire[lit=1]');
    frames(60);
    expect(heard(sounds.lit['station:campfire']!)).toBe(false);
    s.put(3, 65, 0, 'block:campfire[lit=1]');
    frames(60);
    expect(heard(sounds.lit['station:campfire']!)).toBe(true);
  });

  it('plays the loop of the place, crossfades to the night one and muffles under water', () => {
    const { s, audio, bridge, frames } = setup();
    frames(200);
    const day = audio.ambience();
    expect(day).toHaveLength(1);
    expect(day[0]!.gain).toBe(1);
    s.sim.time.ticks = 22 * HOUR_TICKS;
    frames(60);
    expect(audio.ambience()).toHaveLength(2);
    frames(200);
    const night = audio.ambience();
    expect(night).toHaveLength(1);
    expect(night[0]!.key).not.toBe(day[0]!.key);
    s.fill(-1, 65, -1, 1, 67, 1, 'block:fresh_water');
    frames(1);
    expect(audio.underwater()).toBe(true);
    bridge.dispose();
    expect(audio.underwater()).toBe(false);
    expect(audio.ambience()).toEqual([]);
  });

  it('plays the rain over the place, softer under a roof; thunder after the light', () => {
    const { s, audio, bridge, frames, weather, heard } = setup();
    const rain = sounds.ambience.rain!;
    const gain = (bed: string) => audio.ambience().find((l) => l.key === bed)?.gain ?? 0;
    frames(10);
    expect(gain(rain.open.bed)).toBe(0);
    weather.rain = 1;
    frames(200);
    expect(gain(rain.open.bed)).toBe(1);
    // Under a roof (plan v5 « M54 »): its own tapping, softer, the open ground's gone.
    s.put(0, 70, 0, 'block:stone');
    frames(220);
    expect(gain(rain.open.bed)).toBe(0);
    expect(gain(rain.roof.bed)).toBeGreaterThan(0.4);
    expect(gain(rain.roof.bed)).toBeLessThan(1);
    // Over water, in the open: drops plinking into it.
    s.put(0, 70, 0, 'block:air');
    s.fill(-1, 64, -1, 1, 64, 1, 'block:fresh_water');
    frames(220);
    expect(gain(rain.water.bed)).toBe(1);
    // Under leaves: their drumming.
    s.put(0, 70, 0, 'block:foliage');
    frames(220);
    expect(gain(rain.leaves.bed)).toBe(1);
    // A strike 170 blocks off: its rumble half a second after the light; one close by cracks.
    bridge.onEvent({ type: 'lightning', x: 170, y: 70, z: 0 });
    frames(20);
    expect(heard(sounds.thunder!.far)).toBe(false);
    frames(20);
    expect(heard(sounds.thunder!.far)).toBe(true);
    bridge.onEvent({ type: 'lightning', x: 20, y: 70, z: 0 });
    frames(10);
    expect(heard(sounds.thunder!.near)).toBe(true);
  });
});

describe('creature steps (plan v5 « M54 »)', () => {
  it('steps a creature walking on the ground near the ear, with its own step sound', () => {
    const { s, frames, heard } = setup();
    s.send({ type: 'debug.spawn', creature: 'creature:trotter', x: 4.5, y: 'surface', z: 0.5 });
    const step = registry.creature('creature:trotter')!.sounds.step!;
    const trotter = [...s.sim.entities.values()].find((e) => e.kind === 'creature')!;
    frames(5);
    expect(heard(step)).toBe(false);
    for (let i = 0; i < 40; i++) {
      trotter.body.x += 0.05;
      trotter.body.onGround = true;
      frames(1);
    }
    expect(heard(step)).toBe(true);
  });
});

describe('rooms (plan v5 « M53 »)', () => {
  it('is dry outdoors, under leaves or a roof alone, and rings in a closed hut', () => {
    const { s, audio, frames } = setup();
    frames(20);
    expect(audio.reverb()).toBe('dry');
    // A canopy of leaves overhead and a roof of stone: still no room.
    s.fill(-3, 69, -3, 3, 69, 3, 'block:foliage');
    frames(20);
    expect(audio.reverb()).toBe('dry');
    s.fill(-3, 69, -3, 3, 69, 3, 'block:stone');
    frames(20);
    expect(audio.reverb()).toBe('dry');
    // Walls all around (a doorway left open): a room.
    s.fill(-3, 65, -3, 3, 68, -3, 'block:stone');
    s.fill(-3, 65, 3, 3, 68, 3, 'block:stone');
    s.fill(-3, 65, -3, -3, 68, 3, 'block:stone');
    s.fill(3, 65, -3, 3, 68, 3, 'block:stone');
    s.fill(0, 65, -3, 0, 66, -3, 'block:air');
    frames(20);
    expect(audio.reverb()).toBe('indoor');
  });
});

describe('litSounds', () => {
  it('gives lit stations, the fire block and lava their sound, every other state none', () => {
    const keys: string[] = [];
    const table = litSounds(registry, keys);
    const lit = registry.stateId('block:campfire[lit=1]');
    const unlit = registry.stateId('block:campfire[lit=0]');
    expect(keys[table[lit]!]).toBe(sounds.lit['station:campfire']);
    expect(table[unlit]).toBe(-1);
    expect(table[registry.air]).toBe(-1);
    expect(new Set(keys)).toEqual(
      new Set([...Object.values(sounds.lit), sounds.burning, sounds.lava]),
    );
    const fire = registry.pack.manifest.bindings.fire!;
    expect(keys[table[registry.defaultState(fire)]!]).toBe(sounds.burning);
    expect(keys[table[registry.defaultState(registry.pack.worldgen!.magma)]!]).toBe(sounds.lava);
  });
});
