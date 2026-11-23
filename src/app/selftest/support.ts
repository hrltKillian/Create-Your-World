import { i18nMissing } from '../../i18n/i18n.ts';
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
 * The player checks (m3, m4) need a player (no free camera), fixed steps (teleport, fill and
 * give then apply at once) and the flat world.
 */
export function needsFlatPlayer(app: App): string | null {
  if (app.params.freecam) return 'needs a player (no ?freecam)';
  if (!app.params.fixedStep) return 'needs ?fixedStep=1';
  if (app.params.worldType !== 'flat') return 'needs ?worldType=flat';
  return null;
}

/** The generated-world checks (m6) need a player in the default world (not flat or arena). */
export function needsGeneratedPlayer(app: App): string | null {
  if (app.params.freecam) return 'needs a player (no ?freecam)';
  if (app.params.worldType !== 'default')
    return `needs the generated world (not ?worldType=${app.params.worldType})`;
  return null;
}

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

/** Puts the player on the flat surface of a column, at rest, and renders a frame (eye, aim, ear). */
export async function standAt(app: App, spot: { x: number; z: number }): Promise<void> {
  teleport(app, spot.x + 0.5, FLAT_SURFACE + 1, spot.z + 0.5);
  app.session!.step(5);
  await frameOrFail();
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
        timeoutMs: 50_000 * slowFactor(app),
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
