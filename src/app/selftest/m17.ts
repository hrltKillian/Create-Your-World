import { STUDIED } from '../../core/creatures.ts';
import { ticksOf } from '../../sim/clock.ts';
import type { CreatureState } from '../../sim/creatures.ts';
import { give, setTime, withinFrames } from '../automation.ts';
import { placeCreature } from '../creatureAutomation.ts';
import { equip } from '../survivalAutomation.ts';
import { closeScreen, openBag } from './screenSteps.ts';
import {
  assert,
  lookAt,
  needsFlatPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  standAt,
  UI_FRAMES,
} from './support.ts';

/*
 * M17 creatures (docs plan v2 « M17 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): a worn scanner studies a creature looked at — the ring fills
 * around the crosshair, the target panel shows its state — and the Bag's Bestiary tells what it
 * is. The scanner and the creature come from the pack's data (an item that scans, a defensive
 * creature), never by content key.
 */

const SPOT = { x: -40, z: 30 };

const scannerCase: SelftestCase = {
  name: 'a worn scanner studies a creature looked at, its ring filling; the Bestiary tells of it',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const registry = app.registry!;
    setTime(app, 12);
    await standAt(app, SPOT);
    const scanner = registry.items.find((item) => item.wear?.scanner);
    assert(scanner?.wear?.scanner, 'the pack has no scanner');
    const def = (registry.pack.creatures ?? []).find((c) => c.category === 'defensive');
    assert(def, 'the pack has no defensive creature');
    give(app, scanner.key, 1);
    const from = session.player.inventory.findIndex((stack) => stack?.item === scanner.key);
    equip(app, from);
    assert(session.player.equipment[0]?.item === scanner.key, 'the scanner is not worn');
    const id = placeCreature(app, def.key, SPOT.x + 0.5, 'surface', SPOT.z - 7.5);
    assert(id !== null, `no ${def.key} placed`);
    const c = session.host.view.entities.get(id) as CreatureState;
    // It stays put: a calm creature keeps its rest.
    c.modeTicks = 100_000;
    await lookAt(app, c.body.x, c.body.y + def.hitbox[1] / 2, c.body.z);
    session.step(ticksOf(scanner.wear.scanner.seconds / 2));
    // The HUD refreshes at 10 Hz: a few frames.
    const ring = document.getElementById('hud-scan');
    assert(ring, 'the HUD has no scan ring');
    assert(await withinFrames(UI_FRAMES, () => !ring.hidden), 'no scan ring while scanning');
    const panel = document.getElementById('hud-target')?.textContent ?? '';
    assert(panel.includes(String(def.health)), `the target panel shows « ${panel} »`);
    session.step(ticksOf(scanner.wear.scanner.seconds));
    assert(session.player.bestiary[def.key] === STUDIED, 'the creature was not studied');
    const hidden = () => ring.hidden === true;
    assert(await withinFrames(UI_FRAMES, hidden), 'the ring shows once it is studied');
    openBag(app, 'bestiary');
    const level = () =>
      document
        .querySelector(`#screen-bag [data-creature="${def.key}"]`)
        ?.getAttribute('data-level');
    assert(
      await withinFrames(UI_FRAMES, () => level() === String(STUDIED)),
      `the Bestiary card shows level ${level()}`,
    );
    closeScreen(app);
  },
};

export const M17_SUITE: readonly SelftestCase[] = [
  scannerCase,
  noErrorsCase('no errors after the m17 checks'),
];
