import { COLUMN_LIT } from '../../sim/ColumnPipeline.ts';
import { HOUR_TICKS } from '../../sim/time.ts';
import { blockToColumn } from '../../world/coords.ts';
import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import { MAX_LIGHT } from '../../world/light.ts';
import type { App } from '../App.ts';
import {
  type ClockView,
  clock,
  fill,
  frameOrFail,
  framesFor,
  freezeTime,
  lightAt,
  look,
  setBlock,
  setTime,
  waitUntil,
} from '../automation.ts';
import {
  assert,
  needsFlatPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  standAt,
  stateKey,
} from './support.ts';

/**
 * M5 « Fait quand » browser checks on the flat world (?worldType=flat&fixedStep=1): noon is at
 * least 2.5 × as bright as midnight, step(1500) is one hour, a cavity sealed with debug fills has
 * no sky light, a torch gives 14 at its cell and 11 three blocks away, the 'light' debug view
 * renders and the surface view takes at most 400 draws. The cases work north of the spawn
 * (z < 0), away from where m3 walks and builds and m4 digs; they undo their edits and put the
 * clock back, so they can run again on the same page.
 */

/** Where the day/night captures stand, looking north along the horizon (half ground, half sky). */
const VIEW = { x: 0, z: -16 };
/** Centre of the sealed cavity: a 3×3×3 room of air in a 5×5×5 shell on the ground. */
const CAVITY = { x: -12, z: -12 };
const TORCH = { x: 12, z: -12 };
/** Feet level on the flat ground: the cavity's floor and the torch's cell. */
const FLOOR = FLAT_SURFACE + 1;

/** « luminance à 12 h ≥ 2,5 × celle de 0 h ». */
const DAY_NIGHT_RATIO = 2.5;
/** « torche 14, et 11 à 3 blocs »: one level lost per block of air. */
const TORCH_LIGHT = 14;
const TORCH_REACH = 3;
/** « ≤ 400 draws » (surface view, render distance 6 by default). */
const MAX_DRAWS = 400;
/** Wall time for the camera and the frame loop to settle after a teleport or a view switch. */
const SETTLE_MS = 300;

function readClock(app: App): ClockView {
  const time = clock(app);
  assert(time, 'no world clock');
  return time;
}

function describeClock(time: ClockView): string {
  return `day ${time.day} ${time.hour.toFixed(4)} h (${time.ticks} ticks)`;
}

/** Runs `body`, then puts the clock back (hour of the day and freeze flag) even if it failed. */
async function keepingClock(app: App, body: () => Promise<void> | void): Promise<void> {
  const saved = readClock(app);
  try {
    await body();
  } finally {
    setTime(app, saved.hour);
    freezeTime(app, saved.frozen);
  }
}

/** Mean luminance of the captured view at an hour, once frames have drawn the sky and light. */
async function lumaAt(app: App, hours: number): Promise<number> {
  setTime(app, hours);
  const shown = readClock(app).hour;
  assert(shown === hours, `the clock shows ${shown.toFixed(4)} h after setTime(${hours})`);
  // The frame loop hands the hour and uDaylight to the view (sky, fog, sky light) every frame.
  await frameOrFail();
  await frameOrFail();
  return app.view!.capture().avgLuma;
}

/** Light is only settled in lit columns: fail with a clear message elsewhere. */
function assertLit(app: App, x: number, z: number): void {
  const state = app.session!.host.view.columnState(blockToColumn(x), blockToColumn(z));
  assert(state >= COLUMN_LIT, `the column of (${x}, ${z}) is not lit (state ${state})`);
}

/** The block state that emits `level` (the torch, found without naming content). */
function emitterOf(app: App, level: number): number {
  const state = app.registry!.tables.emit.indexOf(level);
  assert(state >= 0, `no block state emits light ${level}`);
  return state;
}

