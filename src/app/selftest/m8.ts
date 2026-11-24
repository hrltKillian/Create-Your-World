import { fuelSlotOf, outputSlotOf } from '../../content/crafting.ts';
import { blockItemKey } from '../../content/items.ts';
import type { ProcessDef, RecipeDef } from '../../content/schema.ts';
import { HOTBAR_SLOTS } from '../../core/player.ts';
import { ticksOf } from '../../sim/clock.ts';
import { OPEN_SLOTS_BASE } from '../../sim/commands.ts';
import { countItem } from '../../sim/inventory.ts';
import { canonicalJson } from '../../sim/stateHash.ts';
import { ingredientName } from '../../ui/itemSlot.ts';
import { ARENA_DOOR } from '../../world/gen/arena.ts';
import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import type { App } from '../App.ts';
import {
  blockEntityContents,
  blockKey,
  click,
  give,
  look,
  moveSlot,
  press,
  reloadWorld,
  setBlock,
  withinFrames,
} from '../automation.ts';
import {
  aimAt,
  arenaOf,
  assert,
  type Cell,
  needsArenaPlayer,
  needsIdb,
  noErrorsCase,
  openFromSouth,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  slotsAt,
  standAt,
  stateKey,
  UI_FRAMES,
  waitForSlot,
  workshopBlock,
} from './support.ts';

/**
 * M8 « Fait quand » browser checks in the arena (?worldType=arena&fixedStep=1&selftest=m0,m8):
 * the Logbook crafts the Flint Hatchet by clicks, which breaks a log at least 1.9× faster than the
 * hand; secondary on the workshop's kiln opens the Station screen, where ore and fuel put in by
 * slot clicks (taken onto the cursor, put down) give one ingot; the cabin door opens, lets the
 * player in and closes; a chest filled by clicks comes back whole after save.reload() (IndexedDB
 * only, the default storage) and empties with « Take all ». Content keys come from the pack's
 * arena description and recipes (engine code never names content): the arena's log, ore wall,
 * gravel and workshop row.
 */

/** Where the crafting case stands (the spawn). */
const CRAFT_SPOT = { x: 0, z: 0 };
/** Open ground east of the arena's features, and the cell north of it where the logs stand. */
const LOG_SPOT = { x: 14, z: 0 };
const LOG_CELL = { x: 14, y: FLAT_SURFACE + 1, z: -1 };
/** « step(90) »: the 2 s Flint Hatchet takes 60 ticks. */
const CRAFT_TICKS = 90;
/** « au moins 1,9 fois plus vite »: hardness 2 is 90 ticks by hand, 45 with a flint tool. */
const SPEEDUP = 1.9;
/** A log not broken after this many ticks of mining counts as a failure. */
const MAX_BREAK_TICKS = 400;
/** Ticks a process gets past its own duration (« step(330) » for the 10 s copper ingot). */
const SMELT_SLACK = 30;
/** Items stored in the chest before the reload. */
const STORED = 7;

/** State id of the arena tree's log. */
function logState(app: App): number {
  return app.registry!.defaultState(arenaOf(app).tree.log);
}

/** The hand recipe known from the start that makes the axe the arena's log wants (Flint Hatchet). */
function hatchetRecipe(app: App): RecipeDef {
  const registry = app.registry!;
  const kind = registry.blockDef(logState(app)).tool;
  const recipe = registry.crafting.recipes.find(
    (r) =>
      r.known === 'start' &&
      r.station === undefined &&
      registry.item(r.output.item)?.tool?.kind === kind,
  );
  assert(recipe, `no hand recipe known from the start makes a tool of kind ${kind}`);
  return recipe;
}

/** The workshop station that smelts an ore of the arena's ore wall (the kiln), and that process. */
function smelter(app: App): { cell: Cell; process: ProcessDef } {
  const crafting = app.registry!.crafting;
  const ores: readonly string[] = arenaOf(app).oreWall.map(blockItemKey);
  const smelts = (station: string | undefined) =>
    crafting
      .processesOf(station ?? '')
      .find((process) => process.inputs.every((input) => ores.includes(input.item)));
  const { cell, def } = workshopBlock(
    app,
    'station that smelts an ore',
    (d) => !!smelts(d.station),
  );
  return { cell, process: smelts(def.station)! };
}

/** Sets a log in LOG_CELL and mines it with a hotbar slot; returns the ticks it took. */
async function ticksToBreak(app: App, slot: number): Promise<number> {
  const log = stateKey(app, logState(app));
  const { x, y, z } = LOG_CELL;
  setBlock(app, x, y, z, log);
  app.input!.slot = slot;
  await aimAt(app, LOG_CELL);
  for (let ticks = 1; ticks <= MAX_BREAK_TICKS; ticks++) {
    press(app, 'primary', 1);
    if (blockKey(app, x, y, z) !== log) return ticks;
  }
  throw new Error(`the log still stands after ${MAX_BREAK_TICKS} ticks of mining`);
}

