import { blockToColumn, SECTION_SIZE } from '../../world/coords.ts';
import { caveAt } from '../../world/gen/caves.ts';
import { spiral } from '../../world/gen/find.ts';
import { heightAt, LatticeCache } from '../../world/gen/sample.ts';
import { waitForChunks } from '../automation.ts';
import { teleportAndWait } from '../bench/stage.ts';
import {
  assert,
  needsGeneratedPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
} from './support.ts';

/*
 * M24 underground (plan v3 « M24 »), in the generated world with fixed steps
 * (?seed=7&rd=4&fixedStep=1): a cave entrance opens within 96 blocks of the spawn, and the stone
 * of the columns around the spawn holds both common ores (the ores of every biome, from the pack).
 */

const ENTRANCE_RADIUS = 96;
/** Entrances are looked for every few blocks. */
const STEP = 4;

const entranceCase: SelftestCase = {
  name: `a cave entrance opens within ${ENTRANCE_RADIUS} blocks of the spawn`,
  scenes: PLAY_SCENES,
  skip: (app) => needsGeneratedPlayer(app) ?? (app.params.fixedStep ? null : 'needs ?fixedStep'),
  run: async (app) => {
    const session = await playerSession(app);
    const gen = session.host.view.gen;
    const cache = new LatticeCache();
    const home = { x: Math.floor(session.spawn.x), z: Math.floor(session.spawn.z) };
    let found: { x: number; z: number } | null = null;
    spiral(Math.ceil(ENTRANCE_RADIUS / STEP), (dx, dz) => {
      const x = home.x + dx * STEP;
      const z = home.z + dz * STEP;
      const h = heightAt(gen, cache, x, z);
      if (h < gen.def.seaLevel || !caveAt(gen, cache, x, h, z)) return false;
      if (!caveAt(gen, cache, x, h - 3, z)) return false;
      found = { x, z };
      return true;
    });
    assert(found, `no cave entrance within ${ENTRANCE_RADIUS} blocks of the spawn`);
  },
};

const commonsCase: SelftestCase = {
  name: 'the stone around the spawn holds every common ore',
  scenes: PLAY_SCENES,
  timeoutMs: 60_000,
  skip: (app) => needsGeneratedPlayer(app) ?? (app.params.fixedStep ? null : 'needs ?fixedStep'),
  run: async (app) => {
    const session = await playerSession(app);
    await teleportAndWait(app, session.spawn.x, 'surface', session.spawn.z);
    await waitForChunks(app, 1, 30_000);
    const view = session.host.view;
    const commons = view.gen.ores.filter((o) => o.biomes.every((b) => b === 1) && !o.caveWall);
    assert(commons.length >= 2, 'the pack has fewer than 2 common ores');
    const pcx = blockToColumn(session.player.body.x);
    const pcz = blockToColumn(session.player.body.z);
    const seen = new Set<number>();
    for (let cz = pcz - 1; cz <= pcz + 1; cz++)
      for (let cx = pcx - 1; cx <= pcx + 1; cx++)
        for (let z = cz * SECTION_SIZE; z < (cz + 1) * SECTION_SIZE; z += 1)
          for (let x = cx * SECTION_SIZE; x < (cx + 1) * SECTION_SIZE; x += 1)
            for (let y = view.gen.def.deepStoneBelowY; y < 130; y++)
              seen.add(view.world.getBlock(x, y, z));
    for (const ore of commons)
      assert(seen.has(ore.block), `no ${app.registry!.states[ore.block]!.key} around the spawn`);
  },
};

export const M24_SUITE: readonly SelftestCase[] = [
  entranceCase,
  commonsCase,
  noErrorsCase('no errors after the m24 checks'),
];
