import { HOTBAR_SLOTS } from '../../core/player.ts';
import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import { fill, frameOrFail, give, look, press, withinFrames } from '../automation.ts';
import {
  assert,
  needsFlatPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  standAt,
  stateKey,
  tap,
  UI_FRAMES,
} from './support.ts';

/*
 * M30 feel and units (plan v3 « M30 », the fourth play test), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): a held item is drawn alone, as the reference game holds it (the
 * bare arm otherwise); the player sprints wading in shallow water; a food's description counts in
 * ration pods with their symbol; a sprint tires the player (the reference game's exhaustion).
 * Items and blocks come from the pack's data.
 */

const SPOT = { x: 70, z: -120 };

const heldCase: SelftestCase = {
  name: 'a held item is drawn in the hand as its icon, unturned',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const tool = app.registry!.pack.items?.find((item) => item.tool);
    assert(tool, 'the pack has no tool');
    // The last two hotbar slots, whatever earlier suites left there: nothing, then the tool.
    const inventory = session.player.inventory;
    const [empty, held] = [HOTBAR_SLOTS - 2, HOTBAR_SLOTS - 1];
    inventory[empty] = null;
    inventory[held] = { item: tool.key, count: 1 };
    const hand = session.play.hand;
    // The slot is the simulation's after a tick.
    app.input!.slot = empty;
    session.step(1);
    await frameOrFail();
    assert(hand.batch.size === 1, `the bare arm is ${hand.batch.size} boxes`);
    app.input!.slot = held;
    session.step(1);
    await frameOrFail();
    assert(hand.batch.size > 1, 'the tool is not drawn');
    // Unturned: a box of the icon keeps the view's axes (no rotation in its matrix).
    const m = hand.batch.mesh.instanceMatrix.array;
    const o = 16;
    assert(Math.abs(m[o + 1]!) < 1e-6 && Math.abs(m[o + 4]!) < 1e-6, 'the held icon is turned');
    app.input!.slot = 0;
    session.step(1);
  },
};

const wadingCase: SelftestCase = {
  name: 'the player sprints wading in shallow water, faster than walking there',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const registry = app.registry!;
    const water = registry.pack.blocks.find((b) => b.liquid?.drinkable);
    assert(water, 'the pack has no water');
    const { x, z } = SPOT;
    const air = stateKey(app, registry.air);
    // A trench one block deep, 40 long, full of water.
    fill(
      app,
      x - 1,
      FLAT_SURFACE,
      z - 40,
      x + 1,
      FLAT_SURFACE,
      z,
      stateKey(app, registry.defaultState(water.key)),
    );
    try {
      const pace = async (sprint: boolean) => {
        await standAt(app, { x, z }, FLAT_SURFACE);
        // Facing north along the trench, whatever view an earlier suite left.
        look(app, 0, 0);
        session.step(10);
        const z0 = session.player.body.z;
        app.input!.force('sprint', sprint ? 40 : 0);
        press(app, 'forward', 30);
        app.input!.force('sprint', 0);
        return z0 - session.player.body.z;
      };
      const walk = await pace(false);
      const run = await pace(true);
      assert(run > walk * 1.3, `wading: ${walk.toFixed(2)} walking, ${run.toFixed(2)} sprinting`);
    } finally {
      fill(
        app,
        x - 1,
        FLAT_SURFACE,
        z - 40,
        x + 1,
        FLAT_SURFACE,
        z,
        stateKey(app, registry.defaultState(registry.pack.worldgen!.stone)),
      );
      void air;
    }
  },
};

const unitsCase: SelftestCase = {
  name: 'a food counts in ration pods with their symbol; a sprint tires the player',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    await standAt(app, SPOT);
    const food = app.registry!.pack.items?.find((item) => item.consume?.hunger);
    assert(food, 'the pack has no food');
    give(app, food.key, 1);
    app.inventory!.closeScreen();
    tap('KeyE', 'e');
    const slot = session.player.inventory.findIndex((stack) => stack?.item === food.key);
    const view = () =>
      document.querySelector<HTMLElement>(`#screen-bag [data-slot="${slot}"].filled`);
    assert(await withinFrames(UI_FRAMES, () => view() !== null), 'the food does not show');
    const box = view()!.getBoundingClientRect();
    const at = { clientX: box.left + 4, clientY: box.top + 4, bubbles: true };
    view()!.dispatchEvent(new PointerEvent('pointermove', at));
    view()!.dispatchEvent(new PointerEvent('pointerover', at));
    const symbol = document.querySelector('#screen-bag > .tooltip-anchor .mini-icon.gauge-hunger');
    assert(symbol, 'the food’s description has no ration pod');
    app.inventory!.closeScreen();
    // A sprint tires the player (the reference game's exhaustion).
    const survival = session.player.survival;
    survival.exhaustion = 0;
    look(app, 0, 0);
    app.input!.force('sprint', 60);
    press(app, 'forward', 60);
    app.input!.force('sprint', 0);
    assert(survival.exhaustion > 0, 'two seconds of sprint did not tire the player');
  },
};

export const M30_SUITE: readonly SelftestCase[] = [
  heldCase,
  wadingCase,
  unitsCase,
  noErrorsCase('no errors after the m30 checks'),
];
