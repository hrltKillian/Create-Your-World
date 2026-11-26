import type { BlockKey } from '../../content/schema.ts';
import { freshStack } from '../../sim/inventory.ts';
import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import { fill, frameOrFail, look, press, setBlock, withinFrames } from '../automation.ts';
import { god } from '../survivalAutomation.ts';
import { openBag } from './screenSteps.ts';
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
  waitForSlot,
} from './support.ts';

/*
 * M46 the fifth play test's fixes (plan v5 « M46 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): the hovered item's bubble by the pointer and whole, the torch
 * hung on a wall drawn whole, lava thick and breathless, V's three views, the craft buttons in
 * view under the selected recipe.
 */

/** Places of the cases, away from the other suites'. */
const LAVA_SPOT = { x: 96, z: -96 };
const TORCH_SPOT = { x: 104, z: -96 };
/** Pixels the bubble may stand from the pointer (its gap is 14). */
const NEAR = 24;
/** The hotbar's last slot: the bubble of an item near the panel's right edge. */
const LAST_HOTBAR = 7;

const bubbleCase: SelftestCase = {
  name: 'a hovered item’s bubble shows whole beside the pointer, even by the panel’s edge',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const inventory = session.player.inventory;
    const weapon = app.registry!.items.find((item) => item.weapon !== undefined);
    assert(weapon, 'the pack has no weapon');
    const kept = inventory[LAST_HOTBAR] ?? null;
    inventory[LAST_HOTBAR] = freshStack(app.registry!, weapon.key, 1);
    try {
      openBag(app, 'logbook');
      await waitForSlot('bag', LAST_HOTBAR);
      const slot = document.querySelector<HTMLElement>(`#screen-bag [data-slot="${LAST_HOTBAR}"]`)!;
      const r = slot.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      // Straight onto the slot: the bubble shows where the pointer is now. Measured at once, like
      // m28: the browser's real pointer sends its own `pointerover` once the Bag is laid out (on
      // the backdrop, wherever it rests), and on a slow frame that comes after this one.
      slot.dispatchEvent(
        new PointerEvent('pointerover', { bubbles: true, clientX: x, clientY: y }),
      );
      const anchor = document.querySelector<HTMLElement>('#ui-tooltip');
      assert(anchor && !anchor.hidden, 'no bubble over the hovered item');
      assert(!anchor.closest('.bag-panel'), 'the bubble is inside the panel');
      const box = anchor.querySelector<HTMLElement>('.tooltip')!;
      const b = box.getBoundingClientRect();
      const beside =
        (b.left - x >= 0 && b.left - x <= NEAR) || (x - b.right >= 0 && x - b.right <= NEAR);
      assert(beside, `the bubble (${b.left}–${b.right}) is not beside the pointer at x ${x}`);
      assert(
        b.top - y >= -b.height && b.top - y <= NEAR,
        `the bubble's top ${b.top} is far from y ${y}`,
      );
      assert(b.right <= innerWidth && b.bottom <= innerHeight, 'the bubble leaves the window');
      assert(box.scrollWidth <= box.clientWidth + 1, 'the bubble is squeezed: its text overflows');
    } finally {
      app.inventory!.closeScreen();
      inventory[LAST_HOTBAR] = kept;
    }
  },
};

const wallTorchCase: SelftestCase = {
  name: 'a torch hung on a wall samples its own art on every face (drawn whole)',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    await playerSession(app);
    const registry = app.registry!;
    const torch = registry.pack.blocks.find((block) => block.wallTextures);
    assert(torch?.wallTextures?.all, 'the pack has no block with wall textures');
    const wallLayer = registry.textureKeys.indexOf(torch.wallTextures.all);
    const { x, z } = TORCH_SPOT;
    const y = FLAT_SURFACE + 2;
    const air = stateKey(app, registry.air);
    try {
      for (const side of ['n', 'e', 's', 'w']) {
        setBlock(app, x, y, z, `${torch.key}[attach=${side}]`);
        const state = app.session!.host.view.world.getBlock(x, y, z);
        assert(
          stateKey(app, state).includes(`attach=${side}`),
          `no torch hung on the ${side} wall`,
        );
        for (let face = 0; face < 6; face++) {
          const layer = registry.tables.faceLayer[state * 6 + face];
          assert(layer === wallLayer, `face ${face} on the ${side} wall samples layer ${layer}`);
        }
      }
    } finally {
      setBlock(app, x, y, z, air);
    }
  },
};

