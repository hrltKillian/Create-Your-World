import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openErrorKey } from '../../../src/app/worlds.ts';
import type {
  BlockEntity,
  ContainerEntity,
  GraveEntity,
  StationEntity,
  WorkbenchEntity,
} from '../../../src/sim/blockEntities.ts';
import { ticksOf } from '../../../src/sim/clock.ts';
import { countItem } from '../../../src/sim/inventory.ts';
import type { ItemDropState } from '../../../src/sim/itemDrops.ts';
import { MemoryStorage } from '../../../src/sim/MemoryStorage.ts';
import type { ColumnRecord, StoredWorld } from '../../../src/sim/storage.ts';
import { createSurvival } from '../../../src/sim/survival.ts';
import { HOUR_TICKS } from '../../../src/sim/time.ts';
import {
  CorruptRecordError,
  MIGRATIONS,
  type MigrationStep,
  migrate,
  type PlainRecord,
  SAVE_VERSION,
  SaveVersionError,
} from '../../../src/world/codec/migrations.ts';
import { cellKey, columnKey } from '../../../src/world/coords.ts';
import { restoreFrom, settle } from '../../helpers/save.ts';

/** A stored world from `tests/fixtures/saves/vN/world.json` (payloads in base64). */
function fixture(version: number): StoredWorld {
  const url = new URL(`../../fixtures/saves/v${version}/world.json`, import.meta.url);
  const data = JSON.parse(readFileSync(url, 'utf8')) as StoredWorld;
  const columns = data.columns.map(
    (c): ColumnRecord => ({
      ...c,
      payload: new Uint8Array(Buffer.from(c.payload as unknown as string, 'base64')),
    }),
  );
  return { ...data, columns };
}

