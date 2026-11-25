import { SLEEP_HOSTILES_HINT } from '../../sim/sleep.ts';
import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import { freezeTime, press, setBlock, setTime } from '../automation.ts';
import { killCreature, placeCreature } from '../creatureAutomation.ts';
import { god, setStat } from '../survivalAutomation.ts';
import {
  aimAt,
  assert,
  eventsDuring,
  keepingClock,
  needsFlatPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  readClock,
  type SelftestCase,
  standAt,
  stateKey,
} from './support.ts';

/*
 * M20 simplified survival (plan v3 « M20 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): a bedroll on open ground sleeps the night away, refused while a
 * hostile creature stands 7 blocks off; a body in the first cold band takes no damage and the HUD
 * names no status. The bedroll and the hostile come from the pack's data, never by content key.
 */

const SPOT = { x: -50, z: -50 };
/** A hostile 7 blocks from the player: within `sleep.hostileRadius` (8). */
const HOSTILE_GAP = 7;
/** Aim just above the floor in the middle of the bedroll's cell. */
const LOW_AIM = 1 / 16;

const sleepCase: SelftestCase = {
  name: 'a bedroll in the open sleeps the night away, refused with a hostile 7 blocks off',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const registry = app.registry!;
    await standAt(app, SPOT);
    const bedroll = registry.blocks.find((def) => def.blockEntity === 'bed');
    const hostile = (registry.pack.creatures ?? []).find((c) => c.category === 'hostile');
    assert(bedroll && hostile, 'the pack lacks a bedroll or a hostile creature');
    const bed = { x: SPOT.x, y: FLAT_SURFACE + 1, z: SPOT.z - 2 };
    setBlock(app, bed.x, bed.y, bed.z, stateKey(app, registry.defaultState(bedroll.key)));
    god(app, true);
    try {
      await keepingClock(app, async () => {
        setTime(app, 23);
        freezeTime(app, true);
        const id = placeCreature(
          app,
          hostile.key,
          SPOT.x + 0.5,
          'surface',
          SPOT.z + 0.5 + HOSTILE_GAP,
        );
        assert(id !== null, `no ${hostile.key} placed`);
        await aimAt(app, bed, LOW_AIM);
        const refused = eventsDuring(app, () => press(app, 'secondary', 1));
        const hints = refused.flatMap((e) => (e.type === 'hint' ? [e.key] : []));
        assert(hints.includes(SLEEP_HOSTILES_HINT), `a hostile at 7 blocks gave ${hints.join()}`);
        assert(session.player.sleeping === null, 'the player sleeps beside a hostile');
        killCreature(app, id);
        session.step(60);
        const day = readClock(app).day;
        await aimAt(app, bed, LOW_AIM);
        press(app, 'secondary', 1);
        const clock = readClock(app);
        assert(clock.day === day + 1, `after sleeping in the open it is day ${clock.day}`);
        const respawn = session.player.respawn;
        assert(
          respawn?.x === bed.x && respawn.y === bed.y && respawn.z === bed.z,
          'the bedroll is not the respawn point',
        );
      });
    } finally {
      god(app, false);
    }
  },
};

const coldCase: SelftestCase = {
  name: 'the first cold band takes no health, and the HUD lists no status',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const b = app.registry!.pack.balance;
    await standAt(app, SPOT);
    const max = b.health.max;
    setStat(app, 'health', max);
    setStat(app, 'temperature', -(b.temperature.severeAt - 10));
    session.step(5 * 30);
    const s = session.player.survival;
    assert(s.temperature > -b.temperature.severeAt, `the body fell to ${s.temperature}`);
    assert(s.health === max, `the cold band took health: ${s.health}`);
    assert(!document.querySelector('#hud-effects'), 'the HUD still lists statuses');
    setStat(app, 'temperature', 0);
  },
};

export const M20_SUITE: readonly SelftestCase[] = [
  sleepCase,
  coldCase,
  noErrorsCase('no errors after the m20 checks'),
];
