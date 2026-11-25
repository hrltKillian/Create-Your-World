import { fuelSlotOf } from '../../content/crafting.ts';
import { OPEN_SLOTS_BASE } from '../../sim/commands.ts';
import { PHYSICS } from '../../sim/physics.ts';
import { STAMINA } from '../../sim/player.ts';
import { moveClicks } from '../../sim/testing/slotMoves.ts';
import type { App } from '../App.ts';
import {
  blockEntityContents,
  click,
  framesFor,
  look,
  openBlock,
  sendAndStep,
  setBlock,
  waitForChunks,
} from '../automation.ts';
import { setStat } from '../survivalAutomation.ts';
import {
  assert,
  type Cell,
  eventsDuring,
  holdInHand,
  needsFlatPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  slotsAt,
  standAt,
  stateKey,
} from './support.ts';

/**
 * M12 controls and fuel checks (docs « M12 — Contrôles et combustible »), on the flat world with
 * fixed steps (?worldType=flat&fixedStep=1): a held jump jumps again on each landing; forward
 * tapped twice through real key events sprints while it stays held; eating slows the player and
 * stops the sprint; Esc closes the bag or a station back to play, never the pause menu, which only
 * Esc in play opens; a campfire with fuel and nothing to cook burns nothing until its screen's
 * « Keep burning » toggle is on. Each case stands on its own patch of the flat world.
 */

const JUMP_SPOT = { x: -36, z: 0 };
const SPRINT_SPOT = { x: -36, z: 16 };
const EAT_SPOT = { x: -36, z: 32 };
const ESC_SPOT = { x: -48, z: 0 };
const FIRE_SPOT = { x: -48, z: 16 };
/** Ticks the jump is held: 5 jumps of 18 ticks in the air, each started the tick after a landing. */
const JUMP_TICKS = 90;
/** Ticks a run lasts before its speed is read (well past the acceleration). */
const RUN_TICKS = 20;
/** The speeds compared, in m/s. */
const SPEED_EPS = 1e-6;
/** Wall time for the screens to show what the simulation keeps (they refresh at 10 Hz). */
const REFRESH_MS = 250;
/** Wall time that sets two presses of forward farther apart than a double tap (300 ms). */
const APART_MS = 400;

/** A key pressed (or released) as the keyboard sends it: at the focused element, bubbling up. */
function key(type: 'keydown' | 'keyup', code: string, name: string): void {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(
    new KeyboardEvent(type, { code, key: name, bubbles: true, cancelable: true }),
  );
}

/** A key pressed and released. */
function tap(code: string, name: string): void {
  key('keydown', code, name);
  key('keyup', code, name);
}

/** The player standing still at a spot, nothing held, stamina full, looking north. */
async function ready(app: App, spot: { x: number; z: number }): Promise<void> {
  const session = await playerSession(app);
  app.input!.releaseAll();
  app.inventory?.closeScreen();
  await standAt(app, spot);
  await waitForChunks(app, 1, 15_000);
  setStat(app, 'stamina', STAMINA.max);
  look(app, 0, 0);
  session.step(5);
}

/** The air block's key (to clear what a case built). */
const airKey = (app: App) => stateKey(app, app.registry!.air);

/** Horizontal speed of the player's body (m/s). */
function speed(app: App): number {
  const body = app.session!.player.body;
  return Math.hypot(body.vx, body.vz);
}

/** The pack's fire that may be kept burning (the campfire), its block and its station. */
function keptFire(app: App) {
  const registry = app.registry!;
  const block = registry.blocks.find(
    (def) => def.station !== undefined && registry.crafting.station(def.station)?.keepLit === true,
  );
  assert(block?.station, 'the pack has no fire that may be kept burning');
  return {
    state: registry.defaultState(block.key),
    station: registry.crafting.station(block.station)!,
  };
}

/** Whether the block at a cell shows its fire (`lit` state). */
function litBlock(app: App, { x, y, z }: Cell): boolean {
  const registry = app.registry!;
  return registry.prop(app.session!.host.view.world.getBlock(x, y, z), 'lit') === '1';
}

