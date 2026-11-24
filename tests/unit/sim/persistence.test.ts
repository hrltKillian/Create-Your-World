import { describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { buildRegistry } from '../../../src/content/registry.ts';
import type { Command } from '../../../src/sim/commands.ts';
import { InlineColumnSource } from '../../../src/sim/InlineColumnSource.ts';
import { countItem, INVENTORY_SLOTS } from '../../../src/sim/inventory.ts';
import { type ItemDropState, spawnDrop } from '../../../src/sim/itemDrops.ts';
import { MemoryStorage } from '../../../src/sim/MemoryStorage.ts';
import { persistentHash, restoreSim, snapshotSim } from '../../../src/sim/persistence.ts';
import { PHYSICS } from '../../../src/sim/physics.ts';
import type { PlayerState } from '../../../src/sim/player.ts';
import type { Simulation } from '../../../src/sim/Simulation.ts';
import { dropRecord, playerRecord, readDrop, readPlayer } from '../../../src/sim/saveRecords.ts';
import type { ColumnRecord, SaveBatch } from '../../../src/sim/storage.ts';
import { type Bot, wanderBot } from '../../../src/sim/testing/bots.ts';
import { createInlineSim } from '../../../src/sim/testing/inlineSim.ts';
import { botTick } from '../../../src/sim/testing/runBot.ts';
import { unpackSections } from '../../../src/world/codec/columnRecord.ts';
import {
  CorruptRecordError,
  SAVE_VERSION,
  SaveVersionError,
} from '../../../src/world/codec/migrations.ts';
import { columnKey, localIndex, WORLD_HEIGHT } from '../../../src/world/coords.ts';
import { registry } from '../../helpers/registry.ts';
import { restoreFrom, saveTo, settle, TEST_WORLD, zlibDeflater } from '../../helpers/save.ts';
import { withTicks } from '../../helpers/simHarness.ts';

type TestSim = ReturnType<typeof withTicks>;

const stateKey = (sim: Simulation, x: number, y: number, z: number) =>
  sim.registry.states[sim.world.getBlock(x, y, z)]!.key;

const drops = (sim: Simulation) =>
  [...sim.entities.values()].filter((e): e is ItemDropState => e.kind === 'itemDrop');

/** Sends one command and runs the tick that applies it. */
function send(s: TestSim, command: Command): void {
  s.host.send(command);
  s.step();
}

function fill(s: TestSim, x: number, y: number, z: number, state: string): void {
  send(s, { type: 'debug.fill', x0: x, y0: y, z0: z, x1: x, y1: y, z1: z, state });
}

/** A flat world (grass at y 64) with player 1 loaded around (0.5, 65, 0.5). */
function flatSim(seed: string, reg = registry): TestSim {
  const s = withTicks(
    createInlineSim({ registry: reg, seed, worldType: 'flat', allowDebug: true }),
  );
  s.sim.addPlayer(1, 2);
  settle(s.sim);
  return s;
}

describe('memory storage', () => {
  it('writes batches, removes columns, deletes worlds and keeps small values', async () => {
    const world = snapshotSim(flatSim('mem').sim, TEST_WORLD, new Map()).world;
    const column = (cx: number): ColumnRecord => ({
      worldId: world.id,
      cx,
      cz: 0,
      v: 1,
      codec: 'raw',
      payload: new Uint8Array([0]),
      entities: [],
      blockEntities: [],
      herds: false,
      lastTick: 0,
    });
    const storage = new MemoryStorage();
    const batch: SaveBatch = { world, players: [], columns: [column(1), column(2)], removed: [] };
    await storage.write(batch);
    await storage.write({ ...batch, world: { ...world, id: 'other' }, columns: [] });
    await storage.write({ ...batch, columns: [], removed: [{ cx: 1, cz: 0 }] });
    expect((await storage.listWorlds()).map((w) => w.id)).toEqual([world.id, 'other']);
    expect((await storage.loadWorld(world.id))!.columns.map((c) => c.cx)).toEqual([2]);
    await storage.deleteWorld(world.id);
    expect(await storage.loadWorld(world.id)).toBeUndefined();
    expect((await storage.listWorlds()).map((w) => w.id)).toEqual(['other']);
    expect(await storage.getKv('lastWorld')).toBeUndefined();
    await storage.setKv('lastWorld', 'other');
    expect(await storage.getKv('lastWorld')).toBe('other');
  });
});

describe('save records', () => {
  it('round-trip the world, the player and the drops, before any column is loaded', async () => {
    const s = flatSim('records');
    send(s, { type: 'debug.give', item: 'item:flint_pickaxe', count: 1 });
    send(s, { type: 'debug.give', item: 'item:dirt', count: 70 });
    s.tick(20, { forward: 1, yaw: 0.7, pitch: -0.2 });
    spawnDrop(s.sim, { item: 'item:sand', count: 4 }, 3.5, 70, 2.5, 1, 0, 0, 5);
    fill(s, 2, 70, 2, 'block:stone');
    send(s, { type: 'debug.setTime', hours: 21 });
    s.step(7);
    const storage = new MemoryStorage();
    await saveTo(storage, s.sim);
    const stored = (await storage.loadWorld(TEST_WORLD.id))!;
    expect(stored.world).toMatchObject({
      ...TEST_WORLD,
      saveVersion: SAVE_VERSION,
      seed: 'records',
      worldType: 'flat',
      tick: s.sim.tick,
      nextEntityId: s.sim.nextEntityId,
      spawn: s.sim.spawn,
    });
    expect(stored.players[0]!.inventory[1]).toEqual({ item: 'item:dirt', count: 50 });
    const r = await restoreFrom(storage);
    expect(r.restored.info).toEqual(TEST_WORLD);
    expect(r.restored.contentChanged).toBe(false);
    expect([...r.restored.stored.keys()]).toEqual([columnKey(0, 0)]);
    expect(r.sim.tick).toBe(s.sim.tick);
    expect(r.sim.time).toEqual(s.sim.time);
    expect(r.sim.spawn).toEqual(s.sim.spawn);
    expect(r.sim.nextEntityId).toBe(s.sim.nextEntityId);
    const player = r.sim.players.get(1)!;
    expect(playerRecord('w', player)).toEqual(playerRecord('w', s.sim.players.get(1)!));
    expect(player.input).toMatchObject({ forward: 0, yaw: player.yaw, pitch: player.pitch });
    expect(drops(r.sim).map(dropRecord)).toEqual(drops(s.sim).map(dropRecord));
    expect(persistentHash(r.sim)).toBe(persistentHash(s.sim));
  });

  it('read malformed records as defaults', () => {
    const spawn = { x: 1, y: 2, z: 3 };
    expect(readPlayer(undefined, registry, spawn)).toBeNull();
    expect(readPlayer({ playerId: 1, id: 0 }, registry, spawn)).toBeNull();
    const saved = { playerId: 4, id: 9, body: { x: 'far' }, stamina: null, inventory: 'none' };
    const fresh = readPlayer(saved, registry, spawn)!;
    expect(fresh.body).toMatchObject(spawn);
    expect(fresh.stamina).toBe(100);
    expect(fresh.inventory.every((slot) => slot === null)).toBe(true);
    const drop = (fields: object) =>
      readDrop({ kind: 'itemDrop', id: 2, item: 'item:dirt', count: 1, ...fields }, registry);
    expect(drop({ body: spawn, count: 0 })).toBeNull();
    expect(drop({ body: { x: 1 } })).toBeNull();
    expect(drop({ body: spawn, age: -1 })).toMatchObject({
      age: 0,
      pickupDelay: 0,
      thrower: -1,
      body: { ...spawn, vx: 0, onGround: false },
    });
  });

  it('keep crafted speeds, positions, cells and ids within the world', () => {
    const spawn = { x: 1, y: 70, z: 3 };
    const fast = { x: 5, y: 70, z: 5, vx: 1e13, vy: -1e13, vz: 1e13 };
    const cells = { respawn: { x: 2e15, y: 10, z: 0 }, graves: [{ x: 0, y: 1, z: -2e15 }, spawn] };
    const player = readPlayer({ playerId: 1, id: 2, body: fast, ...cells }, registry, spawn)!;
    const terminal = PHYSICS.terminal;
    expect(player.body).toMatchObject({ x: 5, vx: terminal, vy: -terminal, vz: terminal });
    expect(player.respawn).toBeNull();
    expect(player.graves).toEqual([spawn]);
    for (const body of [
      { x: 1e15, y: 70, z: 0 },
      { x: 0, y: -3, z: 0 },
      { x: 0, y: 1e9, z: 0 },
    ]) {
      const fall = { vy: -50, onGround: true, airTicks: 99, fallStartY: 1e9, crouching: true };
      const far = readPlayer({ playerId: 1, id: 2, body: { ...body, ...fall } }, registry, spawn)!;
      expect(far.body).toMatchObject({ ...spawn, vy: 0, onGround: false, airTicks: 0 });
      expect(far.body).toMatchObject({ fallStartY: spawn.y, crouching: false });
      expect(far.prevX).toBe(spawn.x);
    }
    expect(readPlayer({ playerId: 1, id: 2 ** 60 }, registry, spawn)).toBeNull();
    const drop = (body: object) =>
      readDrop({ kind: 'itemDrop', id: 2, item: 'item:dirt', count: 1, body }, registry);
    expect(drop(fast)!.body).toMatchObject({ vx: terminal, vy: -terminal, vz: terminal });
    expect(drop({ x: 1e15, y: 70, z: 0 })).toBeNull();
    // Thrown at a jump's apex from the top layer: brought down within reach of it, not lost.
    expect(drop({ x: 0, y: WORLD_HEIGHT + 2.6, z: 0 })!.body.y).toBe(WORLD_HEIGHT + 2);
    expect(drop({ x: 0, y: 1e9, z: 0 })!.body.y).toBe(WORLD_HEIGHT + 2);
  });
});

describe('restoring a world', () => {
  it('keeps both edits of a column reloaded, edited in another section and saved again', async () => {
    const storage = new MemoryStorage();
    const first = flatSim('two-edits');
    fill(first, 5, 70, 5, 'block:stone'); // section 2
    let stored = await saveTo(storage, first.sim);
    const second = await restoreFrom(storage);
    settle(second.sim);
    expect(stateKey(second.sim, 5, 70, 5)).toBe('block:stone');
    expect(second.sim.world.getColumn(0, 0)!.persisted).toBe(1 << 2);
    fill(second, 6, 170, 6, 'block:torch'); // section 5
    stored = await saveTo(storage, second.sim, stored);
    const third = await restoreFrom(storage);
    expect(third.sim.edits.get(columnKey(0, 0))!.map((s) => s.sy)).toEqual([2, 5]);
    settle(third.sim);
    expect(stateKey(third.sim, 5, 70, 5)).toBe('block:stone');
    expect(stateKey(third.sim, 6, 170, 6)).toBe('block:torch');
    expect([...stored.keys()]).toEqual([columnKey(0, 0)]);
  });

  it('gives the same persistent state after save, reload and resume (ticks 1500 → 3000)', async () => {
    const seed = 'resume';
    /** The wander bot, with edits in two sections, items and a throw near the player at 1400. */
    const commands: Command[] = [];
    const drive = (s: TestSim, bot: Bot, to: number) => {
      while (s.sim.tick < to) {
        const player = s.sim.players.get(1)!;
        if (s.sim.tick === 1400) {
          const x = Math.floor(player.body.x) + 3;
          const z = Math.floor(player.body.z) + 3;
          const box = { x0: x, z0: z, x1: x + 2, z1: z };
          s.host.send({ type: 'debug.fill', ...box, y0: 150, y1: 152, state: 'block:planks' });
          s.host.send({ type: 'debug.fill', ...box, y0: 220, y1: 220, state: 'block:stone' });
          s.host.send({ type: 'debug.give', item: 'item:dirt', count: 5 });
          s.host.send({ type: 'inv.drop', slot: 0, all: false });
        }
        botTick(s.host, bot, player, commands, s.events);
        s.events.length = 0;
      }
    };
    const start = () => {
      const s = withTicks(createInlineSim({ registry, seed, allowDebug: true }));
      s.sim.addPlayer(1, 2);
      return s;
    };
    const straight = start();
    drive(straight, wanderBot(seed), 3000);

    const first = start();
    const bot = wanderBot(seed);
    drive(first, bot, 1500);
    expect(drops(first.sim)).toHaveLength(1);
    const storage = new MemoryStorage();
    await saveTo(storage, first.sim);
    const resumed = await restoreFrom(storage);
    expect(persistentHash(resumed.sim)).toBe(persistentHash(first.sim));
    settle(resumed.sim);
    drive(resumed, bot, 3000);

    expect(resumed.sim.tick).toBe(3000);
    expect(resumed.sim.players.get(1)!.body).toEqual(straight.sim.players.get(1)!.body);
    expect(persistentHash(resumed.sim)).toBe(persistentHash(straight.sim));
  });

  it('gives the same persistent state after save, reload and resume in the middle of a fight', async () => {
    /**
     * Noon in the flat world: the player strikes a Shagback and takes its blow; a Trotter comes
     * within earshot of the fight, and the player strikes again.
     */
    const start = () => {
      const s = flatSim('fight-save');
      send(s, { type: 'debug.setTime', hours: 12 });
      send(s, { type: 'debug.freezeTime', frozen: true });
      const id = s.sim.nextEntityId;
      send(s, {
        type: 'debug.spawn',
        creature: 'creature:shagback',
        x: 0.5,
        y: 'surface',
        z: -1.8,
      });
      const shagback = s.sim.entities.get(id)!;
      const player = s.sim.players.get(1)!;
      /** Primary pressed one tick and released the next, aimed at the middle of the Shagback. */
      const blow = () => {
        const p = player.body;
        const dx = shagback.body.x - p.x;
        const dz = shagback.body.z - p.z;
        const dy = shagback.body.y + 0.75 - (p.y + 1.62);
        const aim = { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
        s.tick(1, { ...aim, primary: true });
        s.tick(1, aim);
      };
      blow();
      s.events.length = 0;
      for (let i = 0; i < 300 && !s.events.some((e) => e.type === 'playerHurt'); i++) s.step();
      send(s, { type: 'debug.spawn', creature: 'creature:trotter', x: 9.5, y: 'surface', z: 0.5 });
      blow();
      return { s, player };
    };
    const straight = start();
    const first = start();
    const fight = (p: PlayerState) => [p.fightTicks, p.attackCooldown, p.invulnerable];
    for (const value of fight(first.player)) expect(value).toBeGreaterThan(0);
    const storage = new MemoryStorage();
    await saveTo(storage, first.s.sim);
    const resumed = await restoreFrom(storage);
    expect(fight(resumed.sim.players.get(1)!)).toEqual(fight(first.player));
    expect(persistentHash(resumed.sim)).toBe(persistentHash(first.s.sim));
    settle(resumed.sim);
    straight.s.step(90);
    resumed.step(90);
    expect(persistentHash(resumed.sim)).toBe(persistentHash(straight.s.sim));
  });

  it('picks up competing drops in the same order after a reload (same hash)', async () => {
    /** One free slot, and two drops of other items at the player's feet once their delay ends. */
    const start = () => {
      const s = flatSim('compete');
      send(s, { type: 'debug.give', item: 'item:stone', count: 50 * (INVENTORY_SLOTS - 1) });
      const p = s.sim.players.get(1)!.body;
      const dirt = { item: 'item:dirt', count: 1 };
      const older = spawnDrop(s.sim, dirt, p.x - 9, p.y, p.z, 0, 0, 0, 40);
      spawnDrop(s.sim, { item: 'item:sand', count: 1 }, p.x + 0.4, p.y, p.z, 0, 0, 0, 40);
      // The older drop reaches the newer one's cell after it: the spatial hash links it last
      // there, where a restored world links every entity in id order.
      older.body.x = p.x - 0.4;
      s.sim.spatial.update(older.id, older.body.x, older.body.z);
      s.step(5);
      return s;
    };
    const straight = start();
    straight.step(60);
    const first = start();
    const storage = new MemoryStorage();
    await saveTo(storage, first.sim);
    const resumed = await restoreFrom(storage);
    settle(resumed.sim);
    resumed.step(60);
    expect(resumed.sim.tick).toBe(straight.sim.tick);
    // The older drop (lower id) took the slot in both runs.
    for (const run of [straight, resumed]) {
      expect(countItem(run.sim.players.get(1)!.inventory, 'item:dirt')).toBe(1);
      expect(drops(run.sim).map((d) => d.item)).toEqual(['item:sand']);
    }
    expect(persistentHash(resumed.sim)).toBe(persistentHash(straight.sim));
  });

  it('keeps item drops with their column, frozen while it is unloaded', async () => {
    const s = flatSim('drops');
    const drop = spawnDrop(s.sim, { item: 'item:sand', count: 3 }, 20.5, 66, 20.5);
    s.step(30);
    expect(drop.body.onGround).toBe(true);
    send(s, { type: 'debug.teleport', x: 8 * 32 + 16, y: 'surface', z: 16 });
    s.step(100);
    expect(s.sim.world.getColumn(0, 0)).toBeUndefined();
    const age = drop.age;
    s.step(50);
    expect(s.sim.entities.get(drop.id)).toBe(drop);
    expect(drop.age).toBe(age);
    const storage = new MemoryStorage();
    expect([...(await saveTo(storage, s.sim)).keys()]).toEqual([columnKey(0, 0)]);
    const r = await restoreFrom(storage);
    expect(drops(r.sim)).toEqual([drop]);
    send(r, { type: 'debug.teleport', x: 20.5, y: 'surface', z: 21.5 });
    r.step(150);
    // Its column loaded again, the drop is picked up.
    expect(r.sim.entities.has(drop.id)).toBe(false);
    expect(r.sim.players.get(1)!.inventory.some((slot) => slot?.item === 'item:sand')).toBe(true);
    // The next save removes the emptied column record.
    const batch = snapshotSim(r.sim, TEST_WORLD, r.restored.stored);
    expect(batch.columns).toEqual([]);
    expect(batch.removed).toEqual([{ cx: 0, cz: 0 }]);
  });

  it('remaps the states of a save to a pack whose ids moved', async () => {
    const blocks = [basePack.blocks[0]!, ...basePack.blocks.slice(1).reverse()];
    const reordered = buildRegistry({ ...basePack, blocks });
    expect(reordered.stateId('block:torch')).not.toBe(registry.stateId('block:torch'));
    const s = flatSim('remap');
    fill(s, 3, 70, 3, 'block:broadleaf_log[axis=x]');
    fill(s, 4, 70, 3, 'block:torch');
    fill(s, 5, 64, 3, 'block:air');
    const storage = new MemoryStorage();
    await saveTo(storage, s.sim);
    const r = await restoreFrom(storage, reordered);
    expect(r.restored.contentChanged).toBe(true);
    settle(r.sim);
    const cells = [
      [3, 70, 3],
      [4, 70, 3],
      [5, 64, 3],
      [6, 64, 3],
      [3, 63, 3],
    ] as const;
    for (const [x, y, z] of cells)
      expect(stateKey(r.sim, x, y, z), `${x},${y},${z}`).toBe(stateKey(s.sim, x, y, z));
  });

  it('turns keys the pack lacks into the unknown block and item, the item keeping its key', async () => {
    const stone = basePack.blocks.find((b) => b.key === 'block:stone')!;
    const relic = { ...stone, key: 'block:relic' } as const;
    const s = flatSim('relic', buildRegistry({ ...basePack, blocks: [...basePack.blocks, relic] }));
    fill(s, 2, 66, 2, 'block:relic');
    send(s, { type: 'debug.give', item: 'item:relic', count: 3 });
    spawnDrop(s.sim, { item: 'item:relic', count: 2 }, 9.5, 65, 9.5);
    const storage = new MemoryStorage();
    await saveTo(storage, s.sim);

    const r = await restoreFrom(storage);
    settle(r.sim);
    expect(r.sim.world.getBlock(2, 66, 2)).toBe(registry.unknownBlock);
    const unknown = { item: registry.unknownItem, original: 'item:relic' };
    expect(r.sim.players.get(1)!.inventory[0]).toEqual({ ...unknown, count: 3 });
    expect(drops(r.sim)[0]).toMatchObject({ ...unknown, count: 2 });
    // Saved again, the items go back to their own key; the block stays unknown.
    const again = snapshotSim(r.sim, TEST_WORLD, new Map());
    expect(again.players[0]!.inventory[0]).toEqual({ item: 'item:relic', count: 3 });
    expect(again.columns[0]!.entities[0]).toMatchObject({ item: 'item:relic' });
    const [section] = unpackSections(again.columns[0]!.payload, (id) => id);
    expect(section!.blocks![localIndex(2, 2, 2)]).toBe(registry.unknownBlock);
  });

  it('refuses a save from a newer version and skips unreadable columns', async () => {
    const s = flatSim('versions');
    fill(s, 1, 70, 1, 'block:stone');
    fill(s, 40, 70, 1, 'block:stone');
    const batch = snapshotSim(s.sim, TEST_WORLD, new Map());
    const newer = new MemoryStorage();
    await newer.write({ ...batch, world: { ...batch.world, saveVersion: SAVE_VERSION + 1 } });
    await expect(restoreFrom(newer)).rejects.toThrow(SaveVersionError);
    const damaged = new MemoryStorage();
    const [good, bad] = batch.columns;
    const garbage = {
      ...bad!,
      codec: 'deflate-raw',
      payload: new Uint8Array([0xff, 0xff]),
    } as const;
    await damaged.write({ ...batch, columns: [good!, garbage] });
    const r = await restoreFrom(damaged);
    expect([...r.restored.stored.keys()]).toEqual([columnKey(0, 0)]);
    expect([...r.sim.edits.keys()]).toEqual([columnKey(0, 0)]);
    const options = { registry, source: new InlineColumnSource(registry), maxInFlight: 1 };
    expect(await restoreSim(damaged, 'missing', options, zlibDeflater)).toBeUndefined();
  });

  it('skips a damaged player record, and calls a versionless world damaged', async () => {
    const s = flatSim('players');
    s.sim.addPlayer(2, 2);
    const batch = snapshotSim(s.sim, TEST_WORLD, new Map());
    const [one, two] = batch.players;
    const storage = new MemoryStorage();
    await storage.write({ ...batch, players: [{ ...one!, v: undefined as never }, two!] });
    const r = await restoreFrom(storage);
    expect([...r.sim.players.keys()]).toEqual([2]);
    expect(r.sim.players.get(2)!.id).toBe(two!.id);
    const damaged = new MemoryStorage();
    await damaged.write({ ...batch, world: { ...batch.world, saveVersion: undefined as never } });
    await expect(restoreFrom(damaged)).rejects.toThrow(CorruptRecordError);
  });

  it('calls a world record with a spawn out of the world or an endless counter damaged', async () => {
    const batch = snapshotSim(flatSim('crafted').sim, TEST_WORLD, new Map());
    const crafted = [
      { spawn: { x: 1e15, y: 70, z: 0 } },
      { spawn: { x: 0, y: -1, z: 0 } },
      { tick: 1e300 },
      { nextEntityId: 2 ** 60 },
    ];
    for (const fields of crafted) {
      const storage = new MemoryStorage();
      await storage.write({ ...batch, world: { ...batch.world, ...fields } });
      await expect(restoreFrom(storage)).rejects.toThrow('Corrupt world record');
    }
  });
});
