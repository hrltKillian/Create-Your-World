import { clampPitch } from '../core/angles.ts';
import type { Action } from '../input/bindings.ts';
import type { Command } from '../sim/commands.ts';
import type { App } from './App.ts';

/**
 * Automation helpers shared by the debug hook (`window.__game`) and the in-browser selftests:
 * frame and task waits, condition polling, chunk readiness, the debug commands, input, block
 * keys and what the hotbar shows.
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

/** Polls `done` until it holds; throws once `timeoutMs` has passed. */
export async function waitUntil(done: () => boolean, options: WaitOptions): Promise<void> {
  const t0 = performance.now();
  while (!done()) {
    if (performance.now() - t0 > options.timeoutMs)
      throw new Error(`${options.label} after ${options.timeoutMs} ms`);
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
export async function framesFor(ms: number, eachFrame?: () => void): Promise<void> {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    eachFrame?.();
    await frameOrFail();
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

/** Sends a command and applies it now, without a tick (the clock commands). */
export function sendNow(app: App, command: Command): void {
  const session = app.session;
  if (!session) return;
  session.host.send(command);
  session.pumpOnce(false);
}

/** Sets one block from a state key (a one-block `fill`). */
export function setBlock(app: App, x: number, y: number, z: number, state: string): void {
  fill(app, x, y, z, x, y, z, state);
}

/** Text key of the block state at a position (null without a world). */
export function blockKey(app: App, x: number, y: number, z: number): string | null {
  if (!app.world || !app.registry) return null;
  return app.registry.states[app.world.getBlock(x, y, z)]?.key ?? null;
}

/** Holds an action for `ticks` ticks; fixed-step sessions also advance those ticks now. */
export function press(app: App, action: Action, ticks: number): void {
  if (!app.input || !app.session) return;
  app.input.force(action, ticks);
  if (app.params.fixedStep) app.session.step(ticks);
}

/** Gives the player items (what does not fit drops at their feet); fixed-step sessions apply it now. */
export function give(app: App, item: string, count: number): void {
  const session = app.session;
  if (!session) return;
  session.host.send({ type: 'debug.give', item, count });
  if (app.params.fixedStep) session.step(1);
}

/** Sets the view angles (radians; the pitch is clamped like the mouse look). */
export function look(app: App, yaw: number, pitch: number): void {
  const rig = app.session?.rig;
  if (!rig) return;
  rig.yaw = yaw;
  rig.pitch = clampPitch(pitch);
}

/** What the hotbar shows: the selected slot and each slot's count text ('' when none). */
export function hotbarView(app: App): { selected: number; counts: string[] } | null {
  const hotbar = app.inventory?.hotbar;
  if (!hotbar) return null;
  const counts = [...hotbar.element.querySelectorAll('.slot-count')].map(
    (e) => e.textContent ?? '',
  );
  return { selected: hotbar.selected, counts };
}
