import { audioMark, heardSince } from '../audioAutomation.ts';
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
 * M45 Veyra's soundscape (plan v4 « M45 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): each of the pack's creatures that has a death cry cries it in
 * its own voice when it dies before the player.
 */

const voicesCase: SelftestCase = {
  name: 'each creature dies crying in its own voice',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  timeoutMs: 60_000,
  run: async (app) => {
    const session = await playerSession(app);
    const body = session.player.body;
    for (const creature of app.registry!.pack.creatures ?? []) {
      const cry = creature.sounds.death;
      if (!cry) continue;
      const id = placeCreature(app, creature.key, body.x, 'surface', body.z - 4);
      assert(id !== null, `${creature.key} could not be placed`);
      const mark = audioMark(app);
      killCreature(app, id);
      session.step(2);
      const heard = await withinFrames(10, () => heardSince(app, mark).includes(cry));
      assert(heard, `${creature.key} died without ${cry}: ${heardSince(app, mark).join(', ')}`);
    }
  },
};

export const M45_SUITE: readonly SelftestCase[] = [
  voicesCase,
  noErrorsCase('no errors after the m45 checks'),
];
