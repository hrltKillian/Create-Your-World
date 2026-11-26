import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import { fill, frameOrFail, withinFrames } from '../automation.ts';
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
 * (?worldType=flat&fixedStep=1): the effects ring only in a real room (plan v5 « M53 »): outdoors
 * they are dry, and a roof alone (a lean-to, the arena cabin's roof block) is no room. The closed
 * room and the cave are m53's.
 */

/** Where the roof is laid, away from the other cases' places. */
const SPOT = { x: 64, z: 64 };

const roomCase: SelftestCase = {
  name: 'the effects are dry outdoors, under a roof alone too',
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
    const outside = await withinFrames(10, () => audio.reverb() === 'dry');
    assert(outside, `outdoors the room is ${audio.reverb()}`);
    try {
      fill(app, x - 2, y, z - 2, x + 2, y, z + 2, roof);
      for (let i = 0; i < 20; i++) await frameOrFail();
      assert(audio.reverb() === 'dry', `under a roof alone the room is ${audio.reverb()}`);
    } finally {
      fill(app, x - 2, y, z - 2, x + 2, y, z + 2, air);
    }
  },
};

export const M44_SUITE: readonly SelftestCase[] = [
  roomCase,
  noErrorsCase('no errors after the m44 checks'),
];
