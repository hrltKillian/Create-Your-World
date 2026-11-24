import { fuelSlotOf, outputSlotOf } from '../../content/crafting.ts';
import { blockItemKey } from '../../content/items.ts';
import { HOTBAR_SLOTS } from '../../core/player.ts';
import { t } from '../../i18n/i18n.ts';
import { ticksOf } from '../../sim/clock.ts';
import { OPEN_SLOTS_BASE } from '../../sim/commands.ts';
import { wearSlotOf } from '../../sim/equipment.ts';
import { canonicalJson } from '../../sim/stateHash.ts';
import { type DeathCause, thermalStatus } from '../../sim/survival.ts';
import { moveClicks } from '../../sim/testing/slotMoves.ts';
import { clockText } from '../../ui/hud/clock.ts';
import { bearingOf } from '../../ui/hud/compass.ts';
import { ingredientName } from '../../ui/itemSlot.ts';
import type { App } from '../App.ts';
import {
  click,
  freezeTime,
  give,
  look,
  press,
  reloadWorld,
  setBlock,
  setTime,
  withinFrames,
} from '../automation.ts';
import { equip, kill, setStat, shelterHere } from '../survivalAutomation.ts';
import {
  aimAt,
  arenaOf,
  assert,
  type Cell,
  chunksMeshed,
  keepingClock,
  lookAt,
  needsIdb,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  readClock,
  type SelftestCase,
  slotsAt,
  stateKey,
} from './support.ts';
import {
  balance,
  boiler,
  buildCabin,
  buildPool,
  CABIN_ROOM,
  clearRoom,
  coldestBiome,
  emptyHand,
  feetCell,
  freshGauges,
  litFire,
  needsGeneratedFixedPlayer,
  PAD_HEIGHT,
  PAD_ROOM,
  pondWater,
  stackText,
  toxicBiome,
  VISIT_MS,
  visitBiome,
} from './survivalScenes.ts';

/**
 * M9 « Fait quand » browser checks in the generated world with fixed steps
 * (?seed=7&rd=4&fixedStep=1&selftest=m0,m9): the tundra at 23:00 makes the body Cold within
 * step(5400); a cabin with a campfire, built by debug fills, is enclosed and warms it back; a
 * bedroll there sleeps until 06:00; the marsh at noon gives its day toxicity over step(9000), a
 * filter mask its share of it; a sip from a pool, a flask filled there, the flask boiled in a
 * campfire; a death opens #screen-death, Respawn brings the player back where they should be,
 * and the compass points at the Abandoned Pack, also after save.reload() (IndexedDB only, the
 * default storage). Blocks, items and biomes come from the pack's data (engine code never names
 * content): the coldest biome by night, the most toxic one by day, the arena's cabin wall, pond
 * water and tree log, the station that boils that water, the bedroll block, the air filter.
 */

/** Hour of the night checks (« time.set(23) ») and of the marsh check (« à midi »). */
const NIGHT_HOUR = 23;
const NOON = 12;
/** « step(5400) » in the tundra and « step(9000) » in the marsh. */
const TUNDRA_TICKS = 5400;
const MARSH_TICKS = 9000;
/** « toxicité 20 ± 2 »; « ≤ 3,3 avec masque »: 10 % over the filtered rate. */
const TOXICITY_TOLERANCE = 2;
const MASK_MARGIN = 1.1;
/** « température ≥ −10 » in the cabin with its fire. */
const WARM_FLOOR = -10;
/** Aim just above the floor in the middle of a low block's cell (bedroll, campfire). */
const LOW_AIM = 1 / 16;
/** Ticks a sip is held past `water.sipSec`, and how far its thirst may be from the liquid's. */
const SIP_SLACK = 3;
const SIP_TOLERANCE = 0.5;
/** Ticks a process gets past its own duration (as in m8). */
const BOIL_SLACK = 30;
/** Frames the HUD (10 Hz, or the next frame after an event) gets to show a change. */
const UI_FRAMES = 30;
/** One game minute, in hours. */
const MINUTE = 1 / 60;
/** How far (blocks) the respawned feet may be from the bedroll or the spawn. */
const RESPAWN_EPSILON = 0.01;
const DEATH_CAUSE: DeathCause = 'cold';

