import { findBiome } from '../../world/gen/find.ts';
import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import type { App } from '../App.ts';
import { fill, waitForChunks, withinFrames } from '../automation.ts';
import { cavePose } from '../bench/cave.ts';
import { teleportAndWait } from '../bench/stage.ts';
import {
  arenaOf,
  assert,
  needsFlatPlayer,
  needsGeneratedPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  SEARCH_RADIUS,
  type SelftestCase,
  standAt,
  stateKey,
} from './support.ts';

/*
 * M53 the realistic sound engine (plan v5 « M53 », decision 33): the effects ring only in a real
 * room. In the generated world with fixed steps (?seed=7&rd=4&fixedStep=1) every biome is dry,
 * the forests and the Sporefen included, and a cave rings; in the flat world
 * (?worldType=flat&fixedStep=1) a closed hut rings, the open meadow is dry.
 */

/** Frames the room probe gets to hear a new place. */
const ROOM_FRAMES = 40;

/** The room the effects ring in, once it is `room` (or the frames run out). */
async function roomBecomes(app: App, room: string): Promise<string | null> {
  const audio = app.audio!;
  await withinFrames(ROOM_FRAMES, () => audio.reverb() === room);
  return audio.reverb();
}

const outdoorsCase: SelftestCase = {
  name: 'every biome is dry, the forests and the Sporefen included; a cave rings',
  scenes: PLAY_SCENES,
  timeoutMs: 240_000,
  skip: (app) => needsGeneratedPlayer(app) ?? (app.params.fixedStep ? null : 'needs ?fixedStep'),
  run: async (app) => {
    const session = await playerSession(app);
    const gen = session.host.view.gen;
    const home = { x: Math.floor(session.spawn.x), z: Math.floor(session.spawn.z) };
    try {
      for (const { def } of gen.biomes) {
        const biome = def.key;
        const hit = findBiome(gen, biome, home, SEARCH_RADIUS);
        assert(hit, `no ${biome} within ${SEARCH_RADIUS} blocks`);
        await teleportAndWait(app, hit.x + 0.5, 'surface', hit.z + 0.5);
        await waitForChunks(app, 2, 30_000);
        const room = await roomBecomes(app, 'dry');
        assert(room === 'dry', `in ${biome} the effects ring in ${room}`);
      }
      const cave = cavePose(app);
      await teleportAndWait(app, cave.x + 0.5, cave.y, cave.z + 0.5);
      await waitForChunks(app, 2, 30_000);
      const room = await roomBecomes(app, 'cave');
      assert(room === 'cave', `in a cave the effects ring in ${room}`);
    } finally {
      await teleportAndWait(app, session.spawn.x, 'surface', session.spawn.z);
    }
  },
};

/** Where the hut is built, away from the other cases' places. */
const HUT = { x: 96, z: 96 };

const hutCase: SelftestCase = {
  name: 'a closed hut rings, the meadow is dry',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    await playerSession(app);
    const registry = app.registry!;
    const stone = stateKey(app, registry.defaultState(arenaOf(app).cabin.wall));
    const air = stateKey(app, registry.air);
    const { x, z } = HUT;
    const y = FLAT_SURFACE + 1;
    await standAt(app, HUT);
    assert((await roomBecomes(app, 'dry')) === 'dry', `the meadow rings in ${app.audio!.reverb()}`);
    try {
      // Walls 3 blocks around, 4 high, a roof, a doorway on the north side.
      fill(app, x - 3, y, z - 3, x + 3, y + 4, z + 3, stone);
      fill(app, x - 2, y, z - 2, x + 2, y + 3, z + 2, air);
      fill(app, x, y, z - 3, x, y + 1, z - 3, air);
      const room = await roomBecomes(app, 'indoor');
      assert(room === 'indoor', `in the hut the effects ring in ${room}`);
    } finally {
      fill(app, x - 3, y, z - 3, x + 3, y + 4, z + 3, air);
    }
  },
};

export const M53_SUITE: readonly SelftestCase[] = [
  outdoorsCase,
  hutCase,
  noErrorsCase('no errors after the m53 checks'),
];
