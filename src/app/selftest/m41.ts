import { withinFrames } from '../automation.ts';
import { killCreature, placeCreature } from '../creatureAutomation.ts';
import {
  assert,
  needsFlatPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
} from './support.ts';

/*
 * M41 creatures and things on the ground (plan v4 « M41 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): a creature placed in front of the player lays its soft contact
 * shadow on the ground (the first creature of the pack).
 */

const shadowCase: SelftestCase = {
  name: 'a creature lays a soft shadow on the ground under it',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const creature = app.registry!.pack.creatures?.[0];
    assert(creature, 'the pack has no creature');
    const shadows = session.play.shadows;
    const body = session.player.body;
    const id = placeCreature(app, creature.key, body.x, 'surface', body.z - 4);
    assert(id !== null, `${creature.key} could not be placed`);
    try {
      const laid = await withinFrames(10, () => shadows.size > 0);
      assert(laid, 'no contact shadow under the creature');
    } finally {
      killCreature(app, id);
    }
  },
};

export const M41_SUITE: readonly SelftestCase[] = [
  shadowCase,
  noErrorsCase('no errors after the m41 checks'),
];
