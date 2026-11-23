import { describe, expect, it } from 'vitest';
import {
  byLastPlayed,
  createWorld,
  deleteClosedWorld,
  exportFileName,
  loadWorld,
  newWorld,
  openErrorKey,
  PLAYER_ID,
  type WorldDeps,
  WorldOpenError,
  worldName,
} from '../../../src/app/worlds.ts';
import { lockWorld } from '../../../src/platform/worldLock.ts';
import { InlineColumnSource } from '../../../src/sim/InlineColumnSource.ts';
import { MemoryStorage } from '../../../src/sim/MemoryStorage.ts';
import { persistentHash } from '../../../src/sim/persistence.ts';
import type { WorldRecord } from '../../../src/sim/storage.ts';
import { SaveVersionError } from '../../../src/world/codec/migrations.ts';
import { registry } from '../../helpers/registry.ts';
import { saveTo, TEST_WORLD, zlibDeflater } from '../../helpers/save.ts';

function deps(storage = new MemoryStorage()): WorldDeps {
  return {
    storage,
    deflater: zlibDeflater,
    registry,
    source: new InlineColumnSource(registry),
    maxInFlight: 4,
    allowDebug: false,
    worldType: 'flat',
    viewRadius: 2,
  };
}

const record = (id: string, savedAt: number) => ({ id, savedAt }) as WorldRecord;

describe('worlds', () => {
  it('fills the blanks of the New world form', () => {
    const world = newWorld({ name: '  Ridge  ', seed: ' 42 ', hostiles: false }, 'New world', 7);
    expect(world).toMatchObject({ name: 'Ridge', seed: '42', hostiles: false, now: 7 });
    const blank = newWorld({ name: ' ', seed: '', hostiles: true }, 'New world', 7);
    expect(blank.name).toBe('New world');
    expect(blank.seed).toMatch(/^[0-9a-z]+$/);
    expect(blank.id).not.toBe(world.id);
    expect(worldName('x'.repeat(60), 'y')).toHaveLength(40);
  });

  it('lists worlds by last save and names export files', () => {
    const order = byLastPlayed([record('a', 1), record('b', 3), record('c', 2)]);
    expect(order.map((w) => w.id)).toEqual(['b', 'c', 'a']);
    expect(exportFileName('Mon Monde: été!')).toBe('mon-monde-ete.cyw.gz');
    expect(exportFileName('///')).toBe('world.cyw.gz');
  });

  it('gives each opening error its message', () => {
    expect(openErrorKey(new WorldOpenError('error.world.locked'))).toBe('error.world.locked');
    expect(openErrorKey(new SaveVersionError('newer'))).toBe('error.world.newer');
    expect(openErrorKey(new Error('?'))).toBe('error.world.corrupt');
    expect(openErrorKey(new Error('?'), 'error.import')).toBe('error.import');
  });

  it('creates a world with its player and rules, held by this tab', async () => {
    const world = newWorld({ name: 'Fresh', seed: 'fresh', hostiles: false }, '', 1000);
    const slot = await createWorld(deps(), world);
    expect(slot).toMatchObject({ created: true, full: true });
    expect(slot.info).toEqual({
      id: world.id,
      name: 'Fresh',
      createdAt: 1000,
      savedAt: 1000,
      rules: { hostiles: false },
    });
    expect(slot.sim.seed).toBe('fresh');
    expect(slot.sim.players.has(PLAYER_ID)).toBe(true);
    expect(await lockWorld(world.id)).toBeNull();
    await slot.lock.release();
  });

  it('restores a saved world, and refuses one another tab holds', async () => {
    const storage = new MemoryStorage();
    const world = { ...newWorld({ name: '', seed: 'saved', hostiles: true }, '', 0) };
    const made = await createWorld(deps(storage), { ...world, id: TEST_WORLD.id });
    await made.lock.release();
    const stored = await saveTo(storage, made.sim);
    const slot = await loadWorld(deps(storage), TEST_WORLD.id);
    expect(slot).toMatchObject({ created: false, full: false, info: { name: TEST_WORLD.name } });
    expect([...slot.stored]).toEqual([...stored]);
    expect(persistentHash(slot.sim)).toBe(persistentHash(made.sim));
    await expect(loadWorld(deps(storage), TEST_WORLD.id)).rejects.toMatchObject({
      key: 'error.world.locked',
    });
    await slot.lock.release();
  });

  it('reports a missing or newer world and lets its lock go', async () => {
    const storage = new MemoryStorage();
    await expect(loadWorld(deps(storage), 'nowhere')).rejects.toMatchObject({
      key: 'error.world.missing',
    });
    const made = await createWorld(deps(storage), {
      ...newWorld({ name: '', seed: 'newer', hostiles: true }, '', 0),
      id: TEST_WORLD.id,
    });
    await made.lock.release();
    await saveTo(storage, made.sim);
    const saved = (await storage.loadWorld(TEST_WORLD.id))!;
    await storage.write({
      ...saved,
      world: { ...saved.world, saveVersion: 99 },
      removed: [],
    });
    await expect(loadWorld(deps(storage), TEST_WORLD.id)).rejects.toMatchObject({
      key: 'error.world.newer',
    });
    const lock = await lockWorld(TEST_WORLD.id);
    expect(lock).not.toBeNull();
    await lock!.release();
  });

  it('deletes a world no tab has open, and keeps one a tab is playing', async () => {
    const storage = new MemoryStorage();
    const made = await createWorld(deps(storage), {
      ...newWorld({ name: '', seed: 'gone', hostiles: true }, '', 0),
      id: TEST_WORLD.id,
    });
    await saveTo(storage, made.sim);
    // The tab playing it holds its lock: the world stays.
    expect(await deleteClosedWorld(storage, TEST_WORLD.id)).toBe(false);
    expect((await storage.inspect(TEST_WORLD.id)).worlds).toBe(1);
    await made.lock.release();
    expect(await deleteClosedWorld(storage, TEST_WORLD.id)).toBe(true);
    expect(await storage.inspect(TEST_WORLD.id)).toEqual({ worlds: 0, players: 0, columns: 0 });
    // Its lock was let go.
    const lock = await lockWorld(TEST_WORLD.id);
    expect(lock).not.toBeNull();
    await lock!.release();
  });
});
