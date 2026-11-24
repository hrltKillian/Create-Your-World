import { describe, expect, it } from 'vitest';
import { fuelSlotOf } from '../../../src/content/crafting.ts';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { buildRegistry, type Registry } from '../../../src/content/registry.ts';
import type { RecipeDef } from '../../../src/content/schema.ts';
import type { ContainerEntity, StationEntity } from '../../../src/sim/blockEntities.ts';
import { countItem } from '../../../src/sim/inventory.ts';
import { MemoryStorage } from '../../../src/sim/MemoryStorage.ts';
import { persistentHash, snapshotSim } from '../../../src/sim/persistence.ts';
import type { Simulation } from '../../../src/sim/Simulation.ts';
import {
  blockEntityRecord,
  playerRecord,
  readBlockEntity,
  readPlayer,
} from '../../../src/sim/saveRecords.ts';
import type { SaveBatch } from '../../../src/sim/storage.ts';
import { cellKey } from '../../../src/world/coords.ts';
import { registry } from '../../helpers/registry.ts';
import { restoreFrom, saveTo, settle, TEST_WORLD } from '../../helpers/save.ts';
import { playerTestSim, withPlayer } from '../../helpers/simHarness.ts';

type TestSim = ReturnType<typeof playerTestSim>;

/** A flat world (grass at y 64) with player 1 at (0.5, 65, 0.5). */
const flatSim = (seed: string, reg: Registry = registry) => playerTestSim({ seed, registry: reg });

/** The test world restored from a storage, with player 1's command helpers. */
const reopen = async (storage: MemoryStorage) => withPlayer(await restoreFrom(storage));

const records = (sim: Simulation) =>
  [...sim.blockEntities.values()].map(blockEntityRecord).sort((a, b) => a.x - b.x);

/** A chest with dirt and flint, a kiln smelting copper ore, and two cords queued. */
function furnish(s: TestSim): void {
  s.put(2, 65, 2, 'block:chest[facing4=n]');
  s.put(-2, 65, 2, 'block:kiln[facing4=n,lit=0]');
  s.give('item:dirt', 12);
  s.give('item:flint', 3);
  s.send(
    { type: 'container.open', x: 2, y: 65, z: 2 },
    { type: 'container.move', from: 0 },
    { type: 'container.move', from: 1, to: 40 },
  );
  s.give('item:copper_ore', 3);
  s.give('item:charcoal', 1);
  const fuel = 32 + fuelSlotOf(registry.crafting.station('station:kiln')!);
  s.send(
    { type: 'container.open', x: -2, y: 65, z: 2 },
    { type: 'station.move', from: 0 },
    { type: 'station.move', from: 1, to: fuel },
  );
  s.step(400);
  s.give('item:plant_fiber', 7);
  s.send({ type: 'craft.enqueue', recipe: 'recipe:cord', count: 2 });
  s.step(40);
}

