import { blockToColumn, SECTION_SIZE } from '../../world/coords.ts';
import { findBiome } from '../../world/gen/find.ts';
import type { App } from '../App.ts';
import { waitForChunks } from '../automation.ts';
import { teleportAndWait } from '../bench/stage.ts';
import {
  assert,
  needsGeneratedPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  SEARCH_RADIUS,
  type SelftestCase,
} from './support.ts';

/*
 * M23 biomes of Veyra (plan v3 « M23 »), in the generated world with fixed steps
 * (?seed=7&rd=4&fixedStep=1): a teleport into each biome with trees finds its signature species
 * (the crown of its first feature) in the columns around the player. Biomes and species come from
 * the pack's data.
 */

/** Columns scanned around the player (each side). */
const AROUND = 1;

/** How many blocks of a state the loaded columns around the player hold. */
function countAround(app: App, state: number): number {
  const session = app.session!;
  const world = session.host.view.world;
  const b = session.player.body;
  const pcx = blockToColumn(b.x);
  const pcz = blockToColumn(b.z);
  let n = 0;
  for (let cz = pcz - AROUND; cz <= pcz + AROUND; cz++)
    for (let cx = pcx - AROUND; cx <= pcx + AROUND; cx++)
      for (let z = cz * SECTION_SIZE; z < (cz + 1) * SECTION_SIZE; z++)
        for (let x = cx * SECTION_SIZE; x < (cx + 1) * SECTION_SIZE; x++) {
          const top = world.heightAt(x, z);
          for (let y = Math.max(1, top - 12); y <= top + 2; y++)
            if (world.getBlock(x, y, z) === state) n++;
        }
  return n;
}

const speciesCase: SelftestCase = {
  name: 'each biome with trees shows its signature species around a teleport into it',
  scenes: PLAY_SCENES,
  timeoutMs: 240_000,
  skip: (app) => needsGeneratedPlayer(app) ?? (app.params.fixedStep ? null : 'needs ?fixedStep'),
  run: async (app) => {
    const session = await playerSession(app);
    const gen = session.host.view.gen;
    const registry = app.registry!;
    const home = { x: Math.floor(session.spawn.x), z: Math.floor(session.spawn.z) };
    for (const biome of gen.biomes) {
      const signature = biome.features[0]?.feature;
      if (!signature) continue;
      const shown = signature.crown >= 0 ? signature.crown : signature.block;
      const hit = findBiome(gen, biome.def.key, home, SEARCH_RADIUS);
      assert(hit, `no ${biome.def.key} within ${SEARCH_RADIUS} blocks`);
      await teleportAndWait(app, hit.x + 0.5, 'surface', hit.z + 0.5);
      await waitForChunks(app, AROUND + 1, 30_000);
      const n = countAround(app, shown);
      assert(
        n > 0,
        `no ${registry.states[shown]!.key} around (${hit.x}, ${hit.z}) in ${biome.def.key}`,
      );
    }
    await teleportAndWait(app, session.spawn.x, 'surface', session.spawn.z);
  },
};

export const M23_SUITE: readonly SelftestCase[] = [
  speciesCase,
  noErrorsCase('no errors after the m23 checks'),
];
