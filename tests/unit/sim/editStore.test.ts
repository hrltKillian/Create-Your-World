import { describe, expect, it } from 'vitest';
import { COLUMN_LIT } from '../../../src/sim/ColumnPipeline.ts';
import { deserializeEditStore, EditStore, serializeEditStore } from '../../../src/sim/editStore.ts';
import { stateHash } from '../../../src/sim/stateHash.ts';
import { WorldJobs } from '../../../src/workers/worldJobs.ts';
import { Column } from '../../../src/world/Column.ts';
import { columnKey, SECTION_VOLUME } from '../../../src/world/coords.ts';
import { FULL_SKY } from '../../../src/world/light.ts';
import { jobTransfers } from '../../../src/world/protocol.ts';
import { block, lightErrors, STONE, sky } from '../../helpers/lightWorld.ts';
import { registry } from '../../helpers/registry.ts';
import { createTestSim } from '../../helpers/simHarness.ts';

const AIR = registry.air;
const TORCH = registry.defaultState('block:torch');

describe('edit store', () => {
  it('keeps only the persisted sections of a column, and hands out copies', () => {
    const column = new Column(3, -2, AIR);
    column.sections[2]!.setBlock(5, STONE);
    column.sections[5]!.fill(STONE);
    column.sections[6]!.fill(STONE); // not edited: not kept
    const store = new EditStore();
    store.keep(1, new Column(0, 0, AIR)); // nothing persisted
    expect(store.size).toBe(0);
    column.persisted = (1 << 2) | (1 << 5);
    store.keep(columnKey(3, -2), column);
    const kept = store.get(columnKey(3, -2))!;
    expect(kept.map((s) => s.sy)).toEqual([2, 5]);
    expect(kept[1]).toEqual({ sy: 5, uniformBlock: STONE, blocks: null });
    const copy = store.copies(columnKey(3, -2))!;
    expect(copy).toEqual(kept);
    copy[0]!.blocks![5] = AIR;
    expect(kept[0]!.blocks![5]).toBe(STONE);
    store.forget(columnKey(3, -2));
    expect(store.size).toBe(0);
  });

  it('round-trips through a structured clone and repairs malformed saves', () => {
    const column = new Column(-7, 11, AIR);
    column.sections[0]!.setBlock(100, STONE);
    column.sections[7]!.fill(TORCH);
    column.persisted = 1 | (1 << 7);
    const store = new EditStore();
    store.keep(columnKey(-7, 11), column);
    const record = structuredClone(serializeEditStore(store));
    expect(serializeEditStore(deserializeEditStore(record))).toEqual(record);
    expect(deserializeEditStore(undefined).size).toBe(0);
    expect(deserializeEditStore({ columns: 'none' }).size).toBe(0);
    const repaired = deserializeEditStore({
      columns: [
        { cx: 1.5, cz: 0, sections: [{ sy: 1, uniformBlock: STONE, blocks: null }] },
        { cx: 5e6, cz: 0, sections: [{ sy: 1, uniformBlock: STONE, blocks: null }] },
        { cx: 0, cz: 0, sections: [{ sy: 1, uniformBlock: STONE, blocks: new Uint16Array(3) }] },
        null,
        {
          cx: 2,
          cz: 3,
          sections: [
            { sy: 4, uniformBlock: STONE, blocks: new Uint16Array(SECTION_VOLUME) },
            { sy: 8, uniformBlock: STONE, blocks: null },
            { sy: 1, uniformBlock: -1, blocks: null },
            { sy: 1, uniformBlock: STONE, blocks: null },
            { sy: 1, uniformBlock: AIR, blocks: null },
          ],
        },
      ],
    });
    expect([...repaired.keys()]).toEqual([columnKey(2, 3)]);
    expect(repaired.get(columnKey(2, 3))!.map((s) => [s.sy, s.uniformBlock])).toEqual([
      [1, STONE],
      [4, STONE],
    ]);
  });

  it('is laid over the generated column before its light (worker job)', () => {
    const jobs = new WorldJobs(registry);
    // Section 2 (y 64–95) of the flat world saved empty: the grass layer at y 64 was dug out.
    const job = {
      kind: 'gen',
      seed: 'saved',
      worldType: 'flat',
      cx: 0,
      cz: 0,
      saved: [{ sy: 2, uniformBlock: AIR, blocks: null }],
    } as const;
    expect(jobTransfers(job)).toEqual([]);
    const result = jobs.gen(job);
    expect(result.persisted).toBe(1 << 2);
    expect(result.heightmap[0]).toBe(64);
    expect(result.sections[2]!.uniformBlock).toBe(AIR);
    expect(result.sections[2]!.uniformLight).toBe(FULL_SKY);
    const blocks = new Uint16Array(SECTION_VOLUME);
    expect(jobTransfers({ ...job, saved: [{ sy: 2, uniformBlock: AIR, blocks }] })).toEqual([
      blocks.buffer,
    ]);
  });
});