/** The state of both halves of the cabin door ('0' closed, '1' open). */
function doorHalves(app: App): string {
  const registry = app.registry!;
  const { x, y, z } = ARENA_DOOR;
  return [y, y + 1].map((h) => registry.prop(app.world!.getBlock(x, h, z), 'open')).join(',');
}

/** Opens or closes the cabin door from outside with secondary; returns both halves after. */
async function useDoor(app: App): Promise<string> {
  await standAt(app, { x: ARENA_DOOR.x, z: ARENA_DOOR.z + 1 });
  await aimAt(app, ARENA_DOOR);
  press(app, 'secondary', 1);
  return doorHalves(app);
}

export const M8_SUITE: readonly SelftestCase[] = [
  {
    name: 'clicking « Flint Hatchet » in the Logbook, then ×1 and step(90), crafts the hatchet',
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsArenaPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      const registry = app.registry!;
      const inventory = session.player.inventory;
      const recipe = hatchetRecipe(app);
      const output = recipe.output.item;
      await standAt(app, CRAFT_SPOT);
      for (const input of recipe.inputs) {
        assert(registry.item(input.item), `the ingredient ${input.item} is not an item`);
        give(app, input.item, input.count);
      }
      const before = countItem(inventory, output);
      const screens = app.inventory!;
      screens.closeScreen();
      screens.toggleBag();
      try {
        assert(screens.screen() === 'bag', `the bag key opened ${screens.screen()}`);
        assert(click('#screen-bag [data-page="logbook"]'), 'the Bag has no Logbook tab');
        const tab = `#screen-bag [data-tab="${recipe.category}"]`;
        const drawn = await withinFrames(UI_FRAMES, () => document.querySelector(tab) !== null);
        assert(drawn && click(tab), `the Logbook has no "${recipe.category}" tab`);
        const row = `#screen-bag [data-recipe="${recipe.key}"]`;
        assert(click(row), `the Logbook has no row for ${recipe.key}`);
        // The click redraws the panel: read the row again.
        const name = document.querySelector(`${row} .logbook-name`)?.textContent;
        const expected = ingredientName(registry, output);
        assert(name === expected, `the row reads "${name}", not "${expected}"`);
        assert(click('#screen-bag [data-action="craft-1"]'), 'the ×1 button is missing or off');
        session.step(1);
        const queued = await withinFrames(
          UI_FRAMES,
          () => document.querySelector('#screen-bag [data-queue="0"]') !== null,
        );
        assert(queued, `the queue shows nothing (sim queue: ${session.player.craft.length})`);
        session.step(CRAFT_TICKS - 1);
      } finally {
        screens.closeScreen();
      }
      const made = countItem(inventory, output) - before;
      assert(made === recipe.output.count, `${made} ${output} after step(${CRAFT_TICKS})`);
      assert(session.player.craft.length === 0, 'the craft queue is not empty');
    },
  },
  {
    name: 'a log breaks at least 1.9× faster with the hatchet than by hand',
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsArenaPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      const inventory = session.player.inventory;
      const hatchet = hatchetRecipe(app).output.item;
      if (countItem(inventory, hatchet) === 0) give(app, hatchet, 1);
      const tool = inventory.findIndex((stack) => stack?.item === hatchet);
      assert(tool >= 0 && tool < HOTBAR_SLOTS, `the hatchet is in slot ${tool}, not the hotbar`);
      const hand = inventory.findIndex((stack, i) => i < HOTBAR_SLOTS && stack === null);
      assert(hand >= 0, 'no empty hotbar slot for the bare hand');
      await standAt(app, LOG_SPOT);
      const byHand = await ticksToBreak(app, hand);
      const withTool = await ticksToBreak(app, tool);
      assert(
        byHand >= SPEEDUP * withTool,
        `by hand ${byHand} ticks, with the hatchet ${withTool} (less than ${SPEEDUP}× faster)`,
      );
    },
  },
  {
    name: 'secondary on the kiln opens the Station screen; ore and fuel clicked in give one ingot',
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsArenaPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      const registry = app.registry!;
      const inventory = session.player.inventory;
      const { cell, process } = smelter(app);
      const station = registry.crafting.station(process.station)!;
      // The arena tree's log burns long enough for the whole process.
      const fuel = blockItemKey(arenaOf(app).tree.log);
      const burns = registry.crafting.burnSeconds(fuel, process.fuel);
      assert(
        burns >= process.seconds,
        `${fuel} burns ${burns} s for a ${process.seconds} s process`,
      );
      for (const input of process.inputs) give(app, input.item, input.count);
      give(app, fuel, 1);
      const out = outputSlotOf(station);
      const outputs = () =>
        countItem(slotsAt(app, cell).slice(out, out + station.outputSlots), process.output.item);
      await openFromSouth(app, cell, 'station');
      try {
        const before = outputs();
        // Each input into its own input slot, the fuel into the fuel slot.
        const moves = process.inputs.map((input, i): [string, number] => [input.item, i]);
        moves.push([fuel, fuelSlotOf(station)]);
        for (const [item, slot] of moves) {
          const from = inventory.findIndex((stack) => stack?.item === item);
          assert(from >= 0, `no ${item} in the inventory`);
          await waitForSlot('station', from);
          assert(
            moveSlot(from, OPEN_SLOTS_BASE + slot),
            `slot ${from} or a station slot is hidden`,
          );
          session.step(1);
          const there = slotsAt(app, cell)[slot];
          assert(there?.item === item, `station slot ${slot} holds ${there?.item ?? 'nothing'}`);
        }
        const ticks = ticksOf(process.seconds) + SMELT_SLACK;
        session.step(ticks);
        const made = outputs() - before;
        assert(
          made === process.output.count,
          `${made} ${process.output.item} after step(${ticks}), not ${process.output.count}`,
        );
        await waitForSlot('station', OPEN_SLOTS_BASE + out);
      } finally {
        app.inventory?.closeScreen();
      }
    },
  },
  {
    name: 'the cabin door opens with secondary, lets the player in and closes again',
    scenes: PLAY_SCENES,
    skip: needsArenaPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      const registry = app.registry!;
      const { x, y, z } = ARENA_DOOR;
      // A rerun (or the player) may have left it open: both halves closed first.
      for (const h of [y, y + 1]) {
        const state = app.world!.getBlock(x, h, z);
        setBlock(app, x, h, z, stateKey(app, registry.withState(state, 'open', '0')));
      }
      assert(doorHalves(app) === '0,0', `the door halves are ${doorHalves(app)}, not closed`);
      const body = session.player.body;
      await standAt(app, { x, z: z + 1 });
      look(app, 0, 0);
      press(app, 'forward', 20);
      assert(body.z > z + 1, `the closed door let the player through (z ${body.z.toFixed(2)})`);
      const opened = await useDoor(app);
      assert(opened === '1,1', `secondary left the door halves at ${opened}, not open`);
      look(app, 0, 0);
      press(app, 'forward', 30);
      // The cabin's inside starts north of its south wall (the door's row).
      assert(
        body.z < z - 1,
        `the player did not walk in through the door (z ${body.z.toFixed(2)})`,
      );
      const closed = await useDoor(app);
      assert(closed === '0,0', `secondary left the door halves at ${closed}, not closed`);
    },
  },
  {
    name: 'a chest filled by clicks comes back whole after save.reload(); « Take all » empties it',
    scenes: PLAY_SCENES,
    timeoutMs: 60_000,
    skip: (app) => needsIdb(app) ?? needsArenaPlayer(app),
    run: async (app) => {
      const session = await playerSession(app);
      const { cell } = workshopBlock(app, 'chest', (def) => def.blockEntity === 'container');
      const item = blockItemKey(arenaOf(app).gravel);
      give(app, item, STORED);
      const inventory = session.player.inventory;
      await openFromSouth(app, cell, 'container');
      try {
        const from = inventory.findIndex((stack) => stack?.item === item);
        const moved = inventory[from]?.count ?? 0;
        const to = slotsAt(app, cell).indexOf(null);
        assert(from >= 0 && to >= 0, `no ${item} in the inventory (${from}) or the chest is full`);
        const before = countItem(slotsAt(app, cell), item);
        await waitForSlot('container', from);
        assert(moveSlot(from, OPEN_SLOTS_BASE + to), `slot ${from} or chest slot ${to} is hidden`);
        session.step(1);
        const stored = countItem(slotsAt(app, cell), item) - before;
        assert(stored === moved, `the chest got ${stored} ${item}, not ${moved}`);
      } finally {
        app.inventory?.closeScreen();
      }
      // Applies the screen.close the screen sent, so the save holds a closed chest.
      session.step(1);
      const saved = canonicalJson(blockEntityContents(app, cell.x, cell.y, cell.z));
      await reloadWorld(app);
      await playerSession(app);
      const back = canonicalJson(blockEntityContents(app, cell.x, cell.y, cell.z));
      assert(back === saved, `after the reload the chest holds ${back}, not ${saved}`);
      await openFromSouth(app, cell, 'container');
      try {
        const filled = slotsAt(app, cell).findIndex((stack) => stack !== null);
        assert(filled >= 0, 'the chest came back empty');
        await waitForSlot('container', OPEN_SLOTS_BASE + filled);
        assert(click('#screen-container [data-action="take-all"]'), 'no « Take all » button');
        app.session!.step(1);
        const left = slotsAt(app, cell).filter((stack) => stack !== null).length;
        assert(left === 0, `« Take all » left ${left} stacks in the chest`);
      } finally {
        app.inventory?.closeScreen();
      }
    },
  },
  noErrorsCase('no errors and no missing strings after the m8 checks'),
];
