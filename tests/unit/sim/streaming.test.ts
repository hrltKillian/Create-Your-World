import { describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { buildRegistry } from '../../../src/content/registry.ts';
import { fnv1aU32 } from '../../../src/core/hash.ts';
import type { SimEvent } from '../../../src/sim/events.ts';
import { LocalSimHost } from '../../../src/sim/host.ts';
import { InlineColumnSource } from '../../../src/sim/InlineColumnSource.ts';
import { COLUMN_MESHABLE, Simulation } from '../../../src/sim/Simulation.ts';

const registry = buildRegistry(basePack);

function makeHost(seed = 'stream') {
  const source = new InlineColumnSource(registry);
  const sim = new Simulation({ seed, registry, source, maxInFlight: 8 });
  source.connect((r) => sim.deliver(r));
  return { sim, host: new LocalSimHost(sim) };
}

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
    const meshable = events.filter((e) => e.type === 'columnMeshable').length;
    expect(meshable).toBe(
      [...sim.world.columns.values()].filter((c) => sim.columnState(c.cx, c.cz) === COLUMN_MESHABLE)
        .length,
    );
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