describe('saving block entities and craft queues', () => {
  it('round-trips chests, stations and craft queues, then runs on as if never saved', async () => {
    const s = flatSim('furnished');
    furnish(s);
    const kiln = s.sim.blockEntities.get(cellKey(-2, 65, 2)) as StationEntity;
    expect(kiln).toMatchObject({ lit: true, process: 'process:copper_ingot' });
    expect(s.sim.players.get(1)!.craft[0]).toMatchObject({ count: 1 });
    const storage = new MemoryStorage();
    await saveTo(storage, s.sim);
    const stored = (await storage.loadWorld(TEST_WORLD.id))!;
    expect(stored.columns.map((c) => [c.cx, c.blockEntities.map((e) => e.kind)])).toEqual([
      [-1, ['station']],
      [0, ['container']],
    ]);
    const r = await reopen(storage);
    expect(records(r.sim)).toEqual(records(s.sim));
    expect(playerRecord('w', r.sim.players.get(1)!)).toEqual(
      playerRecord('w', s.sim.players.get(1)!),
    );
    expect(persistentHash(r.sim)).toBe(persistentHash(s.sim));
    settle(r.sim);
    s.step(700);
    r.step(700);
    expect(records(r.sim)).toEqual(records(s.sim));
    expect(persistentHash(r.sim)).toBe(persistentHash(s.sim));
    const player = r.sim.players.get(1)!;
    expect(countItem(player.inventory, 'item:cord')).toBe(2);
    expect(player.craft).toEqual([]);
    expect(player.seen['item:cord']).toBe(true);
  });

  it('writes a column again when its block entities change, not while they are as stored', async () => {
    const s = flatSim('chest-digest');
    s.put(2, 65, 2, 'block:chest[facing4=n]'); // column (0, 0)
    s.put(-2, 65, 2, 'block:chest[facing4=n]'); // column (-1, 0)
    // Opened once, each chest gets its (empty) block entity, saved with its column.
    s.send({ type: 'container.open', x: 2, y: 65, z: 2 });
    s.send({ type: 'container.open', x: -2, y: 65, z: 2 });
    expect(s.sim.blockEntities.size).toBe(2);
    const storage = new MemoryStorage();
    await saveTo(storage, s.sim);
    const r = await reopen(storage);
    settle(r.sim);
    const written = (batch: SaveBatch) => batch.columns.map((c) => [c.cx, c.cz]);
    const autosave = () => snapshotSim(r.sim, TEST_WORLD, r.restored.stored, new Set());
    // Nothing edited, the chests as stored: no column record to write.
    expect(written(autosave())).toEqual([]);
    r.give('item:dirt', 5);
    expect(written(autosave())).toEqual([]);
    // Items moved into a chest change no block, but its column record must be written again.
    r.send({ type: 'container.open', x: 2, y: 65, z: 2 }, { type: 'container.move', from: 0 });
    expect(written(autosave())).toEqual([[0, 0]]);
    const chest = autosave().columns[0]!.blockEntities[0] as ContainerEntity;
    expect(chest.slots[0]).toEqual({ item: 'item:dirt', count: 5 });
  });

  it('keeps unknown items in block entities under their key, and refunds unknown recipes', async () => {
    const relicRecipe: RecipeDef = {
      key: 'recipe:relic_cord',
      category: 'materials',
      seconds: 3,
      inputs: [{ item: 'item:plant_fiber', count: 2 }],
      output: { item: 'item:cord', count: 1 },
      known: 'start',
    };
    const stone = basePack.blocks.find((b) => b.key === 'block:stone')!;
    const relic = { ...stone, key: 'block:relic' } as const;
    const extended = buildRegistry({
      ...basePack,
      blocks: [...basePack.blocks, relic],
      recipes: [...(basePack.recipes ?? []), relicRecipe],
    });
    const s = flatSim('relics', extended);
    s.put(2, 65, 2, 'block:chest[facing4=n]');
    s.give('item:relic', 4);
    s.send({ type: 'container.open', x: 2, y: 65, z: 2 }, { type: 'container.move', from: 0 });
    s.give('item:plant_fiber', 2);
    s.send({ type: 'craft.enqueue', recipe: 'recipe:relic_cord', count: 1 });
    expect(countItem(s.sim.players.get(1)!.inventory, 'item:plant_fiber')).toBe(0);
    const storage = new MemoryStorage();
    await saveTo(storage, s.sim);

    const r = await reopen(storage);
    const chest = r.sim.blockEntities.get(cellKey(2, 65, 2)) as ContainerEntity;
    expect(chest.slots[0]).toEqual({
      item: registry.unknownItem,
      original: 'item:relic',
      count: 4,
    });
    const player = r.sim.players.get(1)!;
    expect(player.craft).toEqual([]);
    expect(countItem(player.inventory, 'item:plant_fiber')).toBe(2);
    const again = snapshotSim(r.sim, TEST_WORLD, new Map());
    expect(again.columns[0]!.blockEntities[0]!.slots[0]).toEqual({ item: 'item:relic', count: 4 });
  });

  it('reads a malformed craft queue and seen set as defaults', () => {
    const spawn = { x: 0, y: 65, z: 0 };
    const empty = readPlayer({ playerId: 1, id: 1, craft: 'x', seen: 3 }, registry, spawn)!;
    expect([empty.craft, empty.seen, empty.opened]).toEqual([[], {}, null]);
    const craft = [
      { recipe: 'recipe:cord', count: 0 },
      { count: 2 },
      { recipe: 'recipe:cord', count: 2, progressTicks: -1, reserved: [{ item: 'item:x' }] },
    ];
    const read = readPlayer(
      { playerId: 1, id: 1, craft, seen: ['item:dirt', 4] },
      registry,
      spawn,
    )!;
    expect(read.craft).toEqual([
      { recipe: 'recipe:cord', count: 2, progressTicks: 0, reserved: [] },
    ]);
    expect(read.seen).toEqual({ 'item:dirt': true });
  });

  it('reads malformed block entity records as nothing, or with defaults', () => {
    expect(readBlockEntity(undefined, registry, 5)).toBeNull();
    expect(readBlockEntity({ kind: 'container', x: 1.5, y: 2, z: 3 }, registry, 5)).toBeNull();
    expect(readBlockEntity({ kind: 'chest', x: 1, y: 2, z: 3 }, registry, 5)).toBeNull();
    expect(
      readBlockEntity({ kind: 'container', x: 1, y: 2, z: 3, slots: 'x' }, registry, 5),
    ).toEqual({ kind: 'container', x: 1, y: 2, z: 3, slots: new Array(18).fill(null) });
    expect(
      readBlockEntity(
        { kind: 'station', station: 'station:kiln', x: 1, y: 2, z: 3, burnTicksLeft: -4 },
        registry,
        5,
      ),
    ).toEqual({
      kind: 'station',
      station: 'station:kiln',
      x: 1,
      y: 2,
      z: 3,
      slots: [null, null, null, null],
      burnTicksLeft: 0,
      burnTicks: 0,
      progressTicks: 0,
      process: '',
      lit: false,
      keepLit: false,
      tick: 5,
    });
  });

  it('round-trips a campfire kept burning; only a fire that allows it keeps the toggle', async () => {
    const s = flatSim('kept');
    s.put(2, 65, -2, 'block:campfire[lit=0]');
    s.give('item:broadleaf_log', 3);
    const fuel = 32 + fuelSlotOf(registry.crafting.station('station:campfire')!);
    s.send(
      { type: 'container.open', x: 2, y: 65, z: -2 },
      { type: 'station.move', from: 0, to: fuel },
    );
    s.send({ type: 'station.keepLit', on: true });
    s.step(10);
    const fire = s.sim.blockEntities.get(cellKey(2, 65, -2)) as StationEntity;
    expect(fire).toMatchObject({ keepLit: true, lit: true });
    const storage = new MemoryStorage();
    await saveTo(storage, s.sim);
    const r = await reopen(storage);
    expect(records(r.sim)).toEqual(records(s.sim));
    expect(blockEntityRecord(fire)).toMatchObject({ keepLit: true });
    const kiln = { kind: 'station', station: 'station:kiln', x: 1, y: 2, z: 3, keepLit: true };
    expect(readBlockEntity(kiln, registry, 5)).toMatchObject({ keepLit: false });
  });
});