export const M12_SUITE: readonly SelftestCase[] = [
  {
    name: 'a held jump jumps again on each landing, never in the air, each jump paid in stamina',
    scenes: PLAY_SCENES,
    skip: needsFlatPlayer,
    run: async (app) => {
      await ready(app, JUMP_SPOT);
      const session = app.session!;
      const before = session.player.stamina;
      app.input!.force('jump', JUMP_TICKS);
      const events = eventsDuring(app, () => session.step(JUMP_TICKS));
      app.input!.force('jump', 0);
      const jumps = events.filter((e) => e.type === 'playerJumped').length;
      const landings = events.filter((e) => e.type === 'playerLanded').length;
      assert(jumps >= 4, `holding jump for ${JUMP_TICKS} ticks jumped ${jumps} times`);
      // Each jump but the last one came down before the next: none started in the air.
      assert(landings === jumps || landings === jumps - 1, `${jumps} jumps, ${landings} landings`);
      const spent = before - session.player.stamina;
      assert(spent >= jumps * STAMINA.jump - 1, `${jumps} jumps cost ${spent.toFixed(1)} stamina`);
      session.step(30);
      assert(session.player.body.onGround, 'the player did not land once jump was released');
    },
  },
  {
    name: 'forward tapped twice within 300 ms sprints while it stays held, a single press walks',
    scenes: PLAY_SCENES,
    skip: needsFlatPlayer,
    run: async (app) => {
      await ready(app, SPRINT_SPOT);
      const session = app.session!;
      const player = session.player;
      try {
        // One press: a walk.
        await framesFor(APART_MS);
        key('keydown', 'KeyW', 'w');
        session.step(RUN_TICKS);
        assert(!player.sprinting, 'a single press of forward sprints');
        assert(Math.abs(speed(app) - PHYSICS.walk) < SPEED_EPS, `walking at ${speed(app)} m/s`);
        key('keyup', 'KeyW', 'w');
        session.step(RUN_TICKS);
        // A double tap: the sprint latches while forward is held.
        await framesFor(APART_MS);
        tap('KeyW', 'w');
        key('keydown', 'KeyW', 'w');
        session.step(RUN_TICKS);
        assert(player.sprinting, 'a double tap of forward does not sprint');
        assert(Math.abs(speed(app) - PHYSICS.sprint) < SPEED_EPS, `running at ${speed(app)} m/s`);
        // Released: the sprint is over.
        key('keyup', 'KeyW', 'w');
        session.step(RUN_TICKS);
        assert(!player.sprinting && speed(app) < SPEED_EPS, 'the sprint went on after release');
      } finally {
        key('keyup', 'KeyW', 'w');
        app.input!.releaseAll();
      }
    },
  },
  {
    name: 'eating slows the player to the balance share of the walk and stops the sprint',
    scenes: PLAY_SCENES,
    skip: needsFlatPlayer,
    run: async (app) => {
      await ready(app, EAT_SPOT);
      const registry = app.registry!;
      const session = app.session!;
      const food = registry.items.find((def) => def.consume && !def.container);
      assert(food, 'the pack has no food');
      holdInHand(app, food.key, 10);
      // Running north, eating with the eyes on the sky (nothing aimed).
      look(app, 0, 1.2);
      const input = app.input!;
      for (const action of ['forward', 'sprint', 'secondary'] as const) input.force(action, 1e6);
      try {
        session.step(RUN_TICKS);
        const slow = PHYSICS.walk * registry.pack.balance.consume.moveFactor;
        assert(Math.abs(speed(app) - slow) < SPEED_EPS, `eating at ${speed(app)} m/s, not ${slow}`);
        assert(!session.player.sprinting, 'the player sprints while eating');
        input.force('secondary', 0);
        session.step(RUN_TICKS);
        assert(session.player.sprinting, 'the sprint did not come back after the meal');
      } finally {
        for (const action of ['forward', 'sprint', 'secondary'] as const) input.force(action, 0);
        session.step(RUN_TICKS);
      }
    },
  },
  {
    name: 'Esc closes the bag and a station back to play without the pause menu; Esc in play pauses',
    scenes: PLAY_SCENES,
    skip: needsFlatPlayer,
    run: async (app) => {
      await ready(app, ESC_SPOT);
      const game = app.game!;
      const session = app.session!;
      const inventory = app.inventory!;
      const playing = (what: string) => {
        assert(inventory.screen() === null, `${what}: the ${inventory.screen()} screen is open`);
        assert(app.state === 'world', `${what}: the app is ${app.state}`);
        assert(game.menus.screen() === null, `${what}: the ${game.menus.screen()} menu shows`);
        assert(!session.isPaused() && app.input!.enabled, `${what}: play is paused`);
      };
      tap('KeyE', 'e');
      assert(inventory.screen() === 'bag', `E showed ${inventory.screen()}`);
      tap('Escape', 'Escape');
      playing('Esc on the bag');
      // A station's screen too, which the simulation then closes.
      const fire = { x: ESC_SPOT.x, y: Math.floor(session.player.body.y), z: ESC_SPOT.z - 2 };
      setBlock(app, fire.x, fire.y, fire.z, stateKey(app, keptFire(app).state));
      openBlock(app, fire.x, fire.y, fire.z);
      assert(inventory.screen() === 'station', `the fire showed ${inventory.screen()}`);
      tap('Escape', 'Escape');
      playing('Esc on the station');
      session.step(1);
      assert(session.player.screen === null, 'the simulation kept the station open');
      setBlock(app, fire.x, fire.y, fire.z, airKey(app));
      // Keys play at once: forward walks.
      key('keydown', 'KeyW', 'w');
      session.step(RUN_TICKS);
      key('keyup', 'KeyW', 'w');
      assert(Math.abs(speed(app) - PHYSICS.walk) < SPEED_EPS, `after Esc: ${speed(app)} m/s`);
      session.step(RUN_TICKS);
      // Esc in play, no screen open: the pause menu; Esc again resumes (no Pointer Lock here).
      tap('Escape', 'Escape');
      assert(game.menus.screen() === 'pause', `Esc in play showed ${game.menus.screen()}`);
      assert(session.isPaused(), 'the pause menu did not pause play');
      tap('Escape', 'Escape');
      playing('Esc on the pause menu');
    },
  },
  {
    name: 'a campfire with fuel and nothing to cook burns nothing until « Keep burning » is on',
    scenes: PLAY_SCENES,
    skip: needsFlatPlayer,
    run: async (app) => {
      await ready(app, FIRE_SPOT);
      const registry = app.registry!;
      const session = app.session!;
      const { state, station } = keptFire(app);
      const cell = { x: FIRE_SPOT.x, y: Math.floor(session.player.body.y), z: FIRE_SPOT.z - 2 };
      setBlock(app, cell.x, cell.y, cell.z, stateKey(app, state));
      const fuel = registry.items.find((def) => registry.crafting.burnSeconds(def.key, 'any') > 0);
      assert(fuel, 'nothing burns');
      holdInHand(app, fuel.key, 2);
      openBlock(app, cell.x, cell.y, cell.z);
      assert(app.inventory?.screen() === 'station', `the fire showed ${app.inventory?.screen()}`);
      const to = OPEN_SLOTS_BASE + fuelSlotOf(station);
      const hand = app.input!.slot;
      const held = session.player.inventory[hand]!;
      const there = slotsAt(app, cell)[fuelSlotOf(station)];
      sendAndStep(app, ...moveClicks(registry, hand, to, held, there, 2));
      const contents = () =>
        blockEntityContents(app, cell.x, cell.y, cell.z) as {
          slots: { item: string; count: number }[];
          lit: boolean;
          keepLit: boolean;
        };
      const fuelLeft = () => contents().slots[fuelSlotOf(station)]?.count ?? 0;
      session.step(60);
      assert(!contents().lit && !litBlock(app, cell), 'the idle fire burns');
      assert(fuelLeft() === 2, `the idle fire burnt fuel: ${fuelLeft()} left`);
      // The toggle, as the player clicks it.
      const toggle = '#screen-station [data-action="keep-lit"]';
      assert(click(toggle), 'no « Keep burning » toggle');
      session.step(2);
      assert(contents().keepLit && contents().lit, 'the fire is not kept burning');
      assert(litBlock(app, cell) && fuelLeft() === 1, 'the kept fire does not burn its fuel');
      await framesFor(REFRESH_MS);
      const pressed = document.querySelector(toggle)?.getAttribute('aria-pressed');
      assert(pressed === 'true', `the toggle shows aria-pressed=${pressed}`);
      assert(click(toggle), 'the toggle went');
      session.step(2);
      assert(!contents().keepLit && !contents().lit, 'the fire still burns once turned off');
      app.inventory!.closeScreen();
      setBlock(app, cell.x, cell.y, cell.z, airKey(app));
    },
  },
  noErrorsCase('no errors after the m12 checks'),
];
