import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import type { App } from '../App.ts';
import { fill, freezeTime, look, setTime, setWeather, withinFrames } from '../automation.ts';
import {
  arenaOf,
  assert,
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
 * M38 water and lava (plan v4 « M38 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): a pool of the pack's pond liquid ripples (two views of it a few
 * frames apart differ), a pool of its lava drifts and glows, and the bare ground beside them
 * stays still (the same view twice is the same picture). The sky is held clear.
 */

/** Where the pools lie, away from the other cases' places. */
const SPOT = { x: -40, z: 40 };

/** Two captures of the view `frames` frames apart: whether they differ. */
async function moves(app: App, frames: number): Promise<boolean> {
  await withinFrames(3, () => false);
  const first = app.view!.capture().hash;
  await withinFrames(frames, () => false);
  return app.view!.capture().hash !== first;
}

const liquidsCase: SelftestCase = {
  name: 'water ripples and lava drifts, the bare ground beside them stays still',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  timeoutMs: 60_000,
  run: async (app) => {
    await playerSession(app);
    const registry = app.registry!;
    const water = stateKey(app, registry.defaultState(arenaOf(app).pond.liquid));
    const magma = registry.pack.worldgen?.magma;
    assert(magma, 'the pack has no lava');
    const lava = stateKey(app, registry.defaultState(magma));
    const ground = stateKey(app, registry.defaultState(arenaOf(app).pond.shore));
    const { x, z } = SPOT;
    const y = FLAT_SURFACE;
    await keepingClock(app, async () => {
      setTime(app, 12);
      freezeTime(app, true);
      setWeather(app, 'clear');
      try {
        fill(app, x - 3, y - 1, z - 3, x + 3, y, z + 3, water);
        fill(app, x - 3, y - 1, z + 12, x + 3, y, z + 18, lava);
        await standAt(app, { x, z: z + 6 });
        look(app, 0, -0.8);
        assert(await moves(app, 6), 'the water looks the same from frame to frame');
        await standAt(app, { x, z: z + 21 });
        look(app, 0, -0.8);
        assert(await moves(app, 6), 'the lava looks the same from frame to frame');
        await standAt(app, { x: x + 20, z });
        look(app, 0, -1.4);
        assert(!(await moves(app, 6)), 'the bare ground changes from frame to frame');
      } finally {
        fill(app, x - 3, y - 1, z - 3, x + 3, y, z + 3, ground);
        fill(app, x - 3, y - 1, z + 12, x + 3, y, z + 18, ground);
        setWeather(app, null);
        look(app, 0, 0);
      }
    });
  },
};

export const M38_SUITE: readonly SelftestCase[] = [
  liquidsCase,
  noErrorsCase('no errors after the m38 checks'),
];
