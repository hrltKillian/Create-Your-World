import { FACE_SOUTH, FACEFLAG_EMISSIVE, PASS_OPAQUE, SHAPE_CUBE } from '../../content/registry.ts';
import { withQuality } from '../../platform/settings.ts';
import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import type { App } from '../App.ts';
import {
  fill,
  frameOrFail,
  freezeTime,
  look,
  setTime,
  setWeather,
  withinFrames,
} from '../automation.ts';
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
 * M40 the night of Veyra (plan v4 « M40 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): at midnight a wall of a glowing block of the pack shines brighter
 * than a wall of the arena cabin's; the biome's motes drift in the air by night and not by day;
 * the high preset draws with bloom. The glowing block is found by its emissive faces.
 */

/** Where the walls stand, away from the other cases' places. */
const SPOT = { x: -64, z: -64 };

/** The first full opaque block whose south face glows (its state key). */
function glowingBlock(app: App): string {
  const tables = app.registry!.tables;
  for (let state = 1; state < tables.shape.length; state++) {
    const cube = tables.shape[state] === SHAPE_CUBE && tables.pass[state] === PASS_OPAQUE;
    if (cube && (tables.faceFlags[state * 6 + FACE_SOUTH]! & FACEFLAG_EMISSIVE) !== 0)
      return stateKey(app, state);
  }
  throw new Error('the pack has no glowing cube');
}

/** The view's brightness facing a 5 × 5 wall of `state` two blocks north, at midnight. */
async function wallLuma(app: App, state: string): Promise<number> {
  const { x, z } = SPOT;
  const y = FLAT_SURFACE + 1;
  fill(app, x - 2, y, z - 3, x + 2, y + 4, z - 3, state);
  await standAt(app, { x, z });
  look(app, 0, 0.25);
  await withinFrames(3, () => false);
  return app.view!.capture().avgLuma;
}

const glowCase: SelftestCase = {
  name: 'at midnight a glowing wall shines brighter than a plain one',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  timeoutMs: 60_000,
  run: async (app) => {
    await playerSession(app);
    const registry = app.registry!;
    const plain = stateKey(app, registry.defaultState(arenaOf(app).cabin.wall));
    const glowing = glowingBlock(app);
    const air = stateKey(app, registry.air);
    await keepingClock(app, async () => {
      setTime(app, 0);
      freezeTime(app, true);
      setWeather(app, 'clear');
      try {
        const dark = await wallLuma(app, plain);
        const lit = await wallLuma(app, glowing);
        assert(
          lit > dark * 1.5,
          `the glowing wall is ${lit.toFixed(3)}, the plain ${dark.toFixed(3)}`,
        );
      } finally {
        const { x, z } = SPOT;
        const y = FLAT_SURFACE + 1;
        fill(app, x - 2, y, z - 3, x + 2, y + 4, z - 3, air);
        setWeather(app, null);
        look(app, 0, 0);
      }
    });
  },
};

const motesCase: SelftestCase = {
  name: "the biome's motes drift in the air by night, not by day",
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  timeoutMs: 60_000,
  run: async (app) => {
    const session = await playerSession(app);
    const body = session.player.body;
    const sim = session.host.view;
    const biome = sim.world.biomeAt(Math.floor(body.x), Math.floor(body.z));
    assert(sim.gen.biomeDefs[biome]?.motes, "the flat world's biome has no motes");
    const motes = session.play.motes;
    await keepingClock(app, async () => {
      freezeTime(app, true);
      setTime(app, 12);
      // The night share follows the clock a frame late: let it settle first.
      await withinFrames(3, () => false);
      const day = await withinFrames(10, () => motes.drawn > 0);
      assert(!day, `${motes.drawn} motes by day`);
      setTime(app, 0);
      const night = await withinFrames(30, () => motes.drawn > 0);
      assert(night, 'no motes at midnight');
    });
  },
};

const bloomCase: SelftestCase = {
  name: 'the high preset draws with bloom, the medium one without',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    await playerSession(app);
    const game = app.game!;
    const before = game.settings;
    try {
      game.changeSettings(withQuality(before, 'high'));
      await frameOrFail();
      assert(app.view!.blooms, 'no bloom on the high preset');
      await withinFrames(3, () => false);
      assert(app.errors.length === 0, `errors: ${app.errors.join(' | ')}`);
      game.changeSettings(withQuality(before, 'medium'));
      await frameOrFail();
      assert(!app.view!.blooms, 'bloom on the medium preset');
    } finally {
      game.changeSettings(before);
    }
  },
};

export const M40_SUITE: readonly SelftestCase[] = [
  glowCase,
  motesCase,
  bloomCase,
  noErrorsCase('no errors after the m40 checks'),
];
