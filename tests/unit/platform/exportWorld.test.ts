import { describe, expect, it } from 'vitest';
import { openErrorKey } from '../../../src/app/worlds.ts';
import { exportWorld, importWorld } from '../../../src/platform/exportWorld.ts';
import { InlineColumnSource } from '../../../src/sim/InlineColumnSource.ts';
import { spawnDrop } from '../../../src/sim/itemDrops.ts';
import { MemoryStorage } from '../../../src/sim/MemoryStorage.ts';
import { persistentHash, restoreSim } from '../../../src/sim/persistence.ts';
import type { StoredWorld } from '../../../src/sim/storage.ts';
import { SaveVersionError } from '../../../src/world/codec/migrations.ts';
import { registry } from '../../helpers/registry.ts';
import { saveTo, settle, TEST_WORLD, zlibDeflater } from '../../helpers/save.ts';
import { createTestSim } from '../../helpers/simHarness.ts';

/** gzip, as an export file is written. */
async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The JSON of an export file. */
async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** A saved flat world: edits in two columns (one deflated), a drop and an item in the bag. */
async function savedWorld() {
  const s = createTestSim({ seed: 'export', worldType: 'flat', allowDebug: true });
  s.sim.addPlayer(1, 2);
  settle(s.sim);
  for (let x = 0; x < 16; x += 2) {
    s.host.send({
      type: 'debug.fill',
      x0: x,
      y0: 70,
      z0: 0,
      x1: x,
      y1: 70,
      z1: 15,
      state: 'block:stone',
    });
    s.step();
  }
  s.host.send({
    type: 'debug.fill',
    x0: 40,
    y0: 90,
    z0: 2,
    x1: 40,
    y1: 90,
    z1: 2,
    state: 'block:planks',
  });
  s.host.send({ type: 'debug.give', item: 'item:dirt', count: 12 });
  s.step();
  spawnDrop(s.sim, { item: 'item:sand', count: 3 }, 5.5, 66, 5.5);
  const storage = new MemoryStorage();
  await saveTo(storage, s.sim);
  return { sim: s.sim, storage };
}

/** The records of a stored world under another id, as JSON keeps them (-0 is 0). */
function plain(stored: StoredWorld | undefined, id: string): unknown {
  return JSON.parse(
    JSON.stringify({
      world: { ...stored!.world, id },
      players: stored!.players.map((p) => ({ ...p, worldId: id })),
      columns: stored!.columns.map((c) => ({ ...c, worldId: id, payload: [...c.payload] })),
    }),
  );
}

describe('world export and import', () => {
  it('gives back the same records and the same world, under a new id', async () => {
    const { sim, storage } = await savedWorld();
    const original = (await storage.loadWorld(TEST_WORLD.id))!;
    expect(original.columns.map((c) => c.codec).sort()).toEqual(['deflate-raw', 'raw']);
    const bytes = await exportWorld(storage, TEST_WORLD.id);
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]); // gzip
    const target = new MemoryStorage();
    const world = await importWorld(target, bytes, 'copy');
    expect(world).toEqual({ ...original.world, id: 'copy' });
    expect(plain(await target.loadWorld('copy'), 'copy')).toEqual(plain(original, 'copy'));
    const options = { registry, source: new InlineColumnSource(registry), maxInFlight: 8 };
    const restored = (await restoreSim(target, 'copy', options, zlibDeflater))!;
    expect(persistentHash(restored.sim)).toBe(persistentHash(sim));
  });

  it('replaces a world with the same id, leaving none of its records', async () => {
    const { storage } = await savedWorld();
    const bytes = await exportWorld(storage, TEST_WORLD.id);
    const other = (await savedWorld()).storage;
    await other.write({
      world: { ...(await other.loadWorld(TEST_WORLD.id))!.world, id: 'slot' },
      players: [],
      columns: [{ ...(await other.loadWorld(TEST_WORLD.id))!.columns[0]!, worldId: 'slot', cx: 9 }],
      removed: [],
    });
    await importWorld(other, bytes, 'slot');
    const columns = (await other.loadWorld('slot'))!.columns.map((c) => c.cx);
    expect(columns.sort()).toEqual([0, 1]);
  });

  it('refuses files that are not world exports and worlds from a newer game', async () => {
    const storage = new MemoryStorage();
    await expect(exportWorld(storage, 'missing')).rejects.toThrow(/No world/);
    await expect(importWorld(storage, new Uint8Array([1, 2, 3]), 'x')).rejects.toThrow();
    const notWorld = await gzip(JSON.stringify({ format: 'something else' }));
    await expect(importWorld(storage, notWorld, 'x')).rejects.toThrow(/not a world export/);
    const { storage: saved } = await savedWorld();
    const file = JSON.parse(await gunzip(await exportWorld(saved, TEST_WORLD.id)));
    const newer = await gzip(
      JSON.stringify({ ...file, world: { ...file.world, saveVersion: 99 } }),
    );
    await expect(importWorld(storage, newer, 'x')).rejects.toThrow(SaveVersionError);
    // Without a version, the world is not « from a newer game »: the file is not a world export.
    const versionless = await gzip(
      JSON.stringify({ ...file, world: { ...file.world, saveVersion: undefined } }),
    );
    const error = await importWorld(storage, versionless, 'x').catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(SaveVersionError);
    expect(openErrorKey(error, 'error.import')).toBe('error.import');
    expect(await storage.listWorlds()).toEqual([]);
  });
});
