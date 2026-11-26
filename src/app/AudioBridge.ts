import { Ambience, type AmbiencePlace, ambienceKey } from '../audio/Ambience.ts';
import type { AudioEngine } from '../audio/AudioEngine.ts';
import { type BodyFrame, BodySounds } from '../audio/bodySounds.ts';
import { Crackles } from '../audio/crackles.ts';
import { AudioCues, type CuePlayer } from '../audio/cues.ts';
import { doppler } from '../audio/reverb.ts';
import { COLLISION_NONE, type Registry } from '../content/registry.ts';
import type { CameraPose } from '../render/WorldView.ts';
import { TICK_SECONDS } from '../sim/clock.ts';
import { isLiquid } from '../sim/collision.ts';
import { inCave } from '../sim/environment.ts';
import type { SimEvent } from '../sim/events.ts';
import type { SimView } from '../sim/host.ts';
import { type Body, PHYSICS } from '../sim/physics.ts';
import { hourOf, phaseOf } from '../sim/time.ts';
import { toColumn } from '../world/coords.ts';

/** Radius (blocks) around the listener searched for a lit station, and how often (s). */
export const LIT_RADIUS = 8;
const LIT_SCAN_SECONDS = 0.5;
/** Thunder (plan v3 « M34 »): heard this far (blocks), after the light at this speed (blocks/s). */
const THUNDER_REACH = 400;
const SOUND_SPEED = 340;
/** The rain loop's gain under cover (a roof over the camera). */
const RAIN_COVERED = 0.35;

/** What the audio hears of the weather (the client's WeatherFeel). */
export interface WeatherSound {
  readonly rain: number;
}

/**
 * Feeds the audio from the open world: the simulation's events (cues.ts), and once a frame what
 * the client sees of the place and the local player: the underwater low-pass and the ambience at
 * the camera (biome, hour, cave, water), the rain over it (softer under a roof), the body's
 * footsteps, strokes and heartbeat, and the crackles of the nearest lit station; thunder comes
 * after a lightning strike's light, later the farther it is.
 */
/** A sound this close to a creature (blocks) is its own: it moves with it. */
const DOPPLER_REACH = 1.5;

export class AudioBridge {
  private readonly audio: AudioEngine;
  private readonly view: SimView;
  private readonly cues: AudioCues;
  private readonly ambience: Ambience;
  private readonly body: BodySounds | null;
  private readonly crackles: Crackles;
  /** Per block state: index in `litKeys` of its lit station's sound, −1 for none. */
  private readonly litSound: Int16Array;
  private readonly litKeys: string[] = [];
  /** The nearest lit station of the last scan (its sound, null: none) and its cell centre. */
  private readonly fire = { key: null as string | null, x: 0, y: 0, z: 0 };
  private scanWait = 0;
  private lastTick = -1;
  /** Where the ear was on the last frame. */
  private earX = 0;
  private earY = 0;
  private earZ = 0;
  /** A roof over the ear on the last frame (the rain is softer, the room an indoor one). */
  private covered = false;
  /** Thunders on their way: seconds left before each is heard. */
  private readonly thunders: number[] = [];
  /** Reused every frame (no allocation). */
  private readonly place: AmbiencePlace = {
    biome: undefined,
    night: false,
    cave: false,
    underwater: false,
  };
  private readonly frameBody: BodyFrame = {
    x: 0,
    y: 0,
    z: 0,
    seconds: 0,
    onGround: false,
    inWater: false,
    step: undefined,
    health: 0,
    dead: false,
  };

  constructor(audio: AudioEngine, view: SimView) {
    const registry = view.registry;
    const sounds = registry.pack.sounds;
    this.audio = audio;
    this.view = view;
    // Sounds from a moving creature shift a little in pitch (plan v4 « M44 »: Doppler).
    const player: CuePlayer = {
      play: (key, x, y, z, pitch = 1) => audio.play(key, x, y, z, pitch * this.dopplerAt(x, y, z)),
      playLocal: (key, pitch) => audio.playLocal(key, pitch),
      playUi: (key, pitch) => audio.playUi(key, pitch),
    };
    this.cues = new AudioCues(player, registry, view.playerId);
    this.ambience = new Ambience(audio);
    this.body = sounds
      ? new BodySounds(audio, sounds.player, registry.pack.balance.health.lowAt, PHYSICS.sprint * 2)
      : null;
    this.crackles = new Crackles(audio);
    this.litSound = litSounds(registry, this.litKeys);
  }

