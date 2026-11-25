import type { CreatureState } from '../../sim/creatures.ts';
import { eyeHeight } from '../../sim/physics.ts';
import { look, press, withinFrames } from '../automation.ts';
import { killCreature, placeCreature } from '../creatureAutomation.ts';
import {
  assert,
  eventsDuring,
  needsFlatPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  standAt,
  UI_FRAMES,
} from './support.ts';

/*
 * M19 combat (plan v3 « M19 »), on the flat world with fixed steps (?worldType=flat&fixedStep=1):
 * a press strikes at once; with the attack gauge full the blow is strong, a quick second one is
 * plain, and the gauge shows under the crosshair while it fills again. The creature comes from
 * the pack's data (a grazer), never by content key.
 */

const SPOT = { x: -30, z: 40 };

const gaugeCase: SelftestCase = {
  name: 'a blow with the gauge full is strong, a quick second one plain; the gauge shows meanwhile',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    await standAt(app, SPOT);
    const grazer = (app.registry!.pack.creatures ?? []).find((c) => c.brain === 'grazer');
    assert(grazer, 'the pack has no grazer');
    const id = placeCreature(app, grazer.key, SPOT.x + 0.5, 'surface', SPOT.z - 1.5);
    assert(id !== null, 'no creature placed');
    const c = session.host.view.entities.get(id) as CreatureState;
    Object.assign(c, { modeTicks: 100_000, health: 1000 });
    while (session.player.attackCooldown > 0) session.step(1);
    const b = session.player.body;
    const dy = c.body.y + grazer.hitbox[1] / 2 - (b.y + eyeHeight(b));
    look(app, 0, Math.atan2(dy, Math.hypot(c.body.x - b.x, c.body.z - b.z)));
    const swing = () =>
      eventsDuring(app, () => {
        press(app, 'primary', 1);
        session.step(2);
      }).filter((e) => e.type === 'playerSwung');
    const first = swing();
    assert(first.length === 1 && first[0]!.strong, 'the first blow was not strong');
    const second = swing();
    assert(second.length === 1 && !second[0]!.strong, 'a quick second blow was strong');
    const gauge = document.getElementById('hud-attack');
    assert(gauge, 'the HUD has no attack gauge');
    const showing = await withinFrames(UI_FRAMES, () => !gauge.classList.contains('full'));
    assert(showing, 'the gauge does not show while it fills');
    killCreature(app, id);
  },
};

export const M19_SUITE: readonly SelftestCase[] = [
  gaugeCase,
  noErrorsCase('no errors after the m19 checks'),
];
