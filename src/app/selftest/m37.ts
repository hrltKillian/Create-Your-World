import { withQuality } from '../../platform/settings.ts';
import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import { fill, frameOrFail, freezeTime, look, setTime, withinFrames } from '../automation.ts';
import {
  arenaOf,
  assert,
  drawsCase,
  keepingClock,
  needsFlatPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  standAt,
  stateKey,
} from './support.ts';

/*
 * M37 realistic light (plan v4 « M37 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): at noon a wall's shadow darkens the open ground north of it with
 * the sun's shadow map on, and nothing does with it off (the low preset draws no shadow pass); the
 * surface view keeps its draw budget (the shadow pass is counted apart). The wall is the pack's
 * arena cabin wall.
 */

/** Where the wall stands, away from the other cases' places. */
const SPOT = { x: 40, z: 40 };
/** The wall's height: at noon the sun stands south, so its shadow lies two blocks north and more. */
const WALL_HEIGHT = 8;
/** The shaded ground keeps at most this share of the light of the same ground lit. */
const SHADE = 0.85;

const shadowCase: SelftestCase = {
  name: "a wall's shadow darkens the open ground at noon, with the sun's shadows on only",
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    await playerSession(app);
    const game = app.game!;
    const view = app.view!;
    const registry = app.registry!;
    const before = game.settings;
    const wall = stateKey(app, registry.defaultState(arenaOf(app).cabin.wall));
    const air = stateKey(app, registry.air);
    const y = FLAT_SURFACE + 1;
    const { x, z } = SPOT;
    await keepingClock(app, async () => {
      setTime(app, 12);
      freezeTime(app, true);
      fill(app, x - 5, y, z + 3, x + 5, y + WALL_HEIGHT - 1, z + 3, wall);
      try {
        // Standing in the strip the wall shades, looking at the ground at the feet.
        await standAt(app, { x, z: z + 2 });
        look(app, 0, -1.5);
        const luma = async (shadows: number) => {
          game.changeSettings({ ...before, shadows });
          const drawn = await withinFrames(40, () => view.shadowDraws() > 0 === shadows > 0);
          assert(drawn, `the shadow pass drew ${view.shadowDraws()} with shadows ${shadows}`);
          await withinFrames(3, () => false);
          return view.capture().avgLuma;
        };
        const lit = await luma(0);
        const shaded = await luma(before.shadows || 1024);
        assert(
          shaded < lit * SHADE,
          `the shaded ground is ${shaded.toFixed(3)}, lit ${lit.toFixed(3)} (at most ×${SHADE})`,
        );
        game.changeSettings(withQuality(before, 'low'));
        await frameOrFail();
        assert(view.shadowDraws() === 0, 'the low preset still draws the shadow pass');
      } finally {
        game.changeSettings(before);
        fill(app, x - 5, y, z + 3, x + 5, y + WALL_HEIGHT - 1, z + 3, air);
        look(app, 0, 0);
      }
    });
  },
};

export const M37_SUITE: readonly SelftestCase[] = [
  shadowCase,
  drawsCase(needsFlatPlayer),
  noErrorsCase('no errors after the m37 checks'),
];
