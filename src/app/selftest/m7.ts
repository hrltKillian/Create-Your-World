import { blockItemKey } from '../../content/items.ts';
import { HOTBAR_SLOTS } from '../../core/player.ts';
import { t } from '../../i18n/i18n.ts';
import { exportWorld } from '../../platform/exportWorld.ts';
import { loadSettings, SETTINGS_KEY, type Settings } from '../../platform/settings.ts';
import { serializeInventory } from '../../sim/inventory.ts';
import { canonicalJson } from '../../sim/stateHash.ts';
import type { Storage, StoredWorld } from '../../sim/storage.ts';
import { FLAT_SURFACE } from '../../world/gen/flat.ts';
import type { App } from '../App.ts';
import {
  blockKey,
  clock,
  frameOrFail,
  give,
  look,
  press,
  reloadWorld,
  saveNow,
  setBlock,
  waitUntil,
} from '../automation.ts';
import {
  cards,
  createThroughMenus,
  deleteThroughCard,
  MENU_MS,
  notice,
  quitToMenu,
  worldsScreen,
} from './menuSteps.ts';
import {
  assert,
  needsFlatPlayer,
  needsIdb,
  noErrorsCase,
  playerSession,
  type SelftestCase,
  standAt,
  stateKey,
} from './support.ts';

/**
 * M7 « Fait quand » browser checks of the saves and menus. The IndexedDB cases need
 * `?storage=idb` (the default) on the flat world in fixed steps
 * (`?storage=idb&worldType=flat&fixedStep=1&selftest=m0,m7`), and run in order: the boot world is
 * saved and quit and a world is created through the menus (Worlds, New world, Create); 3 edits and
 * a thrown item, then save.now() and save.reload() give back the edits, the drop, the player
 * (± 0.01), the bag and the clock; the world exported and imported through the Worlds screen has
 * the same records; deleting the worlds through their cards leaves no record (inspect() at 0).
 * They delete every world they made and end on the Worlds screen. With `?forceNoIdb=1` instead,
 * the « Saving unavailable » banner shows and the world plays and saves in memory. The settings
 * case runs everywhere. A second tab on the same world is an e2e test (it needs two pages).
 */

/** The states of the game, in a world or in the menus (developer scenes skip the suite). */
const GAME_SCENES: readonly App['state'][] = ['loading', 'world', 'paused', 'menu'];
/** Name typed in the New world form. */
const WORLD_NAME = 'Selftest m7';
/** Where the player stands: in column (0, 0), the one that gets two of the edits. */
const SPOT = { x: 4, z: 4 };
/** Ticks for a thrown item to land. */
const LAND_TICKS = 40;
/** « ± 0,01 » on positions after a reload. */
const EPSILON = 0.01;

/** Worlds the IndexedDB cases made (ids, null: none): the last case deletes them. */
const made = {
  boot: null as string | null,
  created: null as string | null,
  copy: null as string | null,
};

interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The IndexedDB cases: the saves in IndexedDB, a player on the flat world, fixed steps. */
function needsIdbFlat(app: App): string | null {
  return needsIdb(app) ?? needsFlatPlayer(app);
}

function saves(app: App): Storage {
  return app.game!.backend.storage;
}

/** What a save must give back: the edited blocks, the drops, the player, the bag and the clock. */
interface Moment {
  readonly blocks: readonly (string | null)[];
  readonly player: Point;
  readonly bag: string;
  readonly tick: number;
  readonly clock: number;
  readonly frozen: boolean;
  readonly drops: readonly (Point & { id: number; item: string; count: number })[];
}

function moment(app: App, edits: readonly Point[]): Moment {
  const session = app.session!;
  const view = session.host.view;
  const drops: (Point & { id: number; item: string; count: number })[] = [];
  for (const entity of view.entities.values()) {
    if (entity.kind !== 'itemDrop') continue;
    const { id, item, count, body } = entity;
    drops.push({ id, item, count, x: body.x, y: body.y, z: body.z });
  }
  const { x, y, z } = session.player.body;
  const time = clock(app)!;
  return {
    blocks: edits.map((e) => blockKey(app, e.x, e.y, e.z)),
    player: { x, y, z },
    bag: canonicalJson(serializeInventory(session.player.inventory)),
    tick: view.tick(),
    clock: time.ticks,
    frozen: time.frozen,
    drops: drops.sort((a, b) => a.id - b.id),
  };
}

