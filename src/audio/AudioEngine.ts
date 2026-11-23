import { renderSfx } from '../assets/procedural/sfxSynth.ts';
import type { SfxDef } from '../content/schema.ts';
import { lookVector, type Vec3 } from '../core/angles.ts';

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

/** What voice stealing needs to know about a voice. */
export interface VoiceSlot {
  /** Clock time (ms) the voice started and the time its sound ends. */
  startedAt: number;
  endsAt: number;
  /** Gain × distance attenuation when it started. */
  audibility: number;
}

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

interface Voice extends VoiceSlot {
  source: AudioBufferSourceNode | null;
  readonly gain: GainNode;
  readonly panner: PannerNode;
}

interface Graph {
  readonly ctx: AudioContext;
  readonly sfx: GainNode;
  readonly ui: GainNode;
  readonly voices: Voice[];
}

export interface AudioOptions {
  /** `?mute=1`: no AudioContext at all; plays are still logged. */
  readonly muted: boolean;
  /** Clock in ms (tests). */
  readonly now?: () => number;
}

/**
 * The game's sound player: one AudioContext (created on the first user gesture), recipes
 * pre-rendered once, 24 voices with stealing, a linear equal-power panner per voice and the
 * sfx / ui buses into a master gain and a compressor. Every accepted play is logged for tests,
 * even before the context runs or when muted.
 */
export class AudioEngine {
  private readonly recipes: readonly SfxDef[];
  private readonly muted: boolean;
  private readonly now: () => number;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly lastStart = new Map<string, number>();
  private readonly played: string[] = [];
  private graph: Graph | null = null;
  private readonly ear: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly forward: Vec3 = { x: 0, y: 0, z: -1 };

  constructor(recipes: readonly SfxDef[], options: AudioOptions) {
    this.recipes = recipes;
    this.muted = options.muted;
    this.now = options.now ?? (() => performance.now());
  }

  /** Renders every recipe into a buffer (OfflineAudioContext); needs no user gesture. */
  async prerender(): Promise<void> {
    if (this.muted) return;
    // One after the other: a few milliseconds each, and no burst of offline contexts.
    for (const def of this.recipes) this.buffers.set(def.key, await renderSfx(def));
  }

  /** Creates or resumes the AudioContext. Call it from a user gesture (a click). */
  resume(): void {
    if (this.muted) return;
    this.graph ??= createGraph();
    if (this.graph.ctx.state === 'suspended') void this.graph.ctx.resume();
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

  /** Plays an interface sound (ui bus, not positioned). False for a duplicate. */
  playUi(key: string, pitch = 1): boolean {
    if (!this.accept(key)) return false;
    const voice = this.start(key, 1, pitch);
    if (voice) voice.gain.connect(this.graph!.ui);
    return true;
  }

  /** Keys of the last sounds played, oldest first. */
  log(): string[] {
    return [...this.played];
  }

  /** De-duplicates and logs a play. */
  private accept(key: string): boolean {
    const now = this.now();
    const last = this.lastStart.get(key);
    if (last !== undefined && now - last < AUDIO.dedupMs) return false;
    this.lastStart.set(key, now);
    this.played.push(key);
    if (this.played.length > AUDIO.logSize) this.played.shift();
    return true;
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

/** The context, its buses (sfx and ui → master → compressor) and the voices' nodes. */
function createGraph(): Graph {
  const ctx = new AudioContext();
  const compressor = ctx.createDynamicsCompressor();
  compressor.connect(ctx.destination);
  const master = ctx.createGain();
  master.connect(compressor);
  const sfx = ctx.createGain();
  const ui = ctx.createGain();
  sfx.connect(master);
  ui.connect(master);
  const voices: Voice[] = [];
  for (let i = 0; i < AUDIO.voices; i++) {
    const panner = new PannerNode(ctx, {
      panningModel: 'equalpower',
      distanceModel: 'linear',
      refDistance: AUDIO.near,
      maxDistance: AUDIO.far,
      rolloffFactor: 1,
    });
    voices.push({
      source: null,
      gain: ctx.createGain(),
      panner,
      startedAt: 0,
      endsAt: 0,
      audibility: 0,
    });
  }
  return { ctx, sfx, ui, voices };
}
