import { HOTBAR_SLOTS } from '../../core/player.ts';
import { frameOrFail, look, withinFrames } from '../automation.ts';
import { hudLayout } from '../hudLayout.ts';
import {
  assert,
  needsFlatPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
} from './support.ts';

/*
 * M35 HUD readability and layout (plan v3 « M35 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): every HUD element shown at once fits the window with none over
 * another (the e2e checks 1024×768, 1280×720 and 1920×1080); eating brings the hand up to the
 * mouth, bobbing, and back once the meal stops. The food comes from the pack's data.
 */

const layoutCase: SelftestCase = {
  name: 'every HUD element fits the window, none over another',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    await playerSession(app);
    app.inventory!.closeScreen();
    await frameOrFail();
    const layout = hudLayout();
    assert(layout.outside.length === 0, `out of the window: ${layout.outside.join(', ')}`);
    assert(layout.over.length === 0, `over another: ${layout.over.join(', ')}`);
  },
};

const eatCase: SelftestCase = {
  name: 'eating brings the hand up to the mouth, bobbing, and back after',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const food = app.registry!.pack.items?.find((item) => item.consume?.hunger && !item.places);
    assert(food, 'the pack has no food');
    const slot = HOTBAR_SLOTS - 1;
    const inventory = session.player.inventory;
    inventory[slot] = { item: food.key, count: 8 };
    app.input!.slot = slot;
    session.step(1);
    const hand = session.play.hand;
    const fist = () => {
      const m = hand.batch.mesh.instanceMatrix.array;
      return { x: m[12]!, y: m[13]! };
    };
    await withinFrames(3, () => false);
    const rest = fist();
    try {
      // Looking at the sky (nothing to aim at), secondary held: the meal starts.
      look(app, 0, 1.2);
      app.input!.force('secondary', 1000);
      session.step(2);
      const up = await withinFrames(30, () => fist().y > rest.y + 0.1 && fist().x < rest.x - 0.2);
      assert(
        up,
        `eating, the hand stays at ${JSON.stringify(fist())} (rest ${JSON.stringify(rest)})`,
      );
    } finally {
      app.input!.force('secondary', 0);
      session.step(2);
      look(app, 0, 0);
    }
    // Back at rest, give or take the sway of the view turned back level.
    const back = await withinFrames(60, () => Math.abs(fist().y - rest.y) < 0.01);
    assert(back, 'the hand did not come back after the meal');
    inventory[slot] = null;
    app.input!.slot = 0;
    session.step(1);
  },
};

export const M35_SUITE: readonly SelftestCase[] = [
  layoutCase,
  eatCase,
  noErrorsCase('no errors after the m35 checks'),
];