/** Waits until the HUD's effect list shows a status or effect. */
async function effectShown(key: string): Promise<void> {
  const selector = `#hud-effects [data-effect="${key}"]`;
  const shown = await withinFrames(UI_FRAMES, () => document.querySelector(selector) !== null);
  const listed = document.querySelector('#hud-effects')?.textContent ?? '';
  assert(shown, `the HUD's effects do not list ${key} (they read "${listed}")`);
}

/** Toxicity after MARSH_TICKS at noon (frozen clock), from 0, the air sampled at noon first. */
async function marshToxicity(app: App): Promise<number> {
  const session = app.session!;
  let toxicity = Number.NaN;
  await keepingClock(app, () => {
    setTime(app, NOON);
    freezeTime(app, true);
    session.step(ticksOf(balance(app).shelter.checkSec));
    freshGauges(app);
    session.step(MARSH_TICKS);
    toxicity = session.player.survival.toxicity;
  });
  return toxicity;
}

/** Turns towards an Abandoned Pack and waits until the compass shows a pack marker in front. */
async function packMarked(app: App, pack: Cell): Promise<void> {
  const body = app.session!.player.body;
  // headingOf(yaw) = −yaw: facing a bearing is the opposite yaw.
  look(app, -bearingOf(pack.x + 0.5 - body.x, pack.z + 0.5 - body.z), 0);
  const marks = () => [...document.querySelectorAll<HTMLElement>('#hud-compass .compass-grave')];
  const front = () => marks().some((m) => Number(m.style.getPropertyValue('--o')) > 0.5);
  const shown = await withinFrames(UI_FRAMES, front);
  const where = `(${pack.x}, ${pack.y}, ${pack.z})`;
  assert(
    shown,
    `facing the pack at ${where}, the compass shows none of its ${marks().length} marks`,
  );
}