const lavaCase: SelftestCase = {
  name: 'lava drags the body at about 0.8 block a second (no swimming), a head in it keeps its breath',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const registry = app.registry!;
    const lava = registry.pack.blocks.find((b) => b.liquid?.drowns === false);
    const water = registry.pack.blocks.find((b) => b.liquid?.drinkable);
    assert(lava && water, 'the pack has no lava or no drinkable water');
    const air = stateKey(app, registry.air);
    const { x, z } = LAVA_SPOT;
    const floor = FLAT_SURFACE;
    const body = session.player.body;
    const pace = async (liquid: BlockKey) => {
      fill(
        app,
        x - 1,
        floor,
        z - 12,
        x + 1,
        floor,
        z,
        stateKey(app, registry.defaultState(liquid)),
      );
      await standAt(app, { x, z }, floor);
      look(app, 0, 0);
      const z0 = body.z;
      press(app, 'forward', 30);
      return z0 - body.z;
    };
    god(app, true);
    try {
      const inWater = await pace(water.key);
      const inLava = await pace(lava.key);
      // The reference game's lava: about 0.8 block a second, a quarter of wading in water or less.
      assert(
        inLava > 0.5 && inLava < 1 && inLava < inWater / 3,
        `lava ${inLava.toFixed(2)} m against water ${inWater.toFixed(2)} m in a second`,
      );
      // Under a column of lava: the head is in it, the breath never falls.
      fill(
        app,
        x - 1,
        floor,
        z - 1,
        x + 1,
        floor + 3,
        z + 1,
        stateKey(app, registry.defaultState(lava.key)),
      );
      await standAt(app, { x, z }, floor);
      session.step(60);
      const survival = session.player.survival;
      const full = registry.pack.balance.breath.seconds;
      assert(body.headInWater, 'the head is not in the lava');
      assert(survival.breath === full, `the breath fell to ${survival.breath} in lava`);
    } finally {
      fill(app, x - 1, floor, z - 12, x + 1, floor + 3, z + 1, air);
      god(app, false);
      session.player.survival.burnTicks = 0;
    }
  },
};

const viewsCase: SelftestCase = {
  name: 'V turns through first person, behind, in front (facing the player) and back',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const rig = session.rig;
    rig.mode = 'first';
    const seen: string[] = [rig.mode];
    try {
      for (let i = 0; i < 3; i++) {
        tap('KeyV', 'v');
        const before = seen.at(-1);
        assert(await withinFrames(10, () => rig.mode !== before), `V left the view ${before}`);
        // Read again: V changed it since the assignment above.
        const now: string = rig.mode;
        seen.push(now);
        if (now === 'front') {
          await frameOrFail();
          const turned = Math.abs(rig.pose.yaw - rig.yaw - Math.PI) < 1e-6;
          assert(turned, 'the front view does not look back at the player');
        }
      }
      assert(seen.join(' ') === 'first back front first', `the views went ${seen.join(' → ')}`);
    } finally {
      rig.mode = 'first';
    }
  },
};

const craftButtonsCase: SelftestCase = {
  name: 'the selected recipe shows under the hotbar, its craft buttons in view below its scroll',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    await playerSession(app);
    try {
      openBag(app, 'logbook');
      const row = document.querySelector<HTMLElement>('#screen-bag .logbook-row');
      assert(row, 'the Logbook lists no recipe');
      row.click();
      await frameOrFail();
      const detail = document.querySelector<HTMLElement>('#screen-bag .logbook-detail')!;
      detail.scrollTop = detail.scrollHeight;
      await frameOrFail();
      const button = document.querySelector<HTMLElement>('#screen-bag [data-action="craft-1"]');
      assert(button, 'no craft button');
      assert(!detail.contains(button), 'the craft buttons scroll with the recipe');
      const hotbar = document.querySelector<HTMLElement>(
        `#screen-bag [data-slot="${LAST_HOTBAR}"]`,
      )!;
      const panel = document.querySelector<HTMLElement>('#screen-bag .bag-panel')!;
      const b = button.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      assert(
        detail.getBoundingClientRect().top >= hotbar.getBoundingClientRect().bottom,
        'the recipe is not under the hotbar',
      );
      assert(b.top >= p.top && b.bottom <= p.bottom, 'the craft buttons are out of the panel');
    } finally {
      app.inventory!.closeScreen();
    }
  },
};

export const M46_SUITE: readonly SelftestCase[] = [
  bubbleCase,
  wallTorchCase,
  lavaCase,
  viewsCase,
  craftButtonsCase,
  noErrorsCase('no errors after the m46 checks'),
];