export const M5_SUITE: readonly SelftestCase[] = [
  {
    name: 'the view at 12:00 is at least 2.5 × as bright as at 00:00 (same pose, sky in view)',
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsFlatPlayer,
    run: async (app) => {
      await playerSession(app);
      await standAt(app, VIEW);
      look(app, 0, 0);
      await framesFor(SETTLE_MS);
      await keepingClock(app, async () => {
        const noon = await lumaAt(app, 12);
        const midnight = await lumaAt(app, 0);
        assert(
          noon >= DAY_NIGHT_RATIO * midnight,
          `avgLuma ${noon.toFixed(3)} at 12:00 < ${DAY_NIGHT_RATIO} × ${midnight.toFixed(3)} at 00:00`,
        );
      });
    },
  },
  {
    name: 'step(1500) moves the clock on by exactly one hour',
    scenes: PLAY_SCENES,
    skip: needsFlatPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      await keepingClock(app, () => {
        freezeTime(app, false);
        setTime(app, 10);
        const before = readClock(app);
        session.step(HOUR_TICKS);
        const after = readClock(app);
        assert(
          after.ticks - before.ticks === HOUR_TICKS &&
            after.hour === before.hour + 1 &&
            after.day === before.day,
          `${describeClock(before)} → ${describeClock(after)} after step(${HOUR_TICKS})`,
        );
      });
    },
  },
  {
    name: 'a cavity sealed with debug fills has sky light 0 inside (light came in while open)',
    scenes: PLAY_SCENES,
    skip: needsFlatPlayer,
    run: async (app) => {
      await playerSession(app);
      const { x, z } = CAVITY;
      const x0 = x - 2;
      const x1 = x + 2;
      const z0 = z - 2;
      const z1 = z + 2;
      const y0 = FLOOR;
      const y1 = FLOOR + 3;
      assertLit(app, x0, z0);
      assertLit(app, x1, z1);
      // The shell is made of the ground's filler, which must stop light.
      const wall = app.world!.getBlock(x, FLAT_SURFACE - 1, z);
      assert(
        app.registry!.tables.lightFilter[wall] === MAX_LIGHT,
        `${stateKey(app, wall)} lets light through`,
      );
      const key = stateKey(app, wall);
      try {
        // Roof first (no light straight down), then three walls: the south side stays open.
        fill(app, x0, y1, z0, x1, y1, z1, key);
        fill(app, x0, y0, z0, x0, y1, z1, key);
        fill(app, x1, y0, z0, x1, y1, z1, key);
        fill(app, x0, y0, z0, x1, y1, z0, key);
        const open = lightAt(app, x, y0 + 1, z)!;
        assert(open.sky > 0, 'no sky light reached the room through its open south side');
        fill(app, x0, y0, z1, x1, y1, z1, key);
        for (let cy = y0; cy < y1; cy++) {
          for (let cz = z0 + 1; cz < z1; cz++) {
            for (let cx = x0 + 1; cx < x1; cx++) {
              const light = lightAt(app, cx, cy, cz)!;
              assert(
                light.sky === 0 && light.block === 0,
                `sealed cell (${cx}, ${cy}, ${cz}) has sky ${light.sky} and block ${light.block} (it had sky ${open.sky} while open)`,
              );
            }
          }
        }
      } finally {
        fill(app, x0, y0, z0, x1, y1, z1, stateKey(app, app.registry!.air));
      }
    },
  },
  {
    name: 'a torch gives block light 14 at its cell and 11 three blocks away, 0 once removed',
    scenes: PLAY_SCENES,
    skip: needsFlatPlayer,
    run: async (app) => {
      await playerSession(app);
      const { x, z } = TORCH;
      const y = FLOOR;
      assertLit(app, x, z);
      assertLit(app, x + TORCH_REACH, z);
      const torch = emitterOf(app, TORCH_LIGHT);
      const near = () => lightAt(app, x, y, z)!.block;
      const far = () => lightAt(app, x + TORCH_REACH, y, z)!.block;
      assert(near() === 0 && far() === 0, `block light ${near()} / ${far()} before the torch`);
      try {
        setBlock(app, x, y, z, stateKey(app, torch));
        assert(near() === TORCH_LIGHT, `block light ${near()} at the torch, not ${TORCH_LIGHT}`);
        const expected = TORCH_LIGHT - TORCH_REACH;
        assert(
          far() === expected,
          `block light ${far()} ${TORCH_REACH} blocks from the torch, not ${expected}`,
        );
      } finally {
        setBlock(app, x, y, z, stateKey(app, app.registry!.air));
      }
      assert(
        near() === 0 && far() === 0,
        `block light ${near()} at the cell and ${far()} ${TORCH_REACH} blocks away once the torch is removed`,
      );
    },
  },
  {
    name: "the 'light' debug view renders (fewer colours than the textured view) without errors",
    scenes: PLAY_SCENES,
    skip: needsFlatPlayer,
    run: async (app) => {
      await playerSession(app);
      await standAt(app, VIEW);
      look(app, 0, -0.3);
      const errors = app.errors.length;
      const previous = app.debugView;
      await keepingClock(app, async () => {
        // Noon: the textured ground is bright enough to show its many colours.
        setTime(app, 12);
        await framesFor(SETTLE_MS);
        const textured = app.view!.capture();
        try {
          app.setDebugView('light');
          // Frames keep coming with the view on (framesFor fails when they stop).
          await framesFor(SETTLE_MS);
          const light = app.view!.capture();
          assert(
            light.uniqueColors < textured.uniqueColors,
            `the light view shows ${light.uniqueColors} colours, the textured view ${textured.uniqueColors}`,
          );
        } finally {
          app.setDebugView(previous);
        }
      });
      const added = app.errors.slice(errors);
      assert(added.length === 0, `errors with the light view: ${added.join(' | ')}`);
    },
  },
  {
    name: 'the surface view takes at most 400 draws once the render distance is meshed',
    scenes: PLAY_SCENES,
    timeoutMs: 60_000,
    skip: needsFlatPlayer,
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
  },
  noErrorsCase('no errors and no missing strings after the m5 checks'),
];
