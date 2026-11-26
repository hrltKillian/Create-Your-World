import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrameSampler } from '../../../src/app/bench/sampler.ts';
import { FrameStats, type SessionSpans, SPANS } from '../../../src/app/perf.ts';

/** Runs frames on a fake clock: each starts every `interval` ms and works `work` ms. */
function frames(stats: FrameStats, works: readonly number[], interval = 16) {
  let now = 1000;
  const clock = vi.spyOn(performance, 'now');
  for (const work of works) {
    clock.mockReturnValue(now);
    stats.frameStart(now);
    clock.mockReturnValue(now + work);
    stats.frameEnd();
    now += interval;
  }
}

const session = (ms: number): SessionSpans => ({
  input: ms,
  sim: 2 * ms,
  stream: 0,
  mesh: 3 * ms,
  upload: ms,
  entities: ms,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('frame statistics', () => {
  it('knows the last frame: its work and the interval before it', () => {
    const stats = new FrameStats();
    expect(stats.lastWork()).toBe(0);
    frames(stats, [3, 5, 7], 20);
    expect(stats.lastWork()).toBe(7);
    expect(stats.lastInterval()).toBe(20);
    expect(stats.frameTotal()).toBe(3);
    // After a hidden tab, the first interval is unknown.
    stats.resetClock();
    frames(stats, [4]);
    expect(stats.lastInterval()).toBe(0);
  });

  it('times every subsystem of a frame of play; the open world’s rest is the UI', () => {
    const stats = new FrameStats();
    for (let i = 1; i <= 20; i++) stats.playSpans(session(i * 0.1), 10 * i * 0.1, i * 0.2);
    // 20 frames: the p95 is the 19th smallest.
    const p95 = stats.spanP95();
    expect(p95.sim).toBeCloseTo(2 * 1.9);
    expect(p95.render).toBeCloseTo(0.2 * 19);
    // The session's spans add up to 8 × of 10 ×: the other 2 × were the HUD and the screens.
    expect(p95.ui).toBeCloseTo(2 * 1.9);
    // Zeros are left out: a span that never took time (streaming happens while loading) is 0.
    expect(p95.stream).toBe(0);
    expect(stats.lastSpan('mesh')).toBeCloseTo(3 * 2);
    expect(stats.lastSpan('upload')).toBeCloseTo(2);
  });
});

describe('benchmark frame sampler', () => {
  it('reports work p95, intervals over 20 ms, the busiest frame’s draws and span p95', () => {
    const sampler = new FrameSampler(1);
    const spans: Record<string, number> = Object.fromEntries(SPANS.map((s) => [s, 0]));
    for (let i = 1; i <= 40; i++) {
      spans.render = i / 10;
      const source = {
        lastWork: () => i / 4,
        // The first interval after a pause is unknown (0); every tenth frame is late.
        lastInterval: () => (i === 1 ? 0 : i % 10 === 0 ? 34 : 16.7),
        lastSpan: (name: (typeof SPANS)[number]) => spans[name]!,
      };
      sampler.sample(source, { calls: 100 + (i % 7), triangles: 1000 * i });
    }
    const result = sampler.result();
    expect(result.frames).toBe(40);
    expect(result.workP95).toBe(38 / 4);
    expect(result.workMax).toBe(10);
    expect(result.longFrames).toBeCloseTo(4 / 39);
    expect(result.maxInterval).toBe(34);
    expect(result.draws).toBe(106);
    expect(result.triangles).toBe(40_000);
    expect(result.spans.render).toBeCloseTo(3.8);
    expect(result.spans.sim).toBe(0);
  });

  it('keeps to the room it was sized for', () => {
    const sampler = new FrameSampler(0);
    const source = { lastWork: () => 1, lastInterval: () => 16, lastSpan: () => 0 };
    for (let i = 0; i < 100; i++) sampler.sample(source, { calls: 1, triangles: 1 });
    expect(sampler.result().frames).toBe(16);
  });
});