describe('save versions', () => {
  it('has one migration step per version after the first', () => {
    expect(SAVE_VERSION).toBe(MIGRATIONS.length + 1);
  });

  it('upgrades a record one step at a time and refuses newer or damaged records', () => {
    const tag = (name: string) => (r: PlainRecord) => ({ ...r, steps: `${r.steps ?? ''}${name}` });
    const steps: MigrationStep[] = [
      { world: tag('a'), player: tag('p'), column: tag('c') },
      { world: tag('b'), player: tag('q'), column: tag('d') },
    ];
    expect(migrate('world', { id: 'w' }, 1, steps)).toEqual({ id: 'w', steps: 'ab' });
    expect(migrate('column', {}, 2, steps)).toEqual({ steps: 'd' });
    expect(migrate('player', { x: 1 }, 3, steps)).toEqual({ x: 1 });
    expect(() => migrate('world', {}, 4, steps)).toThrow(SaveVersionError);
    for (const version of [0, 1.5, '1', undefined])
      expect(() => migrate('player', {}, version, steps)).toThrow(CorruptRecordError);
    expect(migrate('world', { id: 'w' }, SAVE_VERSION)).toEqual({ id: 'w' });
  });

  it('reports a damaged record as unreadable, not as saved by a newer game', () => {
    const thrown = (version: unknown) => {
      try {
        migrate('world', {}, version);
      } catch (error) {
        return error;
      }
      throw new Error('migrate did not throw');
    };
    expect(openErrorKey(thrown(SAVE_VERSION + 1))).toBe('error.world.newer');
    expect(openErrorKey(thrown(undefined))).toBe('error.world.corrupt');
    expect(openErrorKey(thrown(undefined), 'error.import')).toBe('error.import');
  });

  it('loads the v1 fixture: world, player, edits in two columns and a drop', async () => {
    const stored = fixture(1);
    const storage = new MemoryStorage();
    await storage.write({ ...stored, removed: [] });
    const { sim, restored } = await restoreFrom(storage);
    expect(restored.info.name).toBe('Fixture v1');
    expect([...restored.stored.keys()]).toEqual([columnKey(0, 0), columnKey(1, 0)]);
    expect(sim.seed).toBe('fixture-v1');
    expect(sim.worldType).toBe('flat');
    expect(sim.tick).toBe(109);
    expect(sim.time).toEqual({ ticks: 18 * HOUR_TICKS + 41, frozen: false });
    expect(sim.nextEntityId).toBe(3);
    const player = sim.players.get(1)!;
    expect(player.id).toBe(1);
    expect(player.body.x).toBeCloseTo(-2.19118, 4);
    expect(player.body.z).toBeCloseTo(-4.42616, 4);
    expect(player.yaw).toBe(0.5);
    expect(player.inventory.slice(0, 4)).toEqual([
      { item: 'item:flint_pickaxe', count: 1, durability: 60 },
      { item: 'item:dirt', count: 20 },
      { item: 'item:torch', count: 3 },
      null,
    ]);
    // Version 2 adds an empty craft queue, an empty seen set and no block entities.
    expect(player.craft).toEqual([]);
    expect(player.seen).toEqual({});
    expect(sim.blockEntities.size).toBe(0);
    const drop = sim.entities.get(2) as ItemDropState;
    expect(drop).toMatchObject({ kind: 'itemDrop', item: 'item:sand', count: 2 });
    expect(drop.body.y).toBeCloseTo(65, 3);
    settle(sim);
    const key = (x: number, y: number, z: number) =>
      sim.registry.states[sim.world.getBlock(x, y, z)]!.key;
    for (let y = 65; y <= 68; y++) expect(key(4, y, 4)).toBe('block:stone');
    expect(key(4, 69, 4)).toBe('block:air');
    expect(key(6, 64, 6)).toBe('block:air');
    expect(key(7, 64, 6)).toBe('block:grass');
    expect(key(8, 65, 8)).toBe('block:torch');
    expect(key(10, 65, 10)).toBe('block:broadleaf_log[axis=x]');
    expect(key(40, 70, 5)).toBe('block:stone');
  });

  it('loads the v2 fixture: a chest, a kiln smelting and a craft queue, which run on', async () => {
    const storage = new MemoryStorage();
    await storage.write({ ...fixture(2), removed: [] });
    const { sim, step } = await restoreFrom(storage);
    const chest = sim.blockEntities.get(cellKey(2, 65, 2)) as ContainerEntity;
    expect(chest.slots[0]).toEqual({ item: 'item:dirt', count: 12 });
    expect(chest.slots[8]).toEqual({ item: 'item:flint', count: 3 });
    const kiln = sim.blockEntities.get(cellKey(-2, 65, 2)) as StationEntity;
    expect(kiln).toMatchObject({ process: 'process:copper_ingot', progressTicks: 142, tick: 450 });
    // Version 6 keeps a burning station burning, but a kiln's fire only burns for its processes.
    expect(kiln.keepLit).toBe(false);
    const player = sim.players.get(1)!;
    expect(player.craft).toEqual([
      {
        recipe: 'recipe:cord',
        count: 1,
        progressTicks: 11,
        reserved: [{ item: 'item:plant_fiber', count: 3 }],
      },
    ]);
    expect(player.seen['item:copper_ore']).toBe(true);
    // Version 3 adds full gauges, no gear, no bedroll, no graves and no objectives done.
    expect(player.survival).toEqual(createSurvival(sim.registry.pack.balance));
    expect(player.equipment).toEqual([null, null, null, null, null]);
    expect(player).toMatchObject({ respawn: null, graves: [], objectives: [] });
    settle(sim);
    step(160);
    expect(kiln.slots[3]).toEqual({ item: 'item:copper_ingot', count: 2 });
    expect(countItem(player.inventory, 'item:cord')).toBe(2);
  });

  it('loads the v3 fixture: gauges, an effect, worn fur, a bedroll, a grave and objectives', async () => {
    const storage = new MemoryStorage();
    await storage.write({ ...fixture(3), removed: [] });
    const { sim, step } = await restoreFrom(storage);
    const player = sim.players.get(1)!;
    expect(player.survival).toMatchObject({
      health: 72.5,
      thirst: 41.25,
      temperature: -45,
      toxicity: 12,
      cause: 'fall',
      effects: [{ key: 'weakened', ticks: 1800 }],
    });
    expect(player.equipment[0]).toEqual({ item: 'item:fur_hood', count: 1, durability: 280 });
    expect(player.equipment[2]).toEqual({ item: 'item:fur_coat', count: 1, durability: 395 });
    expect(player.respawn).toEqual({ x: 3, y: 65, z: 3 });
    expect(player.graves).toEqual([{ x: -6, y: 65, z: 4 }]);
    expect(player.objectives).toEqual(['objective:gather', 'objective:tools']);
    // Version 4 adds the drink: not had yet.
    expect(player.drank).toBe(false);
    // Version 5: its stored column counts as having placed its herd.
    expect(sim.herdColumns.size).toBe(fixture(3).columns.length);
    settle(sim);
    step(30);
    // The game runs on: thirst drains, the effect counts down, the temperature drifts back.
    expect(player.survival.thirst).toBeLessThan(41.25);
    expect(player.survival.effects).toEqual([{ key: 'weakened', ticks: 1770 }]);
    expect(player.survival.temperature).toBeGreaterThan(-45);
  });

  it('loads the v4 fixture: a drink had, and a pack keeping its worn boots apart', async () => {
    const storage = new MemoryStorage();
    await storage.write({ ...fixture(4), removed: [] });
    const { sim } = await restoreFrom(storage);
    const player = sim.players.get(1)!;
    expect(player.drank).toBe(true);
    expect(player.graves).toEqual([{ x: 6, y: 65, z: 4 }]);
    const pack = sim.blockEntities.get(cellKey(6, 65, 4)) as GraveEntity;
    expect(pack.slots).toEqual([
      { item: 'item:dirt', count: 5 },
      { item: 'item:leather_tunic', count: 1, durability: 90 },
    ]);
    expect(pack.worn).toEqual([
      null,
      null,
      null,
      null,
      { item: 'item:waxed_boots', count: 1, durability: 210 },
    ]);
    // Version 5: a stored column had its first generation long ago (it was edited since), so it
    // counts as having placed its herd: none lands on the player's builds.
    expect([...sim.herdColumns]).toEqual([columnKey(0, 0)]);
    expect(migrate('column', { entities: [] }, 4)).toEqual({ entities: [], herds: true });
  });

  it('upgrades a version 3 pack and player: nothing worn apart, no drink had', () => {
    const grave = {
      kind: 'grave',
      x: 1,
      y: 65,
      z: 1,
      slots: [{ item: 'item:fur_hood', count: 1 }],
    };
    const chest = { kind: 'container', x: 2, y: 65, z: 1, slots: [] };
    const column = migrate('column', { blockEntities: [grave, chest] }, 3);
    expect(column.blockEntities).toEqual([{ ...grave, worn: [] }, chest]);
    expect(migrate('player', { playerId: 1 }, 3)).toEqual({
      playerId: 1,
      drank: false,
      cursor: null,
    });
  });

  it('loads the v5 fixture: a herd of Trotters, one hurt and fleeing, a Shagback, a herd flag', async () => {
    const storage = new MemoryStorage();
    await storage.write({ ...fixture(5), removed: [] });
    const { sim, step } = await restoreFrom(storage);
    const creatures = [...sim.entities.values()].filter((e) => e.kind === 'creature');
    expect(creatures.map((c) => [c.id, c.creature])).toEqual([
      [2, 'creature:trotter'],
      [3, 'creature:trotter'],
      [4, 'creature:shagback'],
    ]);
    const [fleeing, calm] = creatures;
    expect(fleeing).toMatchObject({ health: 7, mode: 'flee', target: 1, herd: 2 });
    expect(fleeing).toMatchObject({
      pathLength: 4,
      pathStep: 1,
      path: [5, 65, -6, 6, 65, -6, 7, 65, -6, 8, 65, -6],
    });
    expect(calm).toMatchObject({ health: 12, mode: 'idle', herd: 2 });
    expect([...sim.herdColumns]).toEqual([columnKey(0, 0)]);
    settle(sim);
    step(30);
    // It runs on east along its path, away from the player.
    expect(fleeing!.body.x).toBeGreaterThan(7);
  });

  it('upgrades version 5 stations: a fire burning when saved is kept burning', () => {
    const station = (lit: boolean) => ({
      kind: 'station',
      station: 'station:campfire',
      x: 1,
      y: 65,
      z: 1,
      lit,
    });
    const chest = { kind: 'container', x: 2, y: 65, z: 1, slots: [] };
    const column = migrate('column', { blockEntities: [station(true), station(false), chest] }, 5);
    expect(column.blockEntities).toEqual([
      { ...station(true), keepLit: true },
      { ...station(false), keepLit: false },
      chest,
    ]);
    expect(migrate('column', { blockEntities: 'x' }, 5)).toEqual({ blockEntities: 'x' });
  });

  it('loads the v5 fixture with a campfire burning when saved: it burns on, kept lit', async () => {
    // The v5 fixture holds no station: one burning there, as version 5 saved it, is added.
    const stored = fixture(5);
    const fire = {
      kind: 'station',
      x: 3,
      y: 65,
      z: 3,
      station: 'station:campfire',
      slots: [null, null, { item: 'item:broadleaf_log', count: 2 }, null],
      burnTicksLeft: 600,
      burnTicks: 1200,
      progressTicks: 0,
      process: '',
      lit: true,
      tick: 61,
    };
    // As version 5 wrote it: no `keepLit` yet.
    const columns = stored.columns.map((c) =>
      c.cx === 0 && c.cz === 0 ? { ...c, blockEntities: [fire as unknown as BlockEntity] } : c,
    );
    const storage = new MemoryStorage();
    await storage.write({ ...stored, columns, removed: [] });
    const { sim, step } = await restoreFrom(storage);
    const campfire = sim.blockEntities.get(cellKey(3, 65, 3)) as StationEntity;
    expect(campfire).toMatchObject({ keepLit: true, lit: true });
    settle(sim);
    step(610);
    // Its log burnt out (600 ticks left), it lit the next one, with nothing to cook.
    expect(campfire.slots[2]).toEqual({ item: 'item:broadleaf_log', count: 1 });
    expect(campfire).toMatchObject({ lit: true, process: '' });
  });

  it('loads the v6 fixture: a campfire kept burning, an idle one that burns nothing', async () => {
    const storage = new MemoryStorage();
    await storage.write({ ...fixture(6), removed: [] });
    const { sim, step } = await restoreFrom(storage);
    const kept = sim.blockEntities.get(cellKey(3, 65, -3)) as StationEntity;
    const idle = sim.blockEntities.get(cellKey(-3, 65, -3)) as StationEntity;
    expect(kept).toMatchObject({ keepLit: true, lit: true, burnTicksLeft: 1174 });
    expect(idle).toMatchObject({ keepLit: false, lit: false, burnTicksLeft: 0 });
    // The jump is no longer remembered between ticks: the body has no `jumpHeldLast`.
    expect('jumpHeldLast' in sim.players.get(1)!.body).toBe(false);
    settle(sim);
    step(1200);
    expect(kept.slots[2]).toEqual({ item: 'item:broadleaf_log', count: 1 });
    expect(idle.slots[2]).toEqual({ item: 'item:broadleaf_log', count: 2 });
    expect(idle.lit).toBe(false);
    const block = (x: number, z: number) => sim.registry.states[sim.world.getBlock(x, 65, z)]!.key;
    expect(block(3, -3)).toBe('block:campfire[lit=1]');
    expect(block(-3, -3)).toBe('block:campfire[lit=0]');
    // Version 7: no cursor stack in an older save; its inventory keeps its 32 slots.
    expect(sim.players.get(1)!.inventory).toHaveLength(32);
  });

  it('upgrades version 6 players: no cursor stack (no slot number of commands is saved)', () => {
    const player = { playerId: 1, inventory: [null], equipment: [] };
    expect(migrate('player', player, 6)).toEqual({ ...player, cursor: null });
    expect(migrate('column', { blockEntities: [] }, 6)).toEqual({ blockEntities: [] });
  });

  it('loads the v7 fixture: a cursor stack back in an inventory of 40, a workbench at work', async () => {
    const storage = new MemoryStorage();
    const stored = fixture(7);
    expect(stored.players[0]!.cursor).toEqual({ item: 'item:dirt', count: 10 });
    await storage.write({ ...stored, removed: [] });
    const { sim, step } = await restoreFrom(storage);
    const player = sim.players.get(1)!;
    expect([player.screen, player.cursor]).toEqual([null, null]);
    expect(player.inventory).toHaveLength(40);
    // The 10 on the cursor join the 10 left in their slot.
    expect(player.inventory[0]).toEqual({ item: 'item:dirt', count: 20 });
    expect(player.inventory[39]).toEqual({ item: 'item:stick', count: 1 });
    const chest = sim.blockEntities.get(cellKey(2, 65, -2)) as ContainerEntity;
    expect(chest.slots[0]).toEqual({ item: 'item:flint', count: 3 });
    // A workbench with a chest made and another under way, its ingredients reserved.
    const bench = sim.blockEntities.get(cellKey(4, 65, -2)) as WorkbenchEntity;
    expect(bench.slots).toEqual([{ item: 'item:chest', count: 1 }, null, null, null]);
    expect(bench.craft).toEqual([
      {
        recipe: 'recipe:chest',
        count: 1,
        progressTicks: 11,
        reserved: [
          { item: 'item:planks', count: 8 },
          { item: 'item:cord', count: 1 },
        ],
      },
    ]);
    settle(sim);
    step(ticksOf(3) - 11);
    expect(bench.slots[0]).toEqual({ item: 'item:chest', count: 2 });
    expect(bench.craft).toEqual([]);
  });
});
