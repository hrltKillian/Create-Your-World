import { blockItemKey } from '../../content/items.ts';
import { DROPS } from '../../sim/itemDrops.ts';
import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import { deepStoneAt, flatBiome } from '../../world/gen/generateColumn.ts';
import { fill, give, look, press, waitForChunks, withinFrames } from '../automation.ts';
import {
  aimAt,
  assert,
  needsFlatPlayer,
  needsGeneratedPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  standAt,
  stateKey,
  UI_FRAMES,
} from './support.ts';

/*
 * M29 world and rules (plan v3 « M29 », the third play test): a thrown item comes back after its
 * delay to the thrower standing on it; lava burns the player, who keeps burning out of it (the HUD
 * shows the flames) until water puts the fire out; lava meeting water hardens; in the generated
 * world, stone and dark stone mix in a band. Blocks come from the pack's data.
 */

const SPOT = { x: -40, z: 90 };

const pickupCase: SelftestCase = {
  name: 'a thrown item comes back to the thrower standing on it after its delay',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    await standAt(app, SPOT);
    const player = session.player;
    const key = blockItemKey(app.registry!.pack.worldgen!.stone);
    give(app, key, 1);
    const count = () => player.inventory.reduce((n, s) => n + (s?.item === key ? s.count : 0), 0);
    const before = count();
    // Looking straight down: the throw lands at the feet, where the player stays.
    look(app, 0, -Math.PI / 2);
    session.step(1);
    const slot = player.inventory.findIndex((stack) => stack?.item === key);
    session.host.send({ type: 'inv.drop', slot, all: false });
    session.step(2);
    assert(count() === before - 1, 'nothing was thrown');
    session.step(DROPS.thrownPickupDelayTicks + 30);
    look(app, 0, 0);
    assert(count() === before, `the thrown item did not come back (${count()} of ${before})`);
  },
};

const lavaCase: SelftestCase = {
  name: 'lava sets the player on fire, shown on the HUD, until water puts it out',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const registry = app.registry!;
    const gen = session.host.view.gen;
    const lava = stateKey(app, gen.magma);
    const water = registry.pack.blocks.find((b) => b.liquid?.drinkable);
    assert(water, 'the pack has no drinkable liquid');
    await standAt(app, SPOT);
    const { x, z } = SPOT;
    const y = FLAT_SURFACE + 1;
    const s = session.player.survival;
    const health = s.health;
    try {
      fill(app, x, y, z, x, y, z, lava);
      session.step(8);
      assert(s.health < health, 'the lava did not hurt');
      assert(s.burnTicks > 0, 'the lava did not set the player on fire');
      fill(app, x, y, z, x, y, z, stateKey(app, registry.air));
      session.step(3);
      assert(s.burnTicks > 0, 'the fire went out at once out of the lava');
      const fire = () => document.getElementById('hud-fire');
      assert(await withinFrames(UI_FRAMES, () => fire()?.hidden === false), 'no flames on the HUD');
      fill(app, x, y, z, x, y, z, stateKey(app, registry.defaultState(water.key)));
      session.step(2);
      assert(s.burnTicks === 0, 'water did not put the fire out');
      assert(await withinFrames(UI_FRAMES, () => fire()?.hidden === true), 'the flames stay');
    } finally {
      fill(app, x, y, z, x, y, z, stateKey(app, registry.air));
      s.health = Math.max(s.health, health);
      s.burnTicks = 0;
    }
  },
};

const hardenCase: SelftestCase = {
  name: 'lava meeting water hardens into rock',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const registry = app.registry!;
    const gen = session.host.view.gen;
    const hardens = registry.blockDef(gen.magma).liquid?.hardens;
    const water = registry.pack.blocks.find((b) => b.liquid?.drinkable);
    assert(hardens && water, 'the lava does not harden, or no water');
    // Lava, a block of the surface, water, in a row in front of the player: the player breaks
    // the block between (a change the liquids wake to), the water flows onto the lava.
    const y = FLAT_SURFACE + 1;
    const x = SPOT.x + 2;
    const z = SPOT.z;
    const air = stateKey(app, registry.air);
    // The flat world's own surface: broken by hand.
    const wall = gen.biomes[flatBiome(gen)]!.surface;
    fill(app, x, y, z, x, y, z, stateKey(app, gen.magma));
    fill(app, x, y, z + 1, x, y, z + 1, stateKey(app, wall));
    fill(app, x, y, z + 2, x, y, z + 2, stateKey(app, registry.defaultState(water.key)));
    try {
      await standAt(app, { x: x - 2, z: z + 1 });
      await aimAt(app, { x, y, z: z + 1 });
      for (
        let i = 0;
        i < 600 && session.host.view.world.getBlock(x, y, z + 1) !== registry.air;
        i++
      )
        press(app, 'primary', 1);
      session.step(90);
      const there = registry.states[session.host.view.world.getBlock(x, y, z)]?.key;
      assert(there === hardens.source, `the lava source became ${there}, not ${hardens.source}`);
    } finally {
      fill(app, x, y, z, x, y + 1, z + 4, air);
    }
  },
};

const bandCase: SelftestCase = {
  name: 'stone and dark stone mix in a band, no sharp line',
  scenes: PLAY_SCENES,
  skip: needsGeneratedPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    await waitForChunks(app, 1, 30_000);
    const gen = session.host.view.gen;
    const world = session.host.view.world;
    const top = gen.def.deepStoneBelowY;
    const bx = Math.floor(session.player.body.x);
    const bz = Math.floor(session.player.body.z);
    let dark = 0;
    let stone = 0;
    for (let dz = -6; dz <= 6; dz++)
      for (let dx = -6; dx <= 6; dx++)
        for (let y = top - gen.def.deepStoneBlend; y < top; y++) {
          const state = world.getBlock(bx + dx, y, bz + dz);
          if (state === gen.deepStone) dark++;
          if (state === gen.stone) stone++;
          if (state === gen.deepStone || state === gen.stone)
            assert(
              (state === gen.deepStone) === deepStoneAt(gen, bx + dx, y, bz + dz),
              'the world and deepStoneAt disagree',
            );
        }
    assert(dark > 0 && stone > 0, `the band holds ${dark} dark stone and ${stone} stone`);
  },
};

export const M29_SUITE: readonly SelftestCase[] = [
  pickupCase,
  lavaCase,
  hardenCase,
  bandCase,
  noErrorsCase('no errors after the m29 checks'),
];