const near = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) <= EPSILON &&
  Math.abs(a.y - b.y) <= EPSILON &&
  Math.abs(a.z - b.z) <= EPSILON;

/** What a reload changed (empty: everything came back). */
function differences(before: Moment, after: Moment): string[] {
  const out: string[] = [];
  for (let i = 0; i < before.blocks.length; i++)
    if (after.blocks[i] !== before.blocks[i])
      out.push(`edit ${i + 1} holds ${after.blocks[i]}, not ${before.blocks[i]}`);
  if (!near(after.player, before.player))
    out.push(
      `the player is at ${JSON.stringify(after.player)}, not ${JSON.stringify(before.player)}`,
    );
  if (after.bag !== before.bag) out.push(`the bag is ${after.bag}, not ${before.bag}`);
  if (after.tick !== before.tick || after.clock !== before.clock || after.frozen !== before.frozen)
    out.push(`the clock is ${after.tick}/${after.clock}, not ${before.tick}/${before.clock}`);
  if (after.drops.length !== before.drops.length)
    out.push(`${after.drops.length} drops, not ${before.drops.length}`);
  for (const drop of before.drops) {
    const back = after.drops.find((d) => d.id === drop.id);
    if (!back || back.item !== drop.item || back.count !== drop.count || !near(back, drop))
      out.push(`drop ${drop.id} is ${JSON.stringify(back ?? null)}, not ${JSON.stringify(drop)}`);
  }
  return out;
}

/** A stored world as comparable text, without its id (an import gets a new one). */
function comparable(stored: StoredWorld): string {
  return canonicalJson({
    world: { ...stored.world, id: '' },
    players: stored.players
      .map((player) => ({ ...player, worldId: '' }))
      .sort((a, b) => a.playerId - b.playerId),
    columns: [...stored.columns]
      .sort((a, b) => a.cx - b.cx || a.cz - b.cz)
      .map((column) => ({ ...column, worldId: '', payload: Array.from(column.payload) })),
  });
}

