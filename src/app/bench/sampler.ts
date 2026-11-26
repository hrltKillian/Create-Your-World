import type { App } from '../App.ts';
import { frameOrFail } from '../automation.ts';
import { type FrameStats, percentile, SPANS, type SpanName } from '../perf.ts';

/**
 * Per-frame samples of a frame benchmark (docs « Mesure de performance »): the CPU work of each
 * frame, its rAF interval, its draws and triangles, and its time per subsystem.
 */

/** rAF intervals over this count against regularity (« part des intervalles > 20 ms »). */
export const LONG_INTERVAL_MS = 20;
/** Highest frame rate a run is sized for (its arrays never grow). */
const MAX_FPS = 250;

export interface FrameResult {
  readonly frames: number;
  /** CPU work of a frame, p95 and max (ms). */
  readonly workP95: number;
  readonly workMax: number;
  /** Share of the rAF intervals over LONG_INTERVAL_MS, and the longest one (ms). */
  readonly longFrames: number;
  readonly maxInterval: number;
  /** Most draws and triangles in one frame. */
  readonly draws: number;
  readonly triangles: number;
  /** Draws a frame on average. */
  readonly meanDraws: number;
  /** p95 of each subsystem's time (ms; docs « Budgets du thread principal par image »). */
  readonly spans: Readonly<Record<SpanName, number>>;
}

/** What a sample reads: the frame statistics and the renderer's counters of the last frame. */
export type FrameSource = Pick<FrameStats, 'lastWork' | 'lastInterval' | 'lastSpan'>;
export interface RenderCounters {
  readonly calls: number;
  readonly triangles: number;
}

export class FrameSampler {
  private readonly capacity: number;
  private readonly work: Float64Array;
  private readonly intervals: Float64Array;
  private readonly draws: Float64Array;
  private readonly triangles: Float64Array;
  /** One row of `capacity` values per span. */
  private readonly spans: Float64Array;
  private count = 0;

  /** Room for a run of `seconds`. */
  constructor(seconds: number) {
    this.capacity = Math.ceil(seconds * MAX_FPS) + 16;
    this.work = new Float64Array(this.capacity);
    this.intervals = new Float64Array(this.capacity);
    this.draws = new Float64Array(this.capacity);
    this.triangles = new Float64Array(this.capacity);
    this.spans = new Float64Array(this.capacity * SPANS.length);
  }

  /** Records the last completed frame (ignored once the run's room is full). */
  sample(frames: FrameSource, render: RenderCounters): void {
    const n = this.count;
    if (n >= this.capacity) return;
    this.work[n] = frames.lastWork();
    this.intervals[n] = frames.lastInterval();
    this.draws[n] = render.calls;
    this.triangles[n] = render.triangles;
    for (let s = 0; s < SPANS.length; s++)
      this.spans[s * this.capacity + n] = frames.lastSpan(SPANS[s]!);
    this.count = n + 1;
  }

  result(): FrameResult {
    const n = this.count;
    const work = sorted(this.work.subarray(0, n));
    // The first interval after a pause is unknown (0): left out.
    const intervals = Array.from(this.intervals.subarray(0, n)).filter((v) => v > 0);
    const spans = {} as Record<SpanName, number>;
    SPANS.forEach((name, s) => {
      const row = this.spans.subarray(s * this.capacity, s * this.capacity + n);
      spans[name] = percentile(sorted(row), 0.95);
    });
    return {
      frames: n,
      workP95: percentile(work, 0.95),
      workMax: work.at(-1) ?? 0,
      longFrames: intervals.length
        ? intervals.filter((v) => v > LONG_INTERVAL_MS).length / intervals.length
        : 0,
      maxInterval: Math.max(0, ...intervals),
      draws: Math.max(0, ...this.draws.subarray(0, n)),
      triangles: Math.max(0, ...this.triangles.subarray(0, n)),
      meanDraws: n ? this.draws.subarray(0, n).reduce((a, b) => a + b, 0) / n : 0,
      spans,
    };
  }
}

function sorted(values: Float64Array): number[] {
  return Array.from(values).sort((a, b) => a - b);
}

/**
 * Renders frames for `seconds` of wall time (the pane must be visible) and samples each one;
 * `eachFrame` runs before each frame with the seconds since the start (the scripted motion).
 */
export async function sampleFrames(
  app: App,
  seconds: number,
  eachFrame?: (t: number) => void,
): Promise<FrameResult> {
  const renderer = app.renderer;
  if (!renderer) throw new Error('No renderer');
  const sampler = new FrameSampler(seconds);
  const t0 = performance.now();
  eachFrame?.(0);
  // The first frame carries the set-up's work: sampling starts with the second one.
  await frameOrFail();
  for (;;) {
    await frameOrFail();
    sampler.sample(app.frames, renderer.webgl.info.render);
    const t = (performance.now() - t0) / 1000;
    if (t >= seconds) return sampler.result();
    eachFrame?.(t);
  }
}