  onEvent(event: SimEvent): void {
    this.cues.onEvent(event);
    if (event.type === 'lightning') {
      const distance = Math.hypot(event.x - this.earX, event.z - this.earZ);
      if (distance <= THUNDER_REACH) this.thunders.push(distance / SOUND_SPEED);
    }
  }

  /** One frame (`dt` wall seconds) heard from the camera `pose`, in the `weather`. */
  frame(dt: number, pose: CameraPose, weather: WeatherSound): void {
    const { world, registry } = this.view;
    const underwater = isLiquid(world, registry.tables, pose.x, pose.y, pose.z);
    this.earX = pose.x;
    this.earY = pose.y;
    this.earZ = pose.z;
    this.audio.setUnderwater(underwater);
    this.hearPlace(dt, pose, underwater);
    this.hearWeather(dt, weather.rain);
    this.hearBody();
    this.scanWait -= dt;
    if (this.scanWait <= 0) {
      this.scanWait = LIT_SCAN_SECONDS;
      this.findFire(pose);
    }
    const fire = this.fire;
    this.crackles.update(dt, fire.key, fire.x, fire.y, fire.z);
  }

  /** Where the ambience heard the camera on the last frame (automation). */
  ambiencePlace(): Readonly<AmbiencePlace> {
    return this.place;
  }

  /** The world closes: the ambience stops at once and the low-pass opens. */
  dispose(): void {
    this.ambience.stop();
    const rain = this.view.registry.pack.sounds?.ambience.rain;
    if (rain) this.audio.setLoop(rain, 0);
    this.thunders.length = 0;
    this.audio.setUnderwater(false);
  }

  /** The Doppler factor of a sound at (x, y, z) from the creature making it, if one is there. */
  private dopplerAt(x: number, y: number, z: number): number {
    let best = DOPPLER_REACH * DOPPLER_REACH;
    let factor = 1;
    for (const entity of this.view.entities.values()) {
      if (entity.kind !== 'creature') continue;
      const b = entity.body;
      const d2 = (b.x - x) ** 2 + (b.y + 0.5 - y) ** 2 + (b.z - z) ** 2;
      if (d2 >= best) continue;
      best = d2;
      factor = doppler(b.vx, b.vy, b.vz, this.earX - x, this.earY - y, this.earZ - z);
    }
    return factor;
  }

  private hearPlace(dt: number, pose: CameraPose, underwater: boolean): void {
    const bindings = this.view.registry.pack.sounds?.ambience;
    if (!bindings) return;
    const { world, gen, registry } = this.view;
    const x = Math.floor(pose.x);
    const y = Math.floor(pose.y);
    const z = Math.floor(pose.z);
    const place = this.place;
    const biome = world.biomeAt(x, z);
    place.biome = biome < 0 ? undefined : gen.biomeDefs[biome]?.key;
    const phase = phaseOf(hourOf(this.view.time().ticks));
    place.night = phase === 'dusk' || phase === 'night';
    place.cave = inCave(world, x, y, z, registry.pack.balance.climate.caveDepth);
    place.underwater = underwater;
    this.ambience.update(ambienceKey(bindings, place), dt);
    // The room the effects ring in (plan v4 « M44 »).
    this.covered = world.heightAt(x, z) > y + 1;
    const acoustics = biome < 0 ? undefined : gen.biomeDefs[biome]?.acoustics;
    const room = place.cave
      ? 'cave'
      : this.covered
        ? 'indoor'
        : acoustics === 'forest'
          ? 'forest'
          : 'open';
    this.audio.setReverb(room);
  }

