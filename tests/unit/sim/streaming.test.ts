import { describe, expect, it } from 'vitest';
import { fnv1aU32 } from '../../../src/core/hash.ts';
import { COLUMN_MESHABLE } from '../../../src/sim/ColumnPipeline.ts';
import type { SimEvent } from '../../../src/sim/events.ts';
import type { LocalSimHost } from '../../../src/sim/host.ts';
import type { Simulation } from '../../../src/sim/Simulation.ts';
import { createTestSim } from '../../helpers/simHarness.ts';

const makeHost = (seed = 'stream') => createTestSim({ seed });

function run(host: LocalSimHost, x: number, z: number, radius: number, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    host.send({ type: 'client.view', x, z, radius });
    host.advance(1, events);
  }
  return events;
}

describe('streaming', () => {
  it('loads the generation radius and makes the render radius meshable', () => {
    const { sim, host } = makeHost();
    const events = run(host, 16, 16, 2, 120);
    const loaded = [...sim.world.columns.values()];
    // Generation radius = RD + 2.5 columns.
    let expected = 0;
    for (let dz = -5; dz <= 5; dz++)
      for (let dx = -5; dx <= 5; dx++) if (dx * dx + dz * dz <= 4.5 * 4.5) expected++;
    expect(loaded.length).toBe(expected);
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dz * dz <= 4) expect(sim.columnState(dx, dz)).toBe(COLUMN_MESHABLE);
      }
    }
    // Only columns inside the render distance are shown (meshed).
    const shown = events.filter((e) => e.type === 'columnMeshable');
    for (const e of shown) expect(e.cx * e.cx + e.cz * e.cz).toBeLessThanOrEqual(4);
    expect(shown.length).toBe(13);
  });

  it('integrates at most 2 columns per tick in play', () => {
    const { sim, host } = makeHost();
    run(host, 0, 0, 2, 1);
    expect(sim.world.columns.size).toBeLessThanOrEqual(2);
  });

  it('unloads columns beyond RD + 3 and reports them', () => {
    const { sim, host } = makeHost();
    run(host, 0, 0, 2, 120);
    const events = run(host, 32 * 40, 0, 2, 200);
    expect(events.some((e) => e.type === 'columnUnloaded' && e.cx === 0 && e.cz === 0)).toBe(true);
    expect(sim.world.getColumn(0, 0)).toBeUndefined();
    expect(sim.world.getColumn(40, 0)).toBeDefined();
  });

  it('is deterministic for the same commands', () => {
    const hashWorld = (sim: Simulation) => {
      let h = 0x811c9dc5;
      const keys = [...sim.world.columns.keys()].sort((a, b) => a - b);
      for (const key of keys) {
        const column = sim.world.columns.get(key)!;
        for (let i = 0; i < 1024; i++) h = fnv1aU32(h, column.heightmap[i]!);
      }
      return h;
    };
    const a = makeHost('det');
    const b = makeHost('det');
    run(a.host, 100, -50, 2, 90);
    run(b.host, 100, -50, 2, 90);
    expect(hashWorld(a.sim)).toBe(hashWorld(b.sim));
    expect(a.sim.tick).toBe(90);
  });
});

describe('streaming review fixes', () => {
  const at = (c: number) => c * 32 + 16;
  const allMeshable = (sim: Simulation, cx: number, cz: number, rd: number) => {
    for (let dz = -rd; dz <= rd; dz++) {
      for (let dx = -rd; dx <= rd; dx++) {
        if (dx * dx + dz * dz <= rd * rd && sim.columnState(cx + dx, cz + dz) !== COLUMN_MESHABLE)
          return `${cx + dx},${cz + dz}`;
      }
    }
    return null;
  };

  it('never leaves a column stuck after unloading diagonal neighbours', () => {
    const { sim, host } = makeHost('stuck');
    run(host, at(0), at(0), 3, 300);
    run(host, at(5), at(0), 3, 300);
    run(host, at(4), at(-1), 3, 300);
    expect(allMeshable(sim, 4, -1, 3)).toBeNull();
  });

  it('keeps every column within RD meshable on a random walk with turns', () => {
    const { sim, host } = makeHost('walk');
    let cx = 0;
    let cz = 0;
    for (let step = 0; step < 40; step++) {
      const dir = (step * 7 + (step >> 2)) % 4;
      cx += dir === 0 ? 1 : dir === 1 ? -1 : 0;
      cz += dir === 2 ? 1 : dir === 3 ? -1 : 0;
      run(host, at(cx), at(cz), 3, 60);
    }
    run(host, at(cx), at(cz), 3, 300);
    expect(allMeshable(sim, cx, cz, 3)).toBeNull();
  });

  it('hides meshes beyond RD + 1 when the render distance shrinks, and shows them again', () => {
    const { host } = makeHost('hide');
    run(host, at(0), at(0), 6, 400);
    const hidden = run(host, at(0), at(0), 2, 10).filter((e) => e.type === 'columnHidden');
    expect(hidden.length).toBeGreaterThan(0);
    for (const e of hidden) expect(e.cx * e.cx + e.cz * e.cz).toBeGreaterThan(9);
    // Columns still loaded come back at once; the others are generated again first.
    const shown = run(host, at(0), at(0), 6, 10).filter((e) => e.type === 'columnMeshable');
    expect(shown.length).toBeGreaterThan(0);
    for (const e of shown) expect(e.cx * e.cx + e.cz * e.cz).toBeLessThanOrEqual(36);
  });
});
