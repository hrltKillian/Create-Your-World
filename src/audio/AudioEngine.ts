import { renderSfx } from '../assets/procedural/sfxSynth.ts';
import type { SfxDef } from '../content/schema.ts';
import { lookVector, type Vec3 } from '../core/angles.ts';
import { DEFAULT_SETTINGS, type Volumes } from '../platform/settings.ts';
import { createGraph, type Graph, type Voice, type VoiceSlot, WATER_FILTER } from './graph.ts';
import { LoopBank, type LoopView } from './loops.ts';
import { impulseResponse, REVERBS, type ReverbPlace } from './reverb.ts';

export type { VoiceSlot } from './graph.ts';

/** Playback rules (docs/conception.md « Audio »). */
export const AUDIO = {
  voices: 24,
  /** Linear distance model: full volume up to `near`, silent at `far` (m); farther is not played. */
  near: 2,
  far: 32,
  /** Random pitch and gain spread of each play (±). */
  pitchSpread: 0.08,
  gainSpread: 0.1,
  /** The same sound is not started twice within this time (ms). */
  dedupMs: 30,
  /** Keys kept by `log()`. */
  logSize: 256,
} as const;

/** Time constant of the crossfade between two rooms (s). */
const ROOM_GLIDE = 0.4;

/** Milliseconds of synthesis between two yields to the page while prerendering. */
const PRERENDER_SLICE_MS = 12;

/** A free voice if there is one, else the least audible, then the oldest. */
export function pickVoice(voices: readonly VoiceSlot[], now: number): number {
  let best = 0;
  for (let i = 0; i < voices.length; i++) {
    const v = voices[i]!;
    if (v.endsAt <= now) return i;
    const b = voices[best]!;
    if (v.audibility < b.audibility || (v.audibility === b.audibility && v.startedAt < b.startedAt))
      best = i;
  }
  return best;
}

/** Linear attenuation between AUDIO.near and AUDIO.far (the PannerNode's own model). */
export function attenuation(distance: number): number {
  const d = Math.min(AUDIO.far, Math.max(AUDIO.near, distance));
  return 1 - (d - AUDIO.near) / (AUDIO.far - AUDIO.near);
}

export interface AudioOptions {
  /** `?mute=1`: no AudioContext at all; plays are still logged. */
  readonly muted: boolean;
  /** Clock in ms (tests). */
  readonly now?: () => number;
}

/**
 * The game's sound player: one AudioContext (created on the first user gesture), one-shot recipes
 * pre-rendered once, 24 voices with stealing, a linear equal-power panner per voice, the ambience
 * loops (loops.ts) and the sfx / ambience / ui buses into a master gain and a compressor (their
 * volumes from Settings), the first two through the underwater low-pass. Every accepted play and
 * every loop started is logged for tests, even before the context runs or when muted.
 */
export class AudioEngine {
  private readonly recipes: readonly SfxDef[];
  private readonly muted: boolean;
  private readonly now: () => number;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loops: LoopBank;
  private readonly lastStart = new Map<string, number>();
  private readonly played: string[] = [];
  private total = 0;
  private graph: Graph | null = null;
  private volumes: Volumes = DEFAULT_SETTINGS.volumes;
  private submerged = false;
  private readonly ear: Vec3 = { x: 0, y: 0, z: 0 };
  /** The room the effects reverberate in, the room node it is in, the rooms' impulses. */
  private place: ReverbPlace | null = null;
  private room = 0;
  private readonly impulses = new Map<ReverbPlace, AudioBuffer>();
  private readonly forward: Vec3 = { x: 0, y: 0, z: -1 };

  constructor(recipes: readonly SfxDef[], options: AudioOptions) {
    this.recipes = recipes.filter((def) => !def.loop);
    this.loops = new LoopBank(recipes);
    this.muted = options.muted;
    this.now = options.now ?? (() => performance.now());
  }

