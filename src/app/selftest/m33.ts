import { blockItemKey } from '../../content/items.ts';
import { HOTBAR_SLOTS } from '../../core/player.ts';
import { ticksOf } from '../../sim/clock.ts';
import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import { fill, press } from '../automation.ts';
import {
  aimAt,
  assert,
  lookAt,
  needsFlatPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  standAt,
  stateKey,
} from './support.ts';

/*
 * M33 farming and fishing (plan v3 « M33 »): a hoe tills the ground into farmland, watered by a
 * pool nearby; a crop planted on it from its harvest starts bare, ripens in the light within its
 * time, is picked by secondary (its harvest popped out at its foot, picked
 * up from one block away; the plant bare again); a rod held on a pool of water with fish lands a catch and wears. Crops, rods and fish
 * come from the pack's data.
 */

const SPOT = { x: 110, z: -60 };
/** The last hotbar slot, whatever earlier suites left there. */
const SLOT = HOTBAR_SLOTS - 1;

const cropCase: SelftestCase = {
  name: 'a hoe tills watered farmland; a crop planted there ripens, is picked and grows back',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const registry = app.registry!;
    const crop = registry.pack.blocks.find((b) => b.crop);
    assert(crop?.crop, 'the pack has no crop');
    const harvest = registry.loot(crop.crop.harvest)!.entries.map((e) => e.item as string);
    const inventory = session.player.inventory;
    const count = () =>
      inventory.reduce((n, s) => n + (s && harvest.includes(s.item) ? s.count : 0), 0);
    const world = session.host.view.world;
    // One block ahead: its harvest drops within the player's reach.
    const cell = { x: SPOT.x, y: FLAT_SURFACE + 1, z: SPOT.z - 1 };
    const ground = { ...cell, y: cell.y - 1 };
    const pool = { x: SPOT.x + 2, y: FLAT_SURFACE, z: SPOT.z - 1 };
    const under = world.getBlock(ground.x, ground.y, ground.z);
    const ripe = () => registry.prop(world.getBlock(cell.x, cell.y, cell.z), 'ripe');
    const hoe = registry.items.find((item) => item.hoe);
    const water = registry.pack.blocks.find((b) => b.liquid?.fish);
    assert(hoe?.hoe && water, 'the pack has no hoe or no water');
    try {
      await standAt(app, SPOT);
      const { x, y, z } = pool;
      fill(app, x, y, z, x, y, z, stateKey(app, registry.defaultState(water.key)));
      // Tilled with a hoe: farmland, watered by the pool two blocks off.
      inventory[SLOT] = { item: hoe.key, count: 1, durability: hoe.hoe.durability };
      app.input!.slot = SLOT;
      session.step(1);
      await aimAt(app, ground, 0.99);
      press(app, 'secondary', 1);
      press(app, 'secondary', 0);
      session.step(1);
      const soil = world.getBlock(ground.x, ground.y, ground.z);
      assert(
        registry.blockDef(soil).soil && registry.prop(soil, 'moist') === '1',
        `tilled, the ground is ${stateKey(app, soil)}`,
      );
      // Planted from its harvest (berries), else from its own item, on the farmland.
      const seed = registry.items.find((item) => item.places === crop.key)?.key;
      inventory[SLOT] = { item: seed ?? blockItemKey(crop.key), count: 1 };
      session.step(1);
      await aimAt(app, ground, 0.99);
      press(app, 'secondary', 1);
      press(app, 'secondary', 0);
      session.step(1);
      assert(
        ripe() === '0',
        `planted, the crop is ${stateKey(app, world.getBlock(cell.x, cell.y, cell.z))}`,
      );
      session.step(ticksOf(crop.crop.seconds[1]) + 1);
      assert(ripe() === '1', 'the crop did not ripen under the sky');
      const before = count();
      await aimAt(app, cell);
      press(app, 'secondary', 1);
      session.step(30);
      assert(ripe() === '0', 'picked, the crop is not bare');
      assert(count() > before, 'the harvest did not reach the bag');
    } finally {
      fill(app, cell.x, cell.y, cell.z, cell.x, cell.y, cell.z, stateKey(app, registry.air));
      fill(app, ground.x, ground.y, ground.z, ground.x, ground.y, ground.z, stateKey(app, under));
      fill(app, pool.x, pool.y, pool.z, pool.x, pool.y, pool.z, stateKey(app, under));
      inventory[SLOT] = null;
      app.input!.slot = 0;
      session.step(1);
    }
  },
};

const fishingCase: SelftestCase = {
  name: 'a rod held on water with fish lands a catch and wears',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const registry = app.registry!;
    const rod = registry.items.find((item) => item.rod);
    const water = registry.pack.blocks.find((b) => b.liquid?.fish);
    assert(rod?.rod && water, 'the pack has no rod or no water with fish');
    const inventory = session.player.inventory;
    // A one-block pool dug into the ground two blocks ahead.
    const pool = { x: SPOT.x, y: FLAT_SURFACE, z: SPOT.z - 2 };
    const view = session.host.view;
    const ground = view.world.getBlock(pool.x, pool.y, pool.z);
    const fish =
      view.gen.biomeDefs[view.world.biomeAt(pool.x, pool.z)]?.fish ?? water.liquid!.fish!;
    const catches = registry.loot(fish)!.entries.map((e) => e.item as string);
    const count = () =>
      inventory.reduce((n, s) => n + (s && catches.includes(s.item) ? s.count : 0), 0);
    try {
      await standAt(app, SPOT);
      const { x, y, z } = pool;
      fill(app, x, y, z, x, y, z, stateKey(app, registry.defaultState(water.key)));
      inventory[SLOT] = { item: rod.key, count: 1, durability: rod.rod.durability };
      app.input!.slot = SLOT;
      session.step(1);
      const before = count();
      await lookAt(app, x + 0.5, y + 0.9, z + 0.5);
      press(app, 'secondary', ticksOf(rod.rod.seconds[1]) + 2);
      press(app, 'secondary', 0);
      session.step(1);
      assert(count() > before, 'nothing was caught');
      const left = inventory[SLOT]?.durability ?? 0;
      assert(left === rod.rod.durability - 1, `the rod has ${left} uses left`);
    } finally {
      const { x, y, z } = pool;
      fill(app, x, y, z, x, y, z, stateKey(app, ground));
      inventory[SLOT] = null;
      app.input!.slot = 0;
      session.step(1);
    }
  },
};

export const M33_SUITE: readonly SelftestCase[] = [
  cropCase,
  fishingCase,
  noErrorsCase('no errors after the m33 checks'),
];
