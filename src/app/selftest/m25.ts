import type { CreatureState } from '../../sim/creatures.ts';
import { setTime } from '../automation.ts';
import { placeCreature } from '../creatureAutomation.ts';
import {
  assert,
  lookAt,
  needsFlatPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  standAt,
} from './support.ts';

/*
 * M25 fauna of the new biomes (plan v3 « M25 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): every creature that is the only one of a biome (the Capwood's
 * grazer, the Mirror Basin's wader, the Ochre Waste's rammer) is placed in front of the player,
 * drawn, and goes about its life for a few seconds. Creatures come from the pack's data.
 */

const SPOT = { x: 60, z: -60 };

const faunaCase: SelftestCase = {
  name: 'the creature alone in its biome, for each such biome, is placed, drawn and lives on',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    setTime(app, 12);
    await standAt(app, SPOT);
    const creatures = app.registry!.pack.creatures ?? [];
    const biomesOf = (c: (typeof creatures)[number]) =>
      c.spawn.flatMap((s) => (s.biomes === '*' ? [] : s.biomes));
    const alone = (biome: `biome:${string}`) =>
      creatures.filter((c) => biomesOf(c).includes(biome)).length === 1;
    const fauna = creatures.filter((c) => biomesOf(c).some(alone));
    assert(fauna.length >= 2, `only ${fauna.length} creatures alone in a biome`);
    const placed: CreatureState[] = [];
    fauna.forEach((def, i) => {
      const id = placeCreature(app, def.key, SPOT.x + 0.5 + 3 * i - 1.5, 'surface', SPOT.z - 6.5);
      assert(id !== null, `no ${def.key} placed`);
      placed.push(session.host.view.entities.get(id) as CreatureState);
    });
    const first = placed[0]!;
    await lookAt(app, first.body.x, first.body.y + 0.6, first.body.z);
    session.step(90);
    for (const c of placed)
      assert(c.health > 0 && c.mode !== 'dying', `${c.creature} did not live on`);
  },
};

export const M25_SUITE: readonly SelftestCase[] = [
  faunaCase,
  noErrorsCase('no errors after the m25 checks'),
];
