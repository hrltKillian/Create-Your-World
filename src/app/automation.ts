import { clampPitch } from '../core/angles.ts';
import type { Action } from '../input/bindings.ts';
import type { Command } from '../sim/commands.ts';
import { serializeInventory } from '../sim/inventory.ts';
import { type DayPhase, daylightAt, dayOf, hourOf, phaseOf } from '../sim/time.ts';
import type { QueueView } from '../ui/screens/logbook.ts';
import { blockOf, skyOf } from '../world/light.ts';
import type { App } from './App.ts';
import { queueView, stationStatus } from './UiBridge.ts';

/**
 * Automation helpers shared by the debug hook (`window.__game`) and the in-browser selftests:
 * frame and task waits, condition polling, chunk readiness, the debug commands, input, block
 * keys and light, the world clock, what the hotbar shows, crafting, block entities (opening one
 * without aiming), clicks and drags on the screens, and saving or reloading the open world.
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
/** Multiplies every waitUntil timeout (the selftest runner stretches waits on slow CI renderers). */
let waitScale = 1;

export function scaleWaits(factor: number): void {
  waitScale = factor;
}

export async function waitUntil(done: () => boolean, options: WaitOptions): Promise<void> {
  const t0 = performance.now();
  const limit = options.timeoutMs * waitScale;
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

/** Sends a command; fixed-step sessions apply it now (one tick). */
function sendAndStep(app: App, command: Command): void {
  const session = app.session;
  if (!session) return;
  session.host.send(command);
  if (app.params.fixedStep) session.step(1);
}

/** Teleports the player (`'surface'` lands on the ground); fixed-step sessions apply it now. */
export function teleport(app: App, x: number, y: number | 'surface', z: number): void {
  sendAndStep(app, { type: 'debug.teleport', x, y, z });
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
  sendAndStep(app, { type: 'debug.fill', x0, y0, z0, x1, y1, z1, state });
}

/** Sends a command and applies it now, without a tick (the clock commands). */
function sendNow(app: App, command: Command): void {
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

/** Sky and block light (0–15 each) at a position (null without a world; unloaded cells are dark). */
export function lightAt(
  app: App,
  x: number,
  y: number,
  z: number,
): { sky: number; block: number } | null {
  if (!app.world) return null;
  const packed = app.world.getLight(Math.floor(x), Math.floor(y), Math.floor(z));
  return { sky: skyOf(packed), block: blockOf(packed) };
}

/** The world clock as automation reads it. */
export interface ClockView {
  readonly ticks: number;
  /** Hour of the day, 0 ≤ hour < 24 (fractional). */
  readonly hour: number;
  /** Day number, 1 on the world's first day. */
  readonly day: number;
  readonly phase: DayPhase;
  /** Sky light factor (`uDaylight`). */
  readonly daylight: number;
  readonly frozen: boolean;
}

/** The world clock (null without a world session). */
export function clock(app: App): ClockView | null {
  const time = app.session?.host.view.time();
  if (!time) return null;
  const hour = hourOf(time.ticks);
  return {
    ticks: time.ticks,
    hour,
    day: dayOf(time.ticks),
    phase: phaseOf(hour),
    daylight: daylightAt(hour),
    frozen: time.frozen,
  };
}

/** Moves the clock to an hour (0 ≤ hours < 24) of the current day, now (`debug.setTime`). */
export function setTime(app: App, hours: number): void {
  sendNow(app, { type: 'debug.setTime', hours });
}

/** Stops or restarts the clock, now (`debug.freezeTime`). */
export function freezeTime(app: App, frozen: boolean): void {
  sendNow(app, { type: 'debug.freezeTime', frozen });
}

/** Holds an action for `ticks` ticks; fixed-step sessions also advance those ticks now. */
export function press(app: App, action: Action, ticks: number): void {
  if (!app.input || !app.session) return;
  app.input.force(action, ticks);
  if (app.params.fixedStep) app.session.step(ticks);
}

/** Gives the player items (what does not fit drops at their feet); fixed-step sessions apply it now. */
export function give(app: App, item: string, count: number): void {
  sendAndStep(app, { type: 'debug.give', item, count });
}

/**
 * Opens the chest or station of a cell as secondary on it does, without aiming (`debug.open`:
 * within 5 blocks, refused unless the world allows debugging); fixed-step sessions apply it now
 * and its screen shows at once.
 */
export function openBlock(app: App, x: number, y: number, z: number): void {
  sendAndStep(app, { type: 'debug.open', x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) });
}

/** Queues `count` crafts of a recipe, as the Logbook's buttons do; fixed-step sessions apply it now. */
export function craft(app: App, recipe: string, count: number): void {
  sendAndStep(app, { type: 'craft.enqueue', recipe, count });
}

/** The player's craft queue as the Logbook shows it, the craft under way first (null: no player). */
export function craftQueue(app: App): QueueView[] | null {
  const session = app.session;
  if (!session) return null;
  return session.player.craft.map((entry) => queueView(session.host.view.registry, entry));
}

/**
 * What the block entity of a cell holds: a chest's slots, or a station's (inputs, fuel, outputs)
 * with its flame, progress and process. Null when the cell has none (a generated chest gets one
 * when it is first opened).
 */
export function blockEntityContents(app: App, x: number, y: number, z: number) {
  const view = app.session?.host.view;
  const entity = view?.blockEntity(Math.floor(x), Math.floor(y), Math.floor(z));
  if (!view || !entity) return null;
  const slots = serializeInventory(entity.slots);
  if (entity.kind !== 'station') return { kind: entity.kind, slots };
  return {
    kind: entity.kind,
    station: entity.station,
    slots,
    ...stationStatus(view.registry, entity),
  };
}

/** Clicks the first element a selector matches; returns false when none does or it is disabled. */
export function click(selector: string): boolean {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element || (element instanceof HTMLButtonElement && element.disabled)) return false;
  element.click();
  return true;
}

