import type { App } from './App.ts';

/**
 * Waits of the automation (the debug hook and the selftests): frames, tasks, polled conditions
 * (stretched by `scaleWaits` under `?timing=0`) and the chunks around the player.
 */

/** Resolves on the next animation frame (never while the page is hidden). */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Longest wait for one animation frame before a frame wait gives up. */
const FRAME_TIMEOUT_MS = 3000;

/** The next animation frame; rejects (instead of hanging) when frames stop, as in a hidden pane. */
export function frameOrFail(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new Error(`no animation frame for ${FRAME_TIMEOUT_MS} ms (is the page hidden?)`)),
      FRAME_TIMEOUT_MS,
    );
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Renders up to `frames` frames until `done` holds; returns whether it held. */
export async function withinFrames(frames: number, done: () => boolean): Promise<boolean> {
  for (let i = 0; i < frames; i++) {
    if (done()) return true;
    await frameOrFail();
  }
  return done();
}

/** Yields to the event loop without timer throttling (works in hidden or background panes). */
export function yieldTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });
}

export interface WaitOptions {
  readonly timeoutMs: number;
  /** Start of the timeout error: "<label> after <timeoutMs> ms". */
  readonly label: string;
  /** Called after every poll, for example to step the world when frames do not. */
  readonly pump?: () => void;
  /** Wall time between polls while the page is visible (hidden pages poll between tasks). */
  readonly pollMs?: number;
}

/** No frame for this long means the animation loop is stalled (hidden or throttled pane). */
const STALL_MS = 50;

/** Multiplies every waitUntil timeout (the selftest runner stretches waits on slow CI renderers). */
let waitScale = 1;

export function scaleWaits(factor: number): void {
  waitScale = factor;
}

/** A wait's limit (ms) stretched like every other wait (×4 on slow CI renderers). */
export function scaledWait(ms: number): number {
  return ms * waitScale;
}

/** Polls `done` until it holds; throws once `timeoutMs` (times the wait scale) has passed. */
export async function waitUntil(done: () => boolean, options: WaitOptions): Promise<void> {
  const t0 = performance.now();
  const limit = scaledWait(options.timeoutMs);
  while (!done()) {
    if (performance.now() - t0 > limit) throw new Error(`${options.label} after ${limit} ms`);
    // Timers are throttled in hidden pages: only sleep while visible.
    if (options.pollMs && !document.hidden)
      await new Promise((resolve) => setTimeout(resolve, options.pollMs));
    else await yieldTask();
    options.pump?.();
  }
}

/**
 * Waits until every column within `radius` of the focus is meshed, loading through the normal
 * frame loop. Only when the page is hidden or no frame has rendered for STALL_MS does it step the
 * world itself, so automation still works in a hidden pane without racing the real loading.
 */
export async function waitForChunks(app: App, radius: number, timeoutMs: number): Promise<void> {
  const session = app.session;
  if (!session) throw new Error('No world session');
  let frames = app.frames.frameTotal();
  let lastFrameAt = performance.now();
  await waitUntil(() => session.chunksReady(radius), {
    timeoutMs,
    label: `radius ${radius} not meshed`,
    pump: () => {
      const now = performance.now();
      if (app.frames.frameTotal() !== frames) {
        frames = app.frames.frameTotal();
        lastFrameAt = now;
      } else if (document.hidden || now - lastFrameAt > STALL_MS) {
        // Tick only when the page is hidden; a slow visible page keeps its own 30 Hz clock.
        session.pumpOnce(document.hidden);
      }
    },
  });
}

/** Renders frames for `ms` of wall time, calling `eachFrame` before each one; fails if frames stop. */
export async function framesFor(ms: number, eachFrame?: () => void, minFrames = 0): Promise<void> {
  const t0 = performance.now();
  // At least `minFrames` frames too: on a slow renderer a few frames may span the whole time.
  for (let frames = 0; performance.now() - t0 < ms || frames < minFrames; frames++) {
    eachFrame?.();
    await frameOrFail();
  }
}