  /**
   * The rain loop over the place's (its gain the rain's, softer under a roof, none underwater or
   * in a cave), and the thunders whose time has come.
   */
  private hearWeather(dt: number, rain: number): void {
    const sounds = this.view.registry.pack.sounds;
    const loop = sounds?.ambience.rain;
    if (loop) {
      const place = this.place;
      const gain = place.underwater || place.cave ? 0 : rain * (this.covered ? RAIN_COVERED : 1);
      this.audio.setLoop(loop, gain);
    }
    const thunders = this.thunders;
    for (let i = thunders.length - 1; i >= 0; i--) {
      thunders[i] = thunders[i]! - dt;
      if (thunders[i]! > 0) continue;
      thunders.splice(i, 1);
      if (sounds?.thunder) this.audio.playLocal(sounds.thunder);
    }
  }

  private hearBody(): void {
    const player = this.view.player();
    const body = this.body;
    if (!player || !body) return;
    const tick = this.view.tick();
    const f = this.frameBody;
    const b = player.body;
    f.x = b.x;
    f.y = b.y;
    f.z = b.z;
    f.seconds = this.lastTick < 0 ? 0 : (tick - this.lastTick) * TICK_SECONDS;
    this.lastTick = tick;
    f.onGround = b.onGround;
    f.inWater = b.inWater;
    f.step = this.stepUnder(b);
    f.health = player.survival.health;
    f.dead = player.survival.dead;
    body.update(f);
  }

  /**
   * The footstep of what the feet tread: the water of a shallow wade, else the block under them
   * (a low block's own cell, since the feet stand inside it), nothing over a gap.
   */
  private stepUnder(b: Readonly<Body>): string | undefined {
    const { world, registry } = this.view;
    const y = Math.floor(b.feetInWater ? b.y + 0.05 : b.y - 0.05);
    const state = world.getBlock(Math.floor(b.x), y, Math.floor(b.z));
    if (!b.feetInWater && registry.tables.collision[state] === COLLISION_NONE) return undefined;
    return registry.blockSfx(state, 'step');
  }

  /** The nearest lit station block within LIT_RADIUS of the camera, into `fire`. */
  private findFire(pose: CameraPose): void {
    const world = this.view.world;
    const fire = this.fire;
    fire.key = null;
    if (this.litKeys.length === 0) return;
    const r = LIT_RADIUS;
    const bx = Math.floor(pose.x);
    const by = Math.floor(pose.y);
    const bz = Math.floor(pose.z);
    let best = Number.POSITIVE_INFINITY;
    for (let x = bx - r; x <= bx + r; x++) {
      for (let z = bz - r; z <= bz + r; z++) {
        // One column lookup per block column, not per voxel.
        const column = world.getColumn(toColumn(x), toColumn(z));
        if (!column) continue;
        for (let y = by - r; y <= by + r; y++) {
          const sound = this.litSound[world.blockIn(column, x, y, z)]!;
          if (sound < 0) continue;
          const dx = x + 0.5 - pose.x;
          const dy = y + 0.5 - pose.y;
          const dz = z + 0.5 - pose.z;
          const d = dx * dx + dy * dy + dz * dz;
          if (d >= best) continue;
          best = d;
          fire.key = this.litKeys[sound]!;
          fire.x = x + 0.5;
          fire.y = y + 0.5;
          fire.z = z + 0.5;
        }
      }
    }
  }
}

/**
 * Per block state, the index in `keys` (filled here) of the sound its station makes while lit
 * (the pack's `sounds.lit`), −1 for a state that is not a lit station.
 */
export function litSounds(registry: Registry, keys: string[]): Int16Array {
  const table = new Int16Array(registry.tables.stateCount).fill(-1);
  const lit = registry.pack.sounds?.lit;
  if (!lit) return table;
  for (let state = 0; state < table.length; state++) {
    const station = registry.blockDef(state).station;
    const key = station && lit[station];
    if (!key || registry.prop(state, 'lit') !== '1') continue;
    if (!keys.includes(key)) keys.push(key);
    table[state] = keys.indexOf(key);
  }
  return table;
}