/** The middle of an element in the viewport (scrolled into view first). */
function middleOf(element: Element): { clientX: number; clientY: number } {
  element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const box = element.getBoundingClientRect();
  return { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
}

/**
 * Drags the stack of one slot onto another on the open slot screen (Bag, Container, Station) as
 * the mouse does: pointer down on the source, moved and released over the target, which the
 * screen finds under the pointer. Slots are numbered as in `[data-slot]` (0–31 the inventory, 32+
 * the open chest or station, or the Bag's worn items). Returns false (the drag cancelled) when a
 * slot is missing or covered.
 */
export function dragSlot(from: number, to: number): boolean {
  const screen = document.querySelector<HTMLElement>('.screen-slots:not([hidden])');
  const source = screen?.querySelector(`[data-slot="${from}"]`);
  const target = screen?.querySelector(`[data-slot="${to}"]`);
  if (!screen || !source || !target) return false;
  // The mouse's pointer id (1 in Chrome) is always active, so the screen may capture it.
  const mouse = { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 };
  source.dispatchEvent(
    new PointerEvent('pointerdown', { ...mouse, ...middleOf(source), buttons: 1 }),
  );
  const end = middleOf(target);
  const under = document.elementFromPoint(end.clientX, end.clientY)?.closest('[data-slot]');
  if (under !== target) {
    screen.dispatchEvent(new PointerEvent('pointercancel', { ...mouse, ...end }));
    return false;
  }
  screen.dispatchEvent(new PointerEvent('pointermove', { ...mouse, ...end, buttons: 1 }));
  screen.dispatchEvent(new PointerEvent('pointerup', { ...mouse, ...end, buttons: 0 }));
  return true;
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

/** Saves the open world now, like an autosave (deflated, one transaction); resolves with success. */
export function saveNow(app: App): Promise<boolean> {
  const saves = app.game?.open?.saves;
  return saves ? saves.save() : Promise.reject(new Error('No open world'));
}

/** Longest wait for a reopened world's loading radius to be meshed. */
const RELOAD_MS = 30_000;

/**
 * Saves and closes the open world (the pause menu's Save & quit), then opens it again from its
 * records; resolves once the loading radius around the player is meshed.
 */
export async function reloadWorld(app: App): Promise<void> {
  const game = app.game;
  const id = game?.open?.info.id;
  if (!game || !id) throw new Error('No open world');
  if (game.state !== 'paused') game.pause();
  if (!(await game.saveAndQuit()))
    throw new Error(`Save & quit of world ${id} failed (state ${game.state})`);
  await game.openWorld(id);
  const session = app.session;
  if (!session) throw new Error(`World ${id} did not open again (state ${game.state})`);
  await waitForChunks(app, session.loadingRadius(), RELOAD_MS);
  // The frame loop leaves the loading state on its next frame (there is none in a hidden page).
  if (!document.hidden) await frameOrFail();
}
