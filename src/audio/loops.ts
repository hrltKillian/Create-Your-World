import { renderSfx } from '../assets/procedural/sfxSynth.ts';
import type { SfxDef } from '../content/schema.ts';

/** Seconds of a loop's rendered end blended into its start (the loop plays that much shorter). */
export const LOOP_OVERLAP = 0.5;

/**
 * A seamless loop from samples rendered `overlap` samples longer: the last `overlap` samples fade
 * out over the first ones fading in, so the loop's last sample runs straight into its first. The
 * blend keeps the power (√t, √(1 − t)): the beds are noise, whose two ends are unrelated.
 */
export function seamless(
  samples: Float32Array<ArrayBuffer>,
  overlap: number,
): Float32Array<ArrayBuffer> {
  const length = samples.length - overlap;
  const out = samples.slice(0, length);
  for (let i = 0; i < overlap; i++) {
    const t = i / overlap;
    out[i] = samples[i]! * Math.sqrt(t) + samples[length + i]! * Math.sqrt(1 - t);
  }
  return out;
}

/** A loop the ambience asked for: its gain and, once it sounds, its nodes. */
interface Loop {
  gain: number;
  source: AudioBufferSourceNode | null;
  level: GainNode | null;
}

/** One loop as automation reads it. */
export interface LoopView {
  readonly key: string;
  readonly gain: number;
}

/**
 * The looped recipes (the ambience) and the ones sounding: each is rendered on its first use
 * (not at startup: they are long) and wrapped without a seam, then played looped on the ambience
 * bus at the gain it is given.
 */
export class LoopBank {
  private readonly defs = new Map<string, SfxDef>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly rendering = new Set<string>();
  private readonly loops = new Map<string, Loop>();

  constructor(defs: readonly SfxDef[]) {
    for (const def of defs) if (def.loop) this.defs.set(def.key, def);
  }

  /**
   * Sets a loop's gain (0 stops it); returns true when the loop was not playing before. It sounds
   * once the context runs and its buffer is rendered (asked for here), until then it only counts.
   */
  set(key: string, gain: number, ctx: AudioContext | null, bus: AudioNode | null): boolean {
    let loop = this.loops.get(key);
    if (gain <= 0) {
      if (loop) stop(loop);
      this.loops.delete(key);
      return false;
    }
    const started = !loop;
    if (!loop) {
      loop = { gain, source: null, level: null };
      this.loops.set(key, loop);
    }
    loop.gain = gain;
    if (!loop.source && ctx?.state === 'running' && bus) this.start(key, loop, ctx, bus);
    if (loop.level) loop.level.gain.value = gain;
    return started;
  }

  /** The loops asked for, with their gains (sounding or not yet). */
  list(): LoopView[] {
    return [...this.loops].map(([key, loop]) => ({ key, gain: loop.gain }));
  }

  private start(key: string, loop: Loop, ctx: AudioContext, bus: AudioNode): void {
    const buffer = this.buffers.get(key);
    if (!buffer) {
      this.render(key);
      return;
    }
    const level = ctx.createGain();
    level.connect(bus);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(level);
    source.start();
    loop.source = source;
    loop.level = level;
  }

  /** Renders a loop once, in the background (a failure reaches the page's error log). */
  private render(key: string): void {
    const def = this.defs.get(key);
    if (!def || this.rendering.has(key)) return;
    this.rendering.add(key);
    void renderSfx(def).then((rendered) => {
      const { sampleRate } = rendered;
      const overlap = Math.min(Math.round(LOOP_OVERLAP * sampleRate), rendered.length >> 1);
      const samples = seamless(rendered.getChannelData(0), overlap);
      const buffer = new AudioBuffer({ length: samples.length, sampleRate });
      buffer.copyToChannel(samples, 0);
      this.buffers.set(key, buffer);
    });
  }
}

function stop(loop: Loop): void {
  loop.source?.stop();
  loop.source?.disconnect();
  loop.level?.disconnect();
}
