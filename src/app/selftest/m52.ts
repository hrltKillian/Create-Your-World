import { DYING_TICKS } from '../../core/creatures.ts';
import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import { frameOrFail, withinFrames } from '../automation.ts';
import { killCreature, placeCreature } from '../creatureAutomation.ts';
import {
  assert,
  lookAt,
  needsFlatPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  standAt,
} from './support.ts';

/*
 * M52 the creatures redrawn (plan v5 « M52 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): each species of the pack, placed in front of the player, is drawn
 * on screen as skinned boxes of its atlas, and lives at rest (it breathes, glances, wags) while the
 * simulation stands still.
 */

/** Frames a placed creature gets to be drawn, and to move at rest. */
const DRAW_FRAMES = 30;
const LIFE_FRAMES = 40;

const speciesCase: SelftestCase = {
  name: 'every species is drawn from its skin atlas and lives at rest',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  timeoutMs: 60_000,
  run: async (app) => {
    const session = await playerSession(app);
    const play = session.play;
    const registry = app.registry!;
    await standAt(app, { x: 0, z: 0 });
    const origins = play.batch.mesh.geometry.getAttribute('aTexOrigin');
    for (const def of registry.pack.creatures ?? []) {
      const model = registry.model(def.model);
      assert(model?.skin, `${def.key} has no skin atlas`);
      await lookAt(app, 0.5, FLAT_SURFACE + 1.5, -4.5);
      const empty = app.view!.capture().hash;
      const id = placeCreature(app, def.key, 0.5, 'surface', -4.5);
      assert(id !== null, `${def.key} could not be placed`);
      try {
        assert(
          await withinFrames(DRAW_FRAMES, () => play.creatures.rig(id) !== null),
          `${def.key} is not drawn`,
        );
        await frameOrFail();
        let skinned = 0;
        for (let i = 0; i < play.batch.size; i++) if (origins.getW(i) === 2) skinned++;
        assert(
          skinned >= model.parts.length,
          `${def.key}: ${skinned} skinned boxes of ${model.parts.length}`,
        );
        assert(app.view!.capture().hash !== empty, `${def.key} does not show on screen`);
        const rig = play.creatures.rig(id)!;
        const before = JSON.stringify([rig.angles, rig.yaws]);
        for (let i = 0; i < LIFE_FRAMES; i++) await frameOrFail();
        assert(JSON.stringify([rig.angles, rig.yaws]) !== before, `${def.key} stands frozen`);
      } finally {
        // Gone before the next one: its death played out in fixed steps.
        killCreature(app, id);
        session.step(DYING_TICKS + 2);
        await frameOrFail();
      }
    }
  },
};

export const M52_SUITE: readonly SelftestCase[] = [
  speciesCase,
  noErrorsCase('no errors after the m52 checks'),
];
