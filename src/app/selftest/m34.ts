import { ticksOf } from '../../sim/clock.ts';
import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import type { App } from '../App.ts';
import { audioMark, heardSince } from '../audioAutomation.ts';
import {
  clickSlot,
  fill,
  give,
  openBlock,
  setWeather,
  waitUntil,
  weatherView,
} from '../automation.ts';
import {
  assert,
  needsFlatPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  slotsAt,
  standAt,
  stateKey,
} from './support.ts';

/*
 * M34 weather (plan v3 « M34 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): rain held by `debug.setWeather` comes in over a few seconds of
 * frames (clouds dim the sky, drops fall around the player, the rain loop plays) and puts a fire
 * on the player out; a rain barrel under the sky fills an empty flask; a storm throws lightning,
 * its thunder heard. Blocks and items come from the pack's data.
 */

const SPOT = { x: 180, z: -90 };

/** Waits (in frames: the client eases the weather in) until the weather view says so. */
function waitWeather(app: App, done: (w: NonNullable<ReturnType<typeof weatherView>>) => boolean) {
  return waitUntil(() => done(weatherView(app)!), {
    timeoutMs: 15_000,
    label: `the weather did not come in (${JSON.stringify(weatherView(app))})`,
    pollMs: 50,
  });
}

const rainCase: SelftestCase = {
  name: 'rain comes in: clouds dim the sky, drops fall, the rain loop plays, a fire goes out',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  timeoutMs: 60_000,
  run: async (app) => {
    const session = await playerSession(app);
    await standAt(app, SPOT);
    try {
      setWeather(app, 'rain');
      await waitWeather(app, (w) => w.rain > 0.9 && w.drops > 0 && w.dim < 1);
      const rain = app.registry!.pack.sounds?.ambience.rain?.bed;
      const loop = app.audio?.ambience().find((l) => l.key === rain);
      assert(loop !== undefined && loop.gain > 0.5, `the rain loop plays at ${loop?.gain}`);
      const s = session.player.survival;
      s.burnTicks = 100;
      session.step(2);
      assert(s.burnTicks === 0, 'the rain did not put the fire out');
    } finally {
      setWeather(app, 'clear');
      await waitWeather(app, (w) => w.rain === 0 && w.drops === 0);
      setWeather(app, null);
    }
  },
};

const barrelCase: SelftestCase = {
  name: 'a rain barrel under the sky fills an empty flask in the rain',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const registry = app.registry!;
    const barrel = registry.pack.blocks.find((b) => {
      const station = b.station ? registry.crafting.station(b.station) : undefined;
      return station?.rain === true;
    });
    const process = registry.pack.processes?.find((p) => p.fuel === 'rain');
    assert(barrel && process, 'the pack has no rain barrel');
    const cell = { x: SPOT.x + 2, y: FLAT_SURFACE + 1, z: SPOT.z };
    const empty = process.inputs[0]!.item;
    await standAt(app, SPOT);
    try {
      fill(
        app,
        cell.x,
        cell.y,
        cell.z,
        cell.x,
        cell.y,
        cell.z,
        stateKey(app, registry.defaultState(barrel.key)),
      );
      give(app, empty, 1);
      openBlock(app, cell.x, cell.y, cell.z);
      const slot = session.player.inventory.findIndex((s) => s?.item === empty);
      assert(clickSlot(slot, 0, true), `the flask in slot ${slot} did not go into the barrel`);
      app.inventory!.closeScreen();
      setWeather(app, 'rain');
      session.step(ticksOf(process.seconds) + 2);
      const out = slotsAt(app, cell).find((s) => s?.item === process.output.item);
      assert(out, `the barrel holds ${JSON.stringify(slotsAt(app, cell))}`);
    } finally {
      setWeather(app, null);
      fill(app, cell.x, cell.y, cell.z, cell.x, cell.y, cell.z, stateKey(app, registry.air));
    }
  },
};

const stormCase: SelftestCase = {
  name: 'a storm darkens the sky and throws lightning, its thunder heard',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  timeoutMs: 60_000,
  run: async (app) => {
    const session = await playerSession(app);
    await standAt(app, SPOT);
    const w = app.registry!.pack.balance.weather;
    const mark = audioMark(app);
    try {
      setWeather(app, 'storm');
      await waitWeather(app, (v) => v.dim < (1 + w.dim.storm) / 2);
      const thunder = app.registry!.pack.sounds?.thunder;
      await waitUntil(() => heardSince(app, mark).includes(thunder ?? ''), {
        timeoutMs: 20_000,
        label: 'no thunder',
        pump: () => session.step(ticksOf(1)),
        pollMs: 20,
      });
    } finally {
      setWeather(app, 'clear');
      await waitWeather(app, (v) => v.dim === 1 && v.flash === 0);
      setWeather(app, null);
    }
  },
};

export const M34_SUITE: readonly SelftestCase[] = [
  rainCase,
  barrelCase,
  stormCase,
  noErrorsCase('no errors after the m34 checks'),
];
