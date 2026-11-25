import { ticksOf } from '../../sim/clock.ts';
import { press, setBlock, waitForChunks } from '../automation.ts';
import {
  aimAt,
  arenaOf,
  assert,
  type Cell,
  needsArenaPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  standAt,
  stateKey,
} from './support.ts';

/*
 * M15 water (docs plan v2 « M15 — L'eau »), in the arena with fixed steps
 * (?worldType=arena&fixedStep=1): a channel is dug from the pond's east bank to a hole; the player
 * breaks the bank's shore block and the pond pours in, one level thinner a block, then falls into
 * the hole. Blocks come from the arena's data (its pond's liquid and shore), never by content key.
 */

/** The pond's east bank (the arena's pond: centre (−8, 3), water to radius 3, shore to 4). */
const BANK: Cell = { x: -4, y: 64, z: 3 };
const SPOT = { x: 0, z: 3 };

const channelCase: SelftestCase = {
  name: 'a broken bank lets the pond flow down a channel, a level a block, into a hole',
  scenes: PLAY_SCENES,
  skip: needsArenaPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const registry = app.registry!;
    const pond = arenaOf(app).pond;
    const liquid = registry.blocks.find((def) => def.key === pond.liquid);
    assert(liquid?.liquid?.flow, 'the arena pond’s liquid does not flow');
    const world = session.host.view.world;
    const keyAt = (x: number, y: number, z: number) => stateKey(app, world.getBlock(x, y, z));
    const air = stateKey(app, registry.air);
    assert(
      keyAt(BANK.x, BANK.y, BANK.z) === stateKey(app, registry.defaultState(pond.shore)),
      'no shore at the bank',
    );
    await standAt(app, SPOT);
    await waitForChunks(app, 1, 15_000);
    // The channel east of the bank, two blocks long, ends over a hole.
    setBlock(app, BANK.x + 1, BANK.y, BANK.z, air);
    setBlock(app, BANK.x + 2, BANK.y, BANK.z, air);
    setBlock(app, BANK.x + 2, BANK.y - 1, BANK.z, air);
    await aimAt(app, BANK);
    press(app, 'primary', ticksOf(10));
    press(app, 'primary', 0);
    assert(
      keyAt(BANK.x, BANK.y, BANK.z) !== stateKey(app, registry.defaultState(pond.shore)),
      'the bank still stands',
    );
    session.step(ticksOf(liquid.liquid.flow.seconds) * 8);
    const at = (level: number, falling = 0) => {
      let state = registry.withState(registry.defaultState(pond.liquid), 'level', String(level));
      state = registry.withState(state, 'falling', String(falling));
      return stateKey(app, state);
    };
    const expected: [Cell, string][] = [
      [BANK, at(1)],
      [{ ...BANK, x: BANK.x + 1 }, at(2)],
      [{ ...BANK, x: BANK.x + 2 }, at(3)],
      [{ x: BANK.x + 2, y: BANK.y - 1, z: BANK.z }, at(1, 1)],
      [{ x: BANK.x + 3, y: BANK.y + 1, z: BANK.z }, air],
    ];
    for (const [cell, key] of expected) {
      const found = keyAt(cell.x, cell.y, cell.z);
      assert(found === key, `(${cell.x}, ${cell.y}, ${cell.z}) holds ${found}, not ${key}`);
    }
  },
};

export const M15_SUITE: readonly SelftestCase[] = [
  channelCase,
  noErrorsCase('no errors after the m15 checks'),
];