export const M9_SUITE: readonly SelftestCase[] = [
  {
    name: `in the tundra, time.set(${NIGHT_HOUR}) then step(${TUNDRA_TICKS}) leave the body at −40 or below: Cold`,
    scenes: PLAY_SCENES,
    timeoutMs: 60_000,
    skip: needsGeneratedFixedPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      const b = balance(app);
      await visitBiome(app, coldestBiome(app));
      await keepingClock(app, async () => {
        setTime(app, NIGHT_HOUR);
        freshGauges(app);
        session.step(TUNDRA_TICKS);
        const s = session.player.survival;
        const body = `the body is at ${s.temperature.toFixed(1)} (air ${s.ambient.toFixed(1)} °C, target ${s.target.toFixed(1)})`;
        assert(s.temperature <= -b.temperature.mildAt, `${body}, above −${b.temperature.mildAt}`);
        const status = thermalStatus(s.temperature, b);
        assert(status === -1, `${body}: thermal status ${status}, not Cold (−1)`);
        await effectShown('cold');
      });
    },
  },
  {
    name: 'a cabin with a campfire, built by debug fills in the tundra at night, is enclosed and warms the body to −10 or above',
    scenes: PLAY_SCENES,
    timeoutMs: 60_000,
    skip: needsGeneratedFixedPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      const gauge = balance(app).temperature;
      const feet = await visitBiome(app, coldestBiome(app));
      buildCabin(app, feet);
      setBlock(app, feet.x + 1, feet.y, feet.z, litFire(app));
      // Twice the time from Cold back to −10 at the rate towards 0.
      const ticks = 2 * ticksOf((60 * (gauge.mildAt + WARM_FLOOR)) / gauge.backPerMin);
      await keepingClock(app, () => {
        setTime(app, NIGHT_HOUR);
        freshGauges(app);
        setStat(app, 'temperature', -gauge.mildAt);
        session.step(ticks);
        const s = session.player.survival;
        const shelter = shelterHere(app);
        assert(
          shelter === 'enclosed' && s.shelter === 'enclosed',
          `in the cabin the shelter is ${shelter} (last sample: ${s.shelter}), not enclosed`,
        );
        assert(
          s.temperature >= WARM_FLOOR,
          `after step(${ticks}) in the cabin the body is at ${s.temperature.toFixed(1)} (air ${s.ambient.toFixed(1)} °C, target ${s.target.toFixed(1)}), below ${WARM_FLOOR}`,
        );
      });
    },
  },
  {
    name: 'secondary on a bedroll in the cabin at night sleeps until 06:00 and makes it the respawn point',
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsGeneratedFixedPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      const registry = app.registry!;
      const wake = balance(app).sleep.wakeHour;
      const feet = feetCell(app);
      // The previous case's cabin, built again around the player.
      buildCabin(app, feet);
      const bedroll = registry.blocks.find((def) => def.blockEntity === 'bed');
      assert(bedroll, 'the pack has no bedroll');
      const bed = { x: feet.x, y: feet.y, z: feet.z - CABIN_ROOM };
      setBlock(app, bed.x, bed.y, bed.z, stateKey(app, registry.defaultState(bedroll.key)));
      setTime(app, NIGHT_HOUR);
      const day = readClock(app).day;
      await aimAt(app, bed, LOW_AIM);
      press(app, 'secondary', 1);
      const clock = readClock(app);
      const reads = clockText(clock.hour, clock.day);
      const morning = clockText(wake, day + 1);
      assert(
        Math.abs(clock.hour - wake) < MINUTE && clock.day === day + 1,
        `after sleeping the clock reads ${reads}, not ${morning} (shelter: ${shelterHere(app)})`,
      );
      const respawn = canonicalJson(session.player.respawn);
      assert(respawn === canonicalJson(bed), `the respawn point is ${respawn}, not the bedroll`);
      const hud = () => document.querySelector('#hud-clock')?.textContent;
      const shown = await withinFrames(UI_FRAMES, () => hud() === reads);
      assert(shown, `the HUD clock reads "${hud()}", not "${reads}"`);
    },
  },
  {
    name: `in the marsh at noon (frozen clock), step(${MARSH_TICKS}) brings toxicity to its day rate × 5 min (20 ± 2)`,
    scenes: PLAY_SCENES,
    timeoutMs: 60_000,
    skip: needsGeneratedFixedPlayer,
    run: async (app) => {
      await playerSession(app);
      const marsh = toxicBiome(app);
      await visitBiome(app, marsh.index);
      const toxicity = await marshToxicity(app);
      const expected = (marsh.perMin * MARSH_TICKS) / ticksOf(60);
      assert(
        Math.abs(toxicity - expected) <= TOXICITY_TOLERANCE,
        `toxicity ${toxicity.toFixed(2)} after step(${MARSH_TICKS}), not ${expected} ± ${TOXICITY_TOLERANCE}`,
      );
    },
  },
  {
    name: `with a filter mask worn, the same step(${MARSH_TICKS}) keeps toxicity within its filtered share (3.3 or below)`,
    scenes: PLAY_SCENES,
    timeoutMs: 60_000,
    skip: needsGeneratedFixedPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      const registry = app.registry!;
      const marsh = toxicBiome(app);
      const mask = registry.items.find((item) => item.wear?.airFilter !== undefined);
      assert(mask?.wear?.airFilter !== undefined, 'no item filters the air');
      await visitBiome(app, marsh.index);
      give(app, mask.key, 1);
      const from = session.player.inventory.findIndex((stack) => stack?.item === mask.key);
      assert(from >= 0, `no ${mask.key} in the inventory`);
      equip(app, from);
      const wear = wearSlotOf(registry, mask.key);
      const worn = session.player.equipment[wear];
      assert(worn?.item === mask.key, `the ${mask.key} is not worn: ${stackText(worn)}`);
      try {
        const toxicity = await marshToxicity(app);
        const share = (marsh.perMin * mask.wear.airFilter * MARSH_TICKS) / ticksOf(60);
        const limit = share * MASK_MARGIN;
        assert(
          toxicity <= limit,
          `toxicity ${toxicity.toFixed(2)} after step(${MARSH_TICKS}) behind the mask, over ${limit.toFixed(2)}`,
        );
      } finally {
        equip(app, OPEN_SLOTS_BASE + wear);
      }
    },
  },
  {
    name: "a sip from a pool, the hand empty and secondary held 0.8 s, gives the water's thirst (+8)",
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsGeneratedFixedPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      const b = balance(app);
      const { liquid } = pondWater(app);
      const pool = buildPool(app);
      app.input!.slot = emptyHand(app);
      setStat(app, 'thirst', b.thirst.max / 2);
      await lookAt(app, pool.x + 0.5, pool.y + 0.5, pool.z + 0.5);
      const before = session.player.survival.thirst;
      press(app, 'secondary', ticksOf(b.water.sipSec) + SIP_SLACK);
      const gained = session.player.survival.thirst - before;
      assert(
        Math.abs(gained - liquid.thirstPerSip) <= SIP_TOLERANCE,
        `the sip gave ${gained.toFixed(2)} thirst, not ${liquid.thirstPerSip}`,
      );
    },
  },
  {
    name: 'secondary with an empty flask on the pool fills it with raw water, all its charges (×3)',
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsGeneratedFixedPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      const registry = app.registry!;
      const { empty, filled } = pondWater(app);
      const pool = buildPool(app);
      give(app, empty, 1);
      const inventory = session.player.inventory;
      const slot = inventory.findIndex((stack) => stack?.item === empty);
      assert(slot >= 0 && slot < HOTBAR_SLOTS, `the ${empty} is in slot ${slot}, not the hotbar`);
      app.input!.slot = slot;
      await lookAt(app, pool.x + 0.5, pool.y + 0.5, pool.z + 0.5);
      press(app, 'secondary', 1);
      const charges = registry.item(filled)?.container?.charges;
      const stack = inventory[slot];
      assert(
        stack?.item === filled && stack.durability === charges,
        `the flask's slot holds ${stackText(stack)}, not « ${ingredientName(registry, filled)} » ×${charges}`,
      );
    },
  },
  {
    name: 'raw water and a log in a campfire give boiled water, its charges kept',
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsGeneratedFixedPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      const registry = app.registry!;
      const { filled } = pondWater(app);
      const { process, station, block } = boiler(app);
      const fuel = blockItemKey(arenaOf(app).tree.log);
      const burns = registry.crafting.burnSeconds(fuel, process.fuel);
      assert(
        burns >= process.seconds,
        `${fuel} burns ${burns} s for a ${process.seconds} s process`,
      );
      const inventory = session.player.inventory;
      if (!inventory.some((stack) => stack?.item === filled)) give(app, filled, 1);
      give(app, fuel, 1);
      const feet = feetCell(app);
      clearRoom(app, feet, PAD_ROOM, PAD_HEIGHT);
      const cell = { x: feet.x + 2, y: feet.y, z: feet.z };
      setBlock(app, cell.x, cell.y, cell.z, stateKey(app, registry.defaultState(block.key)));
      await aimAt(app, cell, LOW_AIM);
      press(app, 'secondary', 1);
      const screen = app.inventory?.screen() ?? null;
      assert(screen === 'station', `secondary on the ${block.key} opened ${screen}`);
      try {
        const water = inventory.findIndex((stack) => stack?.item === filled);
        const uses = inventory[water]?.durability;
        const moves: [string, number][] = [
          [filled, 0],
          [fuel, fuelSlotOf(station)],
        ];
        for (const [item, slot] of moves) {
          const from = inventory.findIndex((stack) => stack?.item === item);
          const before = slotsAt(app, cell)[slot];
          const clicks = moveClicks(
            registry,
            from,
            OPEN_SLOTS_BASE + slot,
            inventory[from]!,
            before,
          );
          for (const command of clicks) session.host.send(command);
          session.step(1);
          const there = slotsAt(app, cell)[slot];
          // With water to boil, the fire lights at once and burns the log out of its slot.
          const burning = item === fuel && there === null && litAt(app, cell);
          assert(
            there?.item === item || burning,
            `station slot ${slot} holds ${stackText(there)}, not ${item}`,
          );
        }
        const ticks = ticksOf(process.seconds) + BOIL_SLACK;
        session.step(ticks);
        const out = outputSlotOf(station);
        const outputs = slotsAt(app, cell).slice(out, out + station.outputSlots);
        const made = outputs.find((stack) => stack?.item === process.output.item);
        const boiled = ingredientName(registry, process.output.item);
        assert(
          made?.durability === uses,
          `after step(${ticks}) the outputs hold ${outputs.map(stackText).join(', ')}, not « ${boiled} » with ${uses} uses`,
        );
      } finally {
        app.inventory?.closeScreen();
      }
    },
  },
  {
    name: 'a death leaves a pack and opens #screen-death with its cause; Respawn brings the player back to the bedroll or the spawn',
    scenes: PLAY_SCENES,
    timeoutMs: 60_000,
    skip: needsGeneratedFixedPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      const player = session.player;
      const r = balance(app).respawn;
      // Something to leave behind: no pack without it.
      give(app, blockItemKey(arenaOf(app).tree.log), 1);
      const packs = player.graves.length;
      const bed = player.respawn;
      const home = bed ? { x: bed.x + 0.5, y: bed.y, z: bed.z + 0.5 } : session.spawn;
      kill(app, DEATH_CAUSE);
      assert(player.survival.dead, `kill('${DEATH_CAUSE}') left the player alive`);
      const pack = player.graves[packs];
      assert(pack, 'the death left no Abandoned Pack in the graves');
      const block = app.world!.getBlock(pack.x, pack.y, pack.z);
      assert(block === app.registry!.grave, `the pack's cell holds ${stateKey(app, block)}`);
      const open = await withinFrames(UI_FRAMES, () => app.hud?.deathOpen() === true);
      assert(open, 'the death screen did not open');
      const cause = document.querySelector('#screen-death .death-cause')?.textContent;
      const expected = t(`death.cause.${DEATH_CAUSE}`);
      assert(cause === expected, `the death screen reads "${cause}", not "${expected}"`);
      const wake = t(bed ? 'death.atBed' : 'death.atSpawn');
      const text = document.querySelector('#screen-death')?.textContent ?? '';
      assert(text.includes(wake), `the death screen does not say "${wake}"`);
      assert(click('#screen-death [data-action="respawn"]'), 'the death screen has no Respawn');
      session.step(1);
      const s = player.survival;
      const b = player.body;
      const at = `(${b.x}, ${b.y}, ${b.z})`;
      const where = `${bed ? 'the bedroll' : 'the spawn'} (${home.x}, ${home.y}, ${home.z})`;
      assert(!s.dead, 'Respawn left the player dead');
      const off = Math.max(Math.abs(b.x - home.x), Math.abs(b.y - home.y), Math.abs(b.z - home.z));
      assert(off <= RESPAWN_EPSILON, `respawned at ${at}, not ${where}`);
      const gauges = [s.health - r.health, s.hunger - r.hunger, s.thirst - r.thirst];
      assert(
        gauges.every((d) => Math.abs(d) < 0.5),
        `respawned with health ${s.health}, hunger ${s.hunger}, thirst ${s.thirst}`,
      );
      assert(
        s.effects.some((e) => e.key === 'weakened'),
        'the player came back without Weakened',
      );
      const closed = await withinFrames(UI_FRAMES, () => app.hud?.deathOpen() === false);
      assert(closed, 'the death screen stays open after Respawn');
      await chunksMeshed(app, session.loadingRadius(), VISIT_MS);
      await packMarked(app, pack);
    },
  },
  {
    name: "the compass still points at the Abandoned Pack after save.reload() (the player's graves)",
    scenes: PLAY_SCENES,
    timeoutMs: 60_000,
    skip: (app) => needsIdb(app) ?? needsGeneratedFixedPlayer(app),
    run: async (app) => {
      const session = await playerSession(app);
      const graves = canonicalJson(session.player.graves);
      assert(session.player.graves.length > 0, 'no Abandoned Pack to look for (the death case)');
      await reloadWorld(app);
      const again = await playerSession(app);
      const back = canonicalJson(again.player.graves);
      assert(back === graves, `after the reload the graves are ${back}, not ${graves}`);
      await packMarked(app, again.player.graves.at(-1)!);
    },
  },
  noErrorsCase('no errors and no missing strings after the m9 checks'),
];

/** The station block at `cell` is in its lit state. */
function litAt(app: App, cell: { x: number; y: number; z: number }): boolean {
  const registry = app.registry!;
  const state = app.world!.getBlock(cell.x, cell.y, cell.z);
  return registry.prop(state, 'lit') === '1';
}
