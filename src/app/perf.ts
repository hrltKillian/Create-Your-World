/** Frame statistics: rAF intervals (pacing), CPU work time per frame and per subsystem (budgets). */

const WINDOW = 240;

/** Subsystems timed every frame of play (docs « Budgets du thread principal par image »). */
export const SPANS = [
  'input',
  'sim',
  'stream',
  'mesh',
  'upload',
  'entities',
  'ui',
  'render',
] as const;
export type SpanName = (typeof SPANS)[number];

/**
 * The play session's share of one frame, in ms, written as it runs: input (mouse look, actions),
 * sim (ticks), stream (world pumping while loading or in fixed steps), mesh (tick events, padded
 * copies and mesh jobs), upload (finished meshes to the GPU), entities (camera, aim, play view).
 */
export type SessionSpans = Record<Exclude<SpanName, 'ui' | 'render'>, number>;

const SPAN_INDEX = Object.fromEntries(SPANS.map((name, i) => [name, i])) as Record<
  SpanName,
  number
>;

export class FrameStats {
  private readonly intervals = new Float64Array(WINDOW);
  private readonly work = new Float64Array(WINDOW);
  private count = 0;
  private cursor = 0;
  private lastFrame = -1;
  private frameStartedAt = 0;
  private frameCount = 0;
  /** One ring of WINDOW values per span, and each ring's cursor. */
  private readonly spans = new Float64Array(WINDOW * SPANS.length);
  private readonly spanCursor = new Int32Array(SPANS.length);
  private readonly spanSeen = new Uint8Array(SPANS.length);

  /** Call at the very start of the animation-loop callback. */
  frameStart(now: number): void {
    // 0 (left out) after a reset: the slot must not keep the interval of WINDOW frames ago.
    this.intervals[this.cursor] = this.lastFrame >= 0 ? now - this.lastFrame : 0;
    this.lastFrame = now;
    this.frameStartedAt = performance.now();
  }

  /** Frames completed so far (automation uses it to detect a throttled animation loop). */
  frameTotal(): number {
    return this.frameCount;
  }

  /** Call at the very end of the animation-loop callback. */
  frameEnd(): void {
    this.frameCount++;
    this.work[this.cursor] = performance.now() - this.frameStartedAt;
    this.cursor = (this.cursor + 1) % WINDOW;
    this.count = Math.min(WINDOW, this.count + 1);
  }

  /** CPU work (ms) of the last completed frame (0 before the first). */
  lastWork(): number {
    return this.count > 0 ? this.work[(this.cursor + WINDOW - 1) % WINDOW]! : 0;
  }

  /** rAF interval (ms) before the last completed frame (0 when unknown). */
  lastInterval(): number {
    return this.count > 0 ? this.intervals[(this.cursor + WINDOW - 1) % WINDOW]! : 0;
  }

  /** A span's time (ms) in the last frame that recorded it (0 before any). */
  lastSpan(name: SpanName): number {
    const i = SPAN_INDEX[name];
    return this.spans[i * WINDOW + ((this.spanCursor[i]! + WINDOW - 1) % WINDOW)]!;
  }

  /** Records the time a subsystem took during this frame (one ring buffer per span). */
  span(name: SpanName, ms: number): void {
    const i = SPAN_INDEX[name];
    const cursor = this.spanCursor[i]!;
    this.spans[i * WINDOW + cursor] = ms;
    this.spanCursor[i] = (cursor + 1) % WINDOW;
    this.spanSeen[i] = 1;
  }

  /**
   * The spans of one frame of play: the session's, the rest of the open world's frame (`ui`: the
   * HUD and the slot screens; `worldMs` is the whole of it) and the world view's (`render`).
   */
  playSpans(session: Readonly<SessionSpans>, worldMs: number, renderMs: number): void {
    const own =
      session.input +
      session.sim +
      session.stream +
      session.mesh +
      session.upload +
      session.entities;
    this.span('input', session.input);
    this.span('sim', session.sim);
    this.span('stream', session.stream);
    this.span('mesh', session.mesh);
    this.span('upload', session.upload);
    this.span('entities', session.entities);
    this.span('ui', Math.max(0, worldMs - own));
    this.span('render', renderMs);
  }

  /** p95 of each recorded span, over the frames where it took time (zeros left out). */
  spanP95(): Partial<Record<SpanName, number>> {
    const out: Partial<Record<SpanName, number>> = {};
    SPANS.forEach((name, i) => {
      if (!this.spanSeen[i]) return;
      const values = Array.from(this.spans.subarray(i * WINDOW, (i + 1) * WINDOW))
        .filter((v) => v > 0)
        .sort((a, b) => a - b);
      out[name] = percentile(values, 0.95);
    });
    return out;
  }

  /** Resets the interval baseline (after a hidden tab or a pause). */
  resetClock(): void {
    this.lastFrame = -1;
  }

  fps(): number {
    const samples = this.samples(this.intervals);
    if (samples.length === 0) return 0;
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    return mean > 0 ? 1000 / mean : 0;
  }

  snapshot(): { fps: number; workP95: number; workMax: number; longFrames: number } {
    const work = this.samples(this.work).sort((a, b) => a - b);
    const intervals = this.samples(this.intervals);
    return {
      fps: this.fps(),
      workP95: percentile(work, 0.95),
      workMax: work.length ? work[work.length - 1]! : 0,
      longFrames: intervals.length ? intervals.filter((v) => v > 20).length / intervals.length : 0,
    };
  }

  private samples(buffer: Float64Array): number[] {
    const n = this.count;
    const result: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = buffer[i]!;
      if (v > 0) result.push(v);
    }
    return result;
  }
}

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index]!;
}
