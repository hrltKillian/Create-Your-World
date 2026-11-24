import { i18nMissing } from '../../i18n/i18n.ts';
import type { Inventory } from '../../sim/inventory.ts';
import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import type { App } from '../App.ts';
import {
  type ClockView,
  clock,
  frameOrFail,
  framesFor,
  freezeTime,
  look,
  setTime,
  teleport,
  waitForChunks,
  waitUntil,
} from '../automation.ts';

/** Shared pieces of the in-browser selftest suites. */

/** The app states of a play session (the player cases wait out the loading screen). */
export const PLAY_SCENES: readonly App['state'][] = ['loading', 'world'];

export interface SelftestCase {
  readonly name: string;
  /** Only meaningful in these app states (others report the case as skipped). */
  readonly scenes?: readonly App['state'][];
  /** Overrides the runner's default per-case timeout (ms). */
  readonly timeoutMs?: number;
  /** Returns a reason to skip the case in this setup (for example "needs ?fixedStep=1"). */
  skip?(app: App): string | null;
  run(app: App): Promise<void> | void;
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * A wall-clock threshold. Timing is measured locally (CLAUDE.md: perf only on a real GPU); slow CI
 * runners with software rendering pass ?timing=0, which keeps the functional checks only.
 */
/** Waits and timeouts stretch on slow CI renderers (?timing=0). */
export function slowFactor(app: App): number {
  return app.params.timing ? 1 : 4;
}

export function assertTiming(app: App, condition: boolean, message: string): void {
  if (app.params.timing) assert(condition, message);
}

/** The closing case of every suite: no captured error and no missing UI string. */
export function noErrorsCase(name: string): SelftestCase {
  return {
    name,
    run: (app) => {
      assert(app.errors.length === 0, `errors: ${app.errors.join(' | ')}`);
      assert(i18nMissing().length === 0, `missing strings: ${i18nMissing().join(', ')}`);
    },
  };
}

/**
 * The player checks need a player (no free camera), fixed steps (teleport, fill and give then
 * apply at once) and a test world: flat (m3, m4, m5, m7) or the arena (m8); and no natural spawns
 * (creatures would join in), except the spawn checks of m10, which need them.
 */
function needsTestPlayer(app: App, worldType: 'flat' | 'arena', spawns = false): string | null {
  if (app.params.freecam) return 'needs a player (no ?freecam)';
  if (!app.params.fixedStep) return 'needs ?fixedStep=1';
  if (app.params.worldType !== worldType) return `needs ?worldType=${worldType}`;
  if (Boolean(app.params.spawns) !== spawns)
    return spawns ? 'needs ?spawns=1' : 'natural spawns would join in (without ?spawns=1)';
  return null;
}

export function needsFlatPlayer(app: App): string | null {
  return needsTestPlayer(app, 'flat');
}

/** The spawn checks (m10): the flat world, fixed steps, natural spawns from the first tick. */
export function needsSpawningFlatPlayer(app: App): string | null {
  return needsTestPlayer(app, 'flat', true) ?? (app.params.grace === 0 ? null : 'needs ?grace=0');
}

export function needsArenaPlayer(app: App): string | null {
  return needsTestPlayer(app, 'arena');
}

/** The cases that save and reload (m7, m8) need their saves in IndexedDB. */
export function needsIdb(app: App): string | null {
  if (app.params.storage !== 'idb') return 'needs ?storage=idb';
  if (app.game?.backend.unavailable) return 'IndexedDB is unavailable (?forceNoIdb=1 or blocked)';
  return null;
}

/** The streaming checks (m2) need the default world (not flat or arena), from any camera. */
export function needsGeneratedWorld(app: App): string | null {
  return app.params.worldType === 'default'
    ? null
    : `needs the generated world (not ?worldType=${app.params.worldType})`;
}

/** The generated-world checks (m9, m11) need a player in the default world. */
export function needsGeneratedPlayer(app: App): string | null {
  return app.params.freecam ? 'needs a player (no ?freecam)' : needsGeneratedWorld(app);
}

/** The checks that wait in wall time (m6, M11 performance) need real ticks. */
export function needsRealTimeGeneratedPlayer(app: App): string | null {
  return (
    needsGeneratedPlayer(app) ?? (app.params.fixedStep ? 'needs real ticks (no ?fixedStep)' : null)
  );
}

/**
 * « Reasonable » search radius from the spawn (m6, m9): probing 170 seeds, every biome and a
 * structure lie within 700 blocks (the spawn rule puts the dangerous biomes within 1 000).
 */
export const SEARCH_RADIUS = 1500;

/** Wall time for the camera and the frame loop to settle after a teleport or a view switch. */
export const SETTLE_MS = 300;

/** The play session once the loading radius around the player is meshed. */
export async function playerSession(app: App) {
  await app.ready();
  const session = app.session;
  assert(session && app.input, 'no player session');
  await chunksMeshed(app, session.loadingRadius(), 25_000);
  return session;
}

/** Waits until `radius` is meshed around the player, then for one more frame. */
export async function chunksMeshed(app: App, radius: number, timeoutMs: number): Promise<void> {
  await waitForChunks(app, radius, timeoutMs);
  await frameOrFail();
}

/**
 * Puts the player's feet in the middle of a column at `y` (by default on the flat surface), at
 * rest, and renders a frame (eye, aim, ear).
 */
export async function standAt(
  app: App,
  spot: { x: number; z: number },
  y = FLAT_SURFACE + 1,
): Promise<void> {
  teleport(app, spot.x + 0.5, y, spot.z + 0.5);
  app.session!.step(5);
  await frameOrFail();
}

export interface Cell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The pack's arena description (the arena world is built from it; other suites use its blocks). */
export function arenaOf(app: App) {
  const arena = app.registry!.pack.arena;
  assert(arena, 'the content pack has no arena');
  return arena;
}

/** The slots of a cell's block entity (a chest, a station; empty when it has none). */
export function slotsAt(app: App, cell: Cell): Inventory {
  return app.session!.host.view.blockEntity(cell.x, cell.y, cell.z)?.slots ?? [];
}

/** Turns the view (yaw, pitch) from the rig's eye towards a point. */
function turnTo(app: App, x: number, y: number, z: number): void {
  const eye = app.session!.rig.eye;
  const dx = x - eye.x;
  const dy = y - eye.y;
  const dz = z - eye.z;
  // lookVector: yaw 0 looks along −z, positive yaw turns towards −x.
  look(app, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
}

/**
 * Turns the view towards a point once the next frame has placed the eye (it follows the body on
 * frames: after a teleport or a walk). The simulation's own rays (a liquid to sip) read the view
 * on the next tick.
 */
export async function lookAt(app: App, x: number, y: number, z: number): Promise<void> {
  await frameOrFail();
  turnTo(app, x, y, z);
}

/**
 * Turns the view to the middle of the side of a block that faces the eye (along the larger
 * horizontal offset), so the aim ray meets that block first, and checks the aim on the next frame.
 * With `height` (a fraction of a block) it aims at the middle of the cell at that height instead:
 * the top of a low block (a bedroll, a campfire) seen from above.
 */
export async function aimAt(app: App, { x, y, z }: Cell, height?: number): Promise<void> {
  const session = app.session!;
  await frameOrFail();
  if (height === undefined) {
    const eye = session.rig.eye;
    const ox = x + 0.5 - eye.x;
    const oz = z + 0.5 - eye.z;
    // Just inside the face towards the eye.
    const inset = 0.49;
    const tx = Math.abs(ox) >= Math.abs(oz) ? x + 0.5 - Math.sign(ox) * inset : x + 0.5;
    const tz = Math.abs(ox) >= Math.abs(oz) ? z + 0.5 : z + 0.5 - Math.sign(oz) * inset;
    turnTo(app, tx, y + 0.5, tz);
  } else turnTo(app, x + 0.5, y + height, z + 0.5);
  await frameOrFail();
  const hit = session.aim.hit;
  assert(
    hit.hit && hit.x === x && hit.y === y && hit.z === z,
    `aiming at (${x}, ${y}, ${z}) hits ${hit.hit ? `(${hit.x}, ${hit.y}, ${hit.z})` : 'nothing'}`,
  );
}

/** A torch's light (« torche 14 »; m5, and the spawn rule of m10). */
export const TORCH_LIGHT = 14;

/** The block state that emits `level` (the torch, found without naming content). */
export function emitterOf(app: App, level: number): number {
  const state = app.registry!.tables.emit.indexOf(level);
  assert(state >= 0, `no block state emits light ${level}`);
  return state;
}

/** Text key of a block state (`#id` for an unknown id), for fills and messages. */
export function stateKey(app: App, state: number): string {
  return app.registry!.states[state]?.key ?? `#${state}`;
}

/** The world clock as automation reads it (fails without a world session). */
export function readClock(app: App): ClockView {
  const time = clock(app);
  assert(time, 'no world clock');
  return time;
}

/** Runs `body`, then puts the clock back (hour of the day and freeze flag) even if it failed. */
export async function keepingClock(app: App, body: () => Promise<void> | void): Promise<void> {
  const saved = readClock(app);
  try {
    await body();
  } finally {
    setTime(app, saved.hour);
    freezeTime(app, saved.frozen);
  }
}

/** « ≤ 400 draws » (M5, and M6 with caves and decoration): the surface view at render distance. */
const MAX_DRAWS = 400;

/** The draw-call budget case of a suite (`skip` picks the world it runs in). */
export function drawsCase(skip: (app: App) => string | null): SelftestCase {
  return {
    name: `the surface view takes at most ${MAX_DRAWS} draws once the render distance is meshed`,
    scenes: PLAY_SCENES,
    timeoutMs: 60_000,
    skip,
    run: async (app) => {
      const session = await playerSession(app);
      const rd = session.renderDistance;
      // Frames stream in fixed-step mode too; pumping without a tick only loads faster.
      await waitUntil(() => session.chunksReady(rd), {
        timeoutMs: 50_000,
        label: `render distance ${rd} not meshed`,
        pump: () => session.pumpOnce(false),
        pollMs: 50,
      });
      // Along the horizon: the widest view of the ground.
      look(app, 0, 0);
      await framesFor(SETTLE_MS);
      // The counters of the last whole frame (they are reset at the start of each one).
      await frameOrFail();
      const calls = app.renderer!.webgl.info.render.calls;
      assert(calls <= MAX_DRAWS, `${calls} draws at render distance ${rd} (> ${MAX_DRAWS})`);
    },
  };
}
