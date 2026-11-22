import type { App } from './App.ts';

/**
 * Automation helpers shared by the debug hook (`window.__game`) and the in-browser selftests:
 * frame and task waits, condition polling, chunk readiness, and the debug commands.
 */

/** Resolves on the next animation frame (never while the page is hidden). */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
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
  /** Called after every yield, for example to step the world when frames do not. */
  readonly pump?: () => void;
}

/** Polls `done` between event-loop tasks until it holds; throws once `timeoutMs` has passed. */
export async function waitUntil(done: () => boolean, options: WaitOptions): Promise<void> {
  const t0 = performance.now();
  while (!done()) {
    if (performance.now() - t0 > options.timeoutMs)
      throw new Error(`${options.label} after ${options.timeoutMs} ms`);
    await yieldTask();
    options.pump?.();
  }
}

/**
 * Waits until every column within `radius` of the focus is meshed. While the page is hidden or
 * the animation loop stalls, it steps the world itself so automation keeps working.
 */
export async function waitForChunks(app: App, radius: number, timeoutMs: number): Promise<void> {
  const session = app.session;
  if (!session) throw new Error('No world session');
  let frames = app.frames.frameTotal();
  await waitUntil(() => session.chunksReady(radius), {
    timeoutMs,
    label: `radius ${radius} not meshed`,
    pump: () => {
      if (document.hidden || app.frames.frameTotal() === frames) session.pumpOnce();
      frames = app.frames.frameTotal();
    },
  });
}

/** Renders frames for `ms` of wall time, calling `eachFrame` before each one. */
export async function framesFor(ms: number, eachFrame?: () => void): Promise<void> {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    eachFrame?.();
    await nextFrame();
  }
}

/** Teleports the player (`'surface'` lands on the ground); fixed-step sessions apply it now. */
export function teleport(app: App, x: number, y: number | 'surface', z: number): void {
  const session = app.session;
  if (!session) return;
  session.host.send({ type: 'debug.teleport', x, y, z });
  if (app.params.fixedStep) session.step(1);
}

/** Fills a box (inclusive corners) with a block state key; fixed-step sessions apply it now. */
export function fill(
  app: App,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  state: string,
): void {
  const session = app.session;
  if (!session) return;
  session.host.send({ type: 'debug.fill', x0, y0, z0, x1, y1, z1, state });
  if (app.params.fixedStep) session.step(1);
}
