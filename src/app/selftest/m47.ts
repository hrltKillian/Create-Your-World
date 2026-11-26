import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import { fill, setWeather, strike, weatherView, withinFrames } from '../automation.ts';
import { god } from '../survivalAutomation.ts';
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

/*
 * M47 lightning and fire (plan v5 « M47 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): a strike on a column of the pack's logs shows its bolt and lights
 * a fire on top, which the rain then puts out.
 */

/** The column struck, away from the other suites' places. */
const SPOT = { x: 120, z: -120 };
/** Steps of a fire's ticks the rain gets to put it out (its chance grows with the fire's age). */
const RAIN_TICKS = 30 * 120;

const strikeCase: SelftestCase = {
  name: 'lightning strikes a column of logs: its bolt shows, a fire burns on top, the rain puts it out',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  timeoutMs: 60_000,
  run: async (app) => {
    const session = await playerSession(app);
    const registry = app.registry!;
    const fireKey = registry.pack.manifest.bindings.fire;
    const log = registry.pack.blocks.find((b) => b.flammability && b.shape === 'cube');
    assert(fireKey && log, 'the pack has no fire or no flammable cube');
    const fire = registry.pack.blocks.findIndex((b) => b.key === fireKey);
    const world = session.host.view.world;
    const { x, z } = SPOT;
    const top = FLAT_SURFACE + 4;
    const burning = () => registry.tables.blockOf[world.getBlock(x, top, z)] === fire;
    god(app, true);
    try {
      // Beside the column, out of the strike's reach, so its columns are loaded and simulated.
      await standAt(app, { x: x + 6, z });
      fill(
        app,
        x,
        FLAT_SURFACE + 1,
        z,
        x,
        top - 1,
        z,
        stateKey(app, registry.defaultState(log.key)),
      );
      strike(app, x, z);
      assert(await withinFrames(5, () => weatherView(app)?.bolt === true), 'no bolt showed');
      assert(burning(), `no fire on the logs: ${stateKey(app, world.getBlock(x, top, z))}`);
      setWeather(app, 'rain', 600);
      for (let t = 0; t < RAIN_TICKS && burning(); t += 30) session.step(30);
      assert(!burning(), 'the rain left the fire burning');
    } finally {
      setWeather(app, null);
      fill(app, x - 1, FLAT_SURFACE + 1, z - 1, x + 1, top + 4, z + 1, stateKey(app, registry.air));
      god(app, false);
      session.player.survival.burnTicks = 0;
    }
  },
};

export const M47_SUITE: readonly SelftestCase[] = [
  strikeCase,
  noErrorsCase('no errors after the m47 checks'),
];