  /**
   * Renders every one-shot into a buffer (`synthesize`); needs no user gesture. A few at a time,
   * yielding to the page between them, so the loading screen keeps moving.
   */
  async prerender(): Promise<void> {
    if (this.muted) return;
    let since = performance.now();
    for (const def of this.recipes) {
      this.buffers.set(def.key, renderSfx(def));
      if (performance.now() - since > PRERENDER_SLICE_MS) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        since = performance.now();
      }
    }
  }

  /**
   * Creates or resumes the AudioContext. Call it from a user gesture (a click) to create it; once
   * it exists, also when the tab shows again. Resuming a running context changes nothing and
   * cancels a `suspend()` still under way.
   */
  resume(): void {
    if (this.muted) return;
    if (!this.graph) {
      this.graph = createGraph(AUDIO.voices, AUDIO);
      this.setVolumes(this.volumes);
      this.setUnderwater(this.submerged);
      this.applyRoom();
    }
    void this.graph.ctx.resume();
  }

  /** Bus volumes (Settings), applied now or when the context is made. */
  setVolumes(volumes: Volumes): void {
    this.volumes = volumes;
    const graph = this.graph;
    if (!graph) return;
    graph.master.gain.value = volumes.master;
    graph.sfx.gain.value = volumes.effects;
    graph.ambience.gain.value = volumes.ambience;
    graph.ui.gain.value = volumes.ui;
  }

  /** Hidden tab: suspends the context (if any) until `resume()`. Plays are still logged meanwhile. */
  suspend(): void {
    if (this.graph) void this.graph.ctx.suspend();
  }

  /** 'muted', 'idle' (no gesture yet) or the AudioContext state. */
  state(): string {
    return this.muted ? 'muted' : (this.graph?.ctx.state ?? 'idle');
  }

  /** Moves the listener (the camera). Call every frame; allocates nothing. */
  setListener(x: number, y: number, z: number, yaw: number, pitch: number): void {
    const ear = this.ear;
    ear.x = x;
    ear.y = y;
    ear.z = z;
    lookVector(yaw, pitch, this.forward);
    const listener = this.graph?.ctx.listener;
    if (!listener) return;
    listener.positionX.value = x;
    listener.positionY.value = y;
    listener.positionZ.value = z;
    listener.forwardX.value = this.forward.x;
    listener.forwardY.value = this.forward.y;
    listener.forwardZ.value = this.forward.z;
  }

  /** The camera is in water: effects and ambience glide to a muffled low-pass (or back). */
  setUnderwater(underwater: boolean): void {
    this.submerged = underwater;
    const graph = this.graph;
    if (!graph) return;
    const hz = underwater ? WATER_FILTER.underwaterHz : WATER_FILTER.openHz;
    graph.water.frequency.setTargetAtTime(hz, graph.ctx.currentTime, WATER_FILTER.glide);
  }

  underwater(): boolean {
    return this.submerged;
  }

  /** The room the effects reverberate in (plan v4 « M44 »): crossfaded to when it changes. */
  setReverb(place: ReverbPlace): void {
    if (place === this.place) return;
    this.place = place;
    this.applyRoom();
  }

  /** The room set last (null before the first). */
  reverb(): ReverbPlace | null {
    return this.place;
  }

  /** Loads the place's impulse into the idle room and crossfades to it. */
  private applyRoom(): void {
    const graph = this.graph;
    const place = this.place;
    if (!graph || !place) return;
    const ctx = graph.ctx;
    let impulse = this.impulses.get(place);
    if (!impulse) {
      const [left, right] = impulseResponse(place, ctx.sampleRate);
      impulse = new AudioBuffer({
        length: left.length,
        sampleRate: ctx.sampleRate,
        numberOfChannels: 2,
      });
      impulse.copyToChannel(left, 0);
      impulse.copyToChannel(right, 1);
      this.impulses.set(place, impulse);
    }
    const rooms = graph.reverb.rooms;
    const next = 1 - this.room;
    const now = ctx.currentTime;
    const coming = rooms[next]!;
    coming.convolver.buffer = impulse;
    coming.level.gain.setTargetAtTime(1, now, ROOM_GLIDE);
    rooms[this.room]!.level.gain.setTargetAtTime(0, now, ROOM_GLIDE);
    graph.reverb.send.gain.setTargetAtTime(REVERBS[place].wet, now, ROOM_GLIDE);
    this.room = next;
  }

  /** Plays a sound at a world position (sfx bus). False when it is too far or a duplicate. */
  play(key: string, x: number, y: number, z: number, pitch = 1): boolean {
    const dx = x - this.ear.x;
    const dy = y - this.ear.y;
    const dz = z - this.ear.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance > AUDIO.far || !this.accept(key)) return false;
    const voice = this.start(key, attenuation(distance), pitch);
    if (voice) {
      const p = voice.panner;
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
      voice.gain.connect(p);
      p.connect(this.graph!.sfx);
    }
    return true;
  }

  /** Plays one of the local player's own sounds at the ear (sfx bus). False for a duplicate. */
  playLocal(key: string, pitch = 1): boolean {
    return this.unpositioned(key, pitch, 'sfx');
  }

  /** Plays an interface sound (ui bus, not positioned). False for a duplicate. */
  playUi(key: string, pitch = 1): boolean {
    return this.unpositioned(key, pitch, 'ui');
  }

  /** Sets the gain of an ambience loop (ambience bus); 0 stops it. A loop started is logged. */
  setLoop(key: string, gain: number): void {
    const graph = this.graph;
    if (this.loops.set(key, gain, graph?.ctx ?? null, graph?.ambience ?? null)) this.record(key);
  }

  /** The ambience loops playing or fading, with their gains. */
  ambience(): LoopView[] {
    return this.loops.list();
  }

  /** Keys of the last sounds played, oldest first. */
  log(): string[] {
    return [...this.played];
  }

  /** How many keys were ever logged (what came after a mark: the last `logCount() − mark`). */
  logCount(): number {
    return this.total;
  }

  private unpositioned(key: string, pitch: number, bus: 'sfx' | 'ui'): boolean {
    if (!this.accept(key)) return false;
    const voice = this.start(key, 1, pitch);
    if (voice) voice.gain.connect(this.graph![bus]);
    return true;
  }

  /** De-duplicates and logs a play. */
  private accept(key: string): boolean {
    const now = this.now();
    const last = this.lastStart.get(key);
    if (last !== undefined && now - last < AUDIO.dedupMs) return false;
    this.lastStart.set(key, now);
    this.record(key);
    return true;
  }

  private record(key: string): void {
    this.total++;
    this.played.push(key);
    if (this.played.length > AUDIO.logSize) this.played.shift();
  }

  /**
   * Starts a buffer on a voice (stealing one if all are busy) and returns it, unconnected, or
   * null when nothing can sound yet (no gesture, muted, or the buffers are still rendering).
   */
  private start(key: string, distanceGain: number, pitch: number): Voice | null {
    const graph = this.graph;
    const buffer = this.buffers.get(key);
    if (graph?.ctx.state !== 'running' || !buffer) return null;
    const now = this.now();
    const voice = graph.voices[pickVoice(graph.voices, now)]!;
    voice.source?.stop();
    voice.source?.disconnect();
    voice.gain.disconnect();
    voice.panner.disconnect();
    const source = graph.ctx.createBufferSource();
    source.buffer = buffer;
    const rate = pitch * (1 + (Math.random() * 2 - 1) * AUDIO.pitchSpread);
    source.playbackRate.value = rate;
    const gain = 1 + (Math.random() * 2 - 1) * AUDIO.gainSpread;
    voice.gain.gain.value = gain;
    source.connect(voice.gain);
    source.start();
    voice.source = source;
    voice.startedAt = now;
    voice.endsAt = now + (buffer.duration / rate) * 1000;
    voice.audibility = gain * distanceGain;
    return voice;
  }
}
