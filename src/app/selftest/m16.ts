import { FLAG_LIQUID } from '../../content/registry.ts';
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
 * M16 world generation (docs plan v2 « M16 »), in the generated world with fixed steps
 * (?seed=7&rd=4&fixedStep=1): the water the world generates never rests beside or above air (it
 * would flow at the first touch), and a teleport onto a cave opening lands on its floor unhurt.
 */

/** Openings are looked for this far from the player, every few blocks. */
const OPENING_RADIUS = 600;
const OPENING_STEP = 3;

const stillWaterCase: SelftestCase = {
  name: 'no generated liquid rests beside or above air around the player',
  scenes: PLAY_SCENES,
  skip: needsGeneratedPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const world = session.host.view.world;
    const { air, tables } = app.registry!;
    const b = session.player.body;
    const cx = blockToColumn(b.x);
    const cz = blockToColumn(b.z);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const x0 = (cx + dx) * SECTION_SIZE;
        const z0 = (cz + dz) * SECTION_SIZE;
        for (let z = z0; z < z0 + SECTION_SIZE; z++)
          for (let x = x0; x < x0 + SECTION_SIZE; x++)
            for (let y = 1; y < 140; y++) {
              if ((tables.flags[world.getBlock(x, y, z)]! & FLAG_LIQUID) === 0) continue;
              const open =
                world.getBlock(x, y - 1, z) === air ||
                world.getBlock(x - 1, y, z) === air ||
                world.getBlock(x + 1, y, z) === air ||
                world.getBlock(x, y, z - 1) === air ||
                world.getBlock(x, y, z + 1) === air;
              assert(!open, `the liquid at (${x}, ${y}, ${z}) touches air`);
            }
      }
  },
};

const openingCase: SelftestCase = {
  name: 'a teleport onto a cave opening lands on its floor, unhurt',
  scenes: PLAY_SCENES,
  skip: (app) => needsGeneratedPlayer(app) ?? (app.params.fixedStep ? null : 'needs ?fixedStep'),
  run: async (app) => {
    const session = await playerSession(app);
    const gen = session.host.view.gen;
    const cache = new LatticeCache();
    const b = session.player.body;
    const from = { x: Math.floor(b.x), z: Math.floor(b.z) };
    let opening: { x: number; z: number; h: number } | null = null;
    spiral(Math.ceil(OPENING_RADIUS / OPENING_STEP), (dx, dz) => {
      const x = from.x + dx * OPENING_STEP;
      const z = from.z + dz * OPENING_STEP;
      const h = heightAt(gen, cache, x, z);
      if (h < gen.def.seaLevel || !caveAt(gen, cache, x, h, z)) return false;
      opening = { x, z, h };
      return true;
    });
    assert(opening, `no cave opening within ${OPENING_RADIUS} blocks`);
    const { x, z, h } = opening as { x: number; z: number; h: number };
    const health = session.player.survival.health;
    await teleportAndWait(app, x + 0.5, 'surface', z + 0.5);
    await waitForChunks(app, 1, 25_000);
    session.step(60);
    assert(b.onGround, `the player did not land at (${x}, ${z})`);
    assert(b.y <= h, `the player stands at y ${b.y}, not below the opened surface (${h})`);
    assert(
      session.player.survival.health >= health,
      `the landing hurt: ${health} → ${session.player.survival.health}`,
    );
  },
};

export const M16_SUITE: readonly SelftestCase[] = [
  stillWaterCase,
  openingCase,
  noErrorsCase('no errors after the m16 checks'),
];