describe('edits survive unloading', () => {
  /** Centre block coordinate of column c. */
  const at = (c: number) => c * 32 + 16;

  function flatSim(seed: string) {
    const s = createTestSim({ seed, worldType: 'flat', allowDebug: true });
    s.sim.addPlayer(1, 2);
    s.step(60);
    const fill = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => ({
      with: (state: string) => {
        s.host.send({ type: 'debug.fill', x0, y0, z0, x1, y1, z1, state });
        s.step();
      },
    });
    /** Moves the player (and its view: radius 2, unloaded beyond 5.5 columns) for 100 ticks. */
    const goTo = (cx: number) => {
      s.host.send({ type: 'debug.teleport', x: at(cx), y: 'surface', z: at(0) });
      s.step(100);
    };
    return { ...s, fill, goTo };
  }

  it('keeps a torch on a column border when its column unloads and comes back', () => {
    const s = flatSim('edit-torch');
    const world = s.sim.world;
    s.fill(31, 65, 16, 31, 65, 16).with('block:torch');
    expect(block(world, 32, 65, 16)).toBe(13);
    // Column 0 unloads, column 1 stays with the torch light it got from column 0.
    s.goTo(6);
    expect(world.getColumn(0, 0)).toBeUndefined();
    expect(s.sim.edits.get(columnKey(0, 0))).toHaveLength(1);
    expect(block(world, 32, 65, 16)).toBe(13);
    s.goTo(0);
    expect(s.sim.columnState(0, 0)).toBeGreaterThanOrEqual(COLUMN_LIT);
    expect(world.getColumn(0, 0)!.persisted).toBe(1 << 2);
    expect(s.sim.edits.size).toBe(0);
    expect(world.getBlock(31, 65, 16)).toBe(TORCH);
    expect(block(world, 31, 65, 16)).toBe(14);
    expect(lightErrors(world, 0, -16)).toEqual([]);
  });

  it('keeps a dug shaft and tunnel across a border open, with the same sky light', () => {
    const s = flatSim('edit-tunnel');
    const world = s.sim.world;
    // A shaft at x 40 (column 1) from the grass down to y 50, then a tunnel west to x 20 (column 0).
    s.fill(40, 50, 16, 40, 64, 16).with('block:air');
    s.fill(20, 50, 16, 40, 51, 16).with('block:air');
    expect(sky(world, 40, 50, 16)).toBe(15);
    expect(sky(world, 31, 50, 16)).toBe(6);
    // Column 1 unloads, column 0 stays with the sky light of the tunnel.
    s.goTo(-5);
    expect(world.getColumn(1, 0)).toBeUndefined();
    expect(sky(world, 31, 50, 16)).toBe(6);
    s.goTo(0);
    expect(s.sim.columnState(1, 0)).toBeGreaterThanOrEqual(COLUMN_LIT);
    expect(world.getBlock(40, 60, 16)).toBe(AIR);
    expect(world.getBlock(36, 51, 16)).toBe(AIR);
    expect(world.getColumn(1, 0)!.heightmap[8 | (16 << 5)]).toBe(50);
    expect(sky(world, 40, 50, 16)).toBe(15);
    expect(sky(world, 31, 50, 16)).toBe(6);
    expect(lightErrors(world, 0, -16)).toEqual([]);
  });

  it('hashes the saved sections of the unloaded columns', () => {
    const edited = flatSim('edit-hash');
    const plain = flatSim('edit-hash');
    edited.fill(16, 70, 16, 16, 70, 16).with('block:stone');
    plain.fill(16, 70, 16, 16, 70, 16).with('block:air'); // already air: no edit
    edited.goTo(40);
    plain.goTo(40);
    expect(edited.sim.world.getColumn(0, 0)).toBeUndefined();
    expect(plain.sim.edits.size).toBe(0);
    expect(stateHash(edited.sim)).not.toBe(stateHash(plain.sim));
    // Nothing else differs: the same saved sections give the same hash.
    const key = columnKey(0, 0);
    plain.sim.edits.put(key, edited.sim.edits.copies(key)!);
    expect(stateHash(plain.sim)).toBe(stateHash(edited.sim));
  });
});