export const M7_SUITE: readonly SelftestCase[] = [
  {
    name: 'settings changed as on the Settings screen are stored (cyw.settings.v1) and read back',
    scenes: GAME_SCENES,
    run: (app) => {
      const game = app.game!;
      const stored = localStorage.getItem(SETTINGS_KEY);
      const before = game.settings;
      const changed: Settings = {
        ...before,
        fov: before.fov === 90 ? 80 : 90,
        sensitivity: before.sensitivity === 1.5 ? 2 : 1.5,
        invertY: !before.invertY,
        volumes: { ...before.volumes, effects: before.volumes.effects === 0.5 ? 0.25 : 0.5 },
      };
      try {
        game.changeSettings(changed);
        assert(app.input?.invertY === changed.invertY, 'invert Y was not applied');
        const read = loadSettings();
        assert(
          canonicalJson(read) === canonicalJson(changed),
          `read back ${JSON.stringify(read)}, not ${JSON.stringify(changed)}`,
        );
      } finally {
        // The player's own settings come back (a selftest page plays on the defaults).
        game.changeSettings(before);
        if (stored === null) localStorage.removeItem(SETTINGS_KEY);
        else localStorage.setItem(SETTINGS_KEY, stored);
      }
    },
  },
  {
    name: 'with ?forceNoIdb=1 the « Saving unavailable » banner shows; the world plays and saves',
    scenes: GAME_SCENES,
    timeoutMs: 30_000,
    skip: (app) =>
      !app.params.forceNoIdb
        ? 'needs ?forceNoIdb=1'
        : app.params.storage !== 'idb'
          ? 'needs ?storage=idb (the default)'
          : needsFlatPlayer(app),
    run: async (app) => {
      const session = await playerSession(app);
      assert(app.game!.backend.unavailable, 'the saves are not in the memory fallback');
      const banner = document.getElementById('banner-saving');
      assert(banner, 'no « Saving unavailable » banner');
      assert(banner.checkVisibility(), 'the « Saving unavailable » banner is hidden');
      assert(
        banner.textContent === t('save.unavailable'),
        `the banner says "${banner.textContent}"`,
      );
      look(app, 0, 0);
      await standAt(app, SPOT);
      const body = session.player.body;
      const from = { x: body.x, z: body.z };
      press(app, 'forward', 20);
      const walked = Math.hypot(body.x - from.x, body.z - from.z);
      assert(walked > 1, `walked ${walked.toFixed(2)} m in 20 ticks`);
      const block = stateKey(app, app.world!.getBlock(SPOT.x, FLAT_SURFACE - 1, SPOT.z));
      const air = stateKey(app, app.registry!.air);
      const edit = { x: SPOT.x + 3, y: FLAT_SURFACE + 1, z: SPOT.z - 6 };
      setBlock(app, edit.x, edit.y, edit.z, block);
      try {
        assert(blockKey(app, edit.x, edit.y, edit.z) === block, 'the edit did not apply');
        assert(await saveNow(app), 'the save in memory failed');
        const counts = await saves(app).inspect(app.game!.open!.info.id);
        assert(counts.worlds === 1 && counts.columns >= 1, `in memory: ${JSON.stringify(counts)}`);
      } finally {
        setBlock(app, edit.x, edit.y, edit.z, air);
      }
    },
  },
  {
    name: 'a world is created through the menus: Esc, Save & quit, Worlds, New world, Create',
    scenes: GAME_SCENES,
    timeoutMs: 45_000,
    skip: needsIdbFlat,
    run: async (app) => {
      const game = app.game!;
      if (game.open) {
        made.boot = game.open.info.id;
        await quitToMenu(app);
      }
      await createThroughMenus(app, WORLD_NAME, false);
      await playerSession(app);
      assert(app.state === 'world', `state is ${app.state}`);
      const info = game.open!.info;
      made.created = info.id;
      assert(info.name === WORLD_NAME, `the world is named "${info.name}"`);
      assert(!info.rules.hostiles, 'hostile creatures are on');
      assert(await saveNow(app), 'the first save failed');
      const counts = await saves(app).inspect(info.id);
      assert(counts.worlds === 1 && counts.players === 1, `stored: ${JSON.stringify(counts)}`);
    },
  },
  {
    name: '3 edits, a thrown item, the player, the bag and the clock survive save.now(), save.reload()',
    scenes: GAME_SCENES,
    timeoutMs: 60_000,
    skip: needsIdbFlat,
    run: async (app) => {
      const id = made.created;
      assert(id && app.game?.open?.info.id === id, 'needs the world the menu case created');
      const session = await playerSession(app);
      const registry = app.registry!;
      // Facing −z: the throw flies away from the edits.
      look(app, 0, 0);
      await standAt(app, SPOT);
      const filler = app.world!.getBlock(SPOT.x, FLAT_SURFACE - 1, SPOT.z);
      const block = stateKey(app, filler);
      // Two sections of column (0, 0), then column (1, 0).
      const edits = [
        { x: SPOT.x + 2, y: FLAT_SURFACE + 1, z: SPOT.z, state: block },
        { x: SPOT.x + 2, y: FLAT_SURFACE - 30, z: SPOT.z, state: stateKey(app, registry.air) },
        // x 34: across the border at 32, in column (1, 0).
        { x: SPOT.x + 30, y: FLAT_SURFACE + 1, z: SPOT.z, state: block },
      ];
      for (const e of edits) setBlock(app, e.x, e.y, e.z, e.state);
      for (const e of edits)
        assert(blockKey(app, e.x, e.y, e.z) === e.state, `(${e.x}, ${e.y}, ${e.z}) not edited`);
      // Blocks keep their count, a tool its wear; one block is thrown with G.
      const item = blockItemKey(registry.blockDef(filler).key);
      give(app, item, 5);
      const tool = registry.items.find((def) => def.tool);
      if (tool) give(app, tool.key, 1);
      const slot = session.player.inventory.findIndex((stack) => stack?.item === item);
      assert(slot >= 0 && slot < HOTBAR_SLOTS, `${item} went to slot ${slot}, not the hotbar`);
      app.input!.slot = slot;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', key: 'g' }));
      // The frame sends the throw; the ticks apply it and let the item land.
      await frameOrFail();
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyG', key: 'g' }));
      session.step(LAND_TICKS);
      const before = moment(app, edits);
      const drop = before.drops[0];
      assert(
        before.drops.length === 1 && drop?.item === item && drop.count === 1,
        `drops after the throw: ${JSON.stringify(before.drops)}`,
      );
      assert(await saveNow(app), 'save.now() failed');
      const counts = await saves(app).inspect(id);
      assert(counts.columns >= 2, `stored: ${JSON.stringify(counts)}`);
      await reloadWorld(app);
      const info = app.game?.open?.info;
      assert(info?.id === id, `world ${info?.id} opened, not ${id}`);
      assert(info.name === WORLD_NAME && !info.rules.hostiles, 'the name or rules changed');
      const problems = differences(before, moment(app, edits));
      assert(problems.length === 0, problems.join('; '));
    },
  },
  {
    name: 'a world exported, then imported through the Worlds screen, has the same records',
    scenes: GAME_SCENES,
    timeoutMs: 30_000,
    skip: needsIdbFlat,
    run: async (app) => {
      const id = made.created;
      assert(id, 'needs the world the menu case created');
      await worldsScreen(app);
      const storage = saves(app);
      // The Export button's file, without the download.
      const bytes = (await exportWorld(storage, id)) as Uint8Array<ArrayBuffer>;
      const known = cards();
      const input = document.querySelector<HTMLInputElement>('#screen-worlds input[type="file"]');
      assert(input, 'the Worlds screen has no file input');
      const files = new DataTransfer();
      files.items.add(new File([bytes], 'selftest.cyw.gz', { type: 'application/gzip' }));
      input.files = files.files;
      input.dispatchEvent(new Event('change'));
      await waitUntil(() => notice() !== '', {
        timeoutMs: MENU_MS,
        label: 'the import said nothing',
        pollMs: 20,
      });
      assert(notice() === t('worlds.imported'), `the Worlds screen says "${notice()}"`);
      const copy = cards().find((card) => !known.includes(card));
      assert(copy, 'the imported world has no card');
      made.copy = copy;
      const [original, imported] = await Promise.all([
        storage.loadWorld(id),
        storage.loadWorld(copy),
      ]);
      assert(original && imported, 'a world is missing from the storage');
      assert(original.columns.length >= 2, `${original.columns.length} column records exported`);
      assert(comparable(original) === comparable(imported), 'the imported records differ');
    },
  },
  {
    name: 'deleting the worlds through their cards leaves no record (inspect() at 0)',
    scenes: GAME_SCENES,
    timeoutMs: 30_000,
    skip: needsIdbFlat,
    run: async (app) => {
      assert(made.created, 'needs the world the menu case created');
      await worldsScreen(app);
      const storage = saves(app);
      const ids = [made.copy, made.created, made.boot].filter((id): id is string => id !== null);
      for (const id of ids) {
        const before = await storage.inspect(id);
        assert(
          before.worlds === 1 && before.players === 1,
          `world ${id}: ${JSON.stringify(before)}`,
        );
        await deleteThroughCard(id);
        const after = await storage.inspect(id);
        assert(
          after.worlds === 0 && after.players === 0 && after.columns === 0,
          `world ${id} after its deletion: ${JSON.stringify(after)}`,
        );
      }
      made.boot = null;
      made.created = null;
      made.copy = null;
    },
  },
  noErrorsCase('no errors after the m7 checks'),
];
