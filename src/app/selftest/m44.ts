import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import { fill, withinFrames } from '../automation.ts';
import {
  arenaOf,
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
 * M44 the sound engine (plan v4 « M44 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): the room the effects ring in follows the place, the biome's air
 * outside, an indoor room under a roof (the arena cabin's roof block).
 */

/** Where the roof is laid, away from the other cases' places. */
const SPOT = { x: 64, z: 64 };

const roomCase: SelftestCase = {
  name: 'the effects ring in the room of the place: outdoors, then indoors under a roof',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    await playerSession(app);
    const audio = app.audio!;
    const registry = app.registry!;
    const roof = stateKey(app, registry.defaultState(arenaOf(app).cabin.roof));
    const air = stateKey(app, registry.air);
    const { x, z } = SPOT;
    const y = FLAT_SURFACE + 4;
    await standAt(app, SPOT);
    const outside = await withinFrames(
      10,
      () => audio.reverb() !== null && audio.reverb() !== 'indoor',
    );
    assert(outside, `outdoors the room is ${audio.reverb()}`);
    try {
      fill(app, x - 2, y, z - 2, x + 2, y, z + 2, roof);
      const inside = await withinFrames(20, () => audio.reverb() === 'indoor');
      assert(inside, `under a roof the room is ${audio.reverb()}`);
    } finally {
      fill(app, x - 2, y, z - 2, x + 2, y, z + 2, air);
    }
  },
};

export const M44_SUITE: readonly SelftestCase[] = [
  roomCase,
  noErrorsCase('no errors after the m44 checks'),
];
