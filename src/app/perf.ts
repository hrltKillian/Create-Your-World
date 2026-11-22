/** Frame statistics: rAF intervals (pacing) and CPU work time per frame (budgets). */

const WINDOW = 240;

export class FrameStats {
  private readonly intervals = new Float64Array(WINDOW);
  private readonly work = new Float64Array(WINDOW);
  private count = 0;
  private cursor = 0;
  private lastFrame = -1;
  private frameStartedAt = 0;
  private readonly spans = new Map<string, Float64Array>();
  private readonly spanCursor = new Map<string, number>();

  /** Call at the very start of the animation-loop callback. */
  frameStart(now: number): void {
    if (this.lastFrame >= 0) {
      this.intervals[this.cursor] = now - this.lastFrame;
    }
    this.lastFrame = now;
    this.frameStartedAt = performance.now();
  }

  private frameCount = 0;

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

  /** Records the time a subsystem took during this frame (ring buffer per name). */
  span(name: string, ms: number): void {
    let buffer = this.spans.get(name);
    if (!buffer) {
      buffer = new Float64Array(WINDOW);
      this.spans.set(name, buffer);
    }
    const cursor = this.spanCursor.get(name) ?? 0;
    buffer[cursor] = ms;
    this.spanCursor.set(name, (cursor + 1) % WINDOW);
  }

  /** p95 of each recorded subsystem span. */
  spanP95(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, buffer] of this.spans) {
      const values = Array.from(buffer)
        .filter((v) => v > 0)
        .sort((a, b) => a - b);
      out[name] = percentile(values, 0.95);
    }
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
