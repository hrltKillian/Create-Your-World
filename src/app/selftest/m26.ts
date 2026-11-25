import { findStructure, structureLootAt } from '../../world/gen/sites.ts';
import { blockEntityContents, openBlock, waitForChunks } from '../automation.ts';
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
 * M26 the lost colony (plan v3 « M26 »), in the generated world with fixed steps
 * (?seed=7&rd=4&fixedStep=1): every story site of the pack stands within its distance range of
 * the spawn, and the nearest one's chest is filled by its loot table (the capsule's parts at the
 * crash site) and opens beside it. Sites, chests and loot come from the pack's data.
 */

/** Chests are looked for this far around a site's centre. */
const REACH = 12;

const sitesCase: SelftestCase = {
  name: 'every story site stands in its range of the spawn; the nearest one’s chest holds its relics',
  scenes: PLAY_SCENES,
  timeoutMs: 120_000,
  skip: (app) => needsGeneratedPlayer(app) ?? (app.params.fixedStep ? null : 'needs ?fixedStep'),
  run: async (app) => {
    const session = await playerSession(app);
    const registry = app.registry!;
    const gen = session.host.view.gen;
    const spawn = { x: session.spawn.x, z: session.spawn.z };
    const stories = (registry.pack.structures ?? []).filter((s) => s.place);
    assert(stories.length >= 2, 'the pack has fewer than 2 story structures');
    for (const story of stories) {
      const [, max] = story.place!.distance;
      const site = findStructure(gen, story.key, spawn, max + 16);
      assert(site, `no ${story.key} within ${max} blocks of the spawn`);
    }
    // The nearest story site: beside its chest, opened, its loot there.
    const first = stories.reduce((a, b) => (a.place!.distance[1] < b.place!.distance[1] ? a : b));
    const site = findStructure(gen, first.key, spawn, first.place!.distance[1] + 16)!;
    await teleportAndWait(app, site.x + 0.5, 'surface', site.z + 0.5);
    await waitForChunks(app, 1, 30_000);
    const world = session.host.view.world;
    let chest: { x: number; y: number; z: number } | null = null;
    for (let dy = -2; dy <= 8 && !chest; dy++)
      for (let dz = -REACH; dz <= REACH && !chest; dz++)
        for (let dx = -REACH; dx <= REACH && !chest; dx++) {
          const cell = { x: site.x + dx, y: site.y + dy, z: site.z + dz };
          const block = registry.blockDef(world.getBlock(cell.x, cell.y, cell.z));
          if (block.blockEntity === 'container') chest = cell;
        }
    assert(chest, `no chest in the ${first.key}`);
    const { x, y, z } = chest;
    const table = Object.values(first.lootTables ?? {})[0];
    assert(table, `the ${first.key} has no loot table`);
    assert(structureLootAt(gen, x, y, z) === table, `the ${first.key}’s chest is not ${table}`);
    // Opened beside it (an earlier walk of the boot may have emptied it already).
    await teleportAndWait(app, x + 1.5, y, z + 0.5);
    openBlock(app, x, y, z);
    assert(blockEntityContents(app, x, y, z)?.kind === 'container', 'the chest did not open');
    app.inventory!.closeScreen();
  },
};

export const M26_SUITE: readonly SelftestCase[] = [
  sitesCase,
  noErrorsCase('no errors after the m26 checks'),
];
