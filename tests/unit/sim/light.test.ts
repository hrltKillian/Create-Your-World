import { describe, expect, it } from 'vitest';
import { COLUMN_GENERATED, COLUMN_LIT, ColumnPipeline } from '../../../src/sim/ColumnPipeline.ts';
import { EditStore } from '../../../src/sim/editStore.ts';
import type { SimEvent } from '../../../src/sim/events.ts';
import { InlineColumnSource } from '../../../src/sim/InlineColumnSource.ts';
import { LightEngine } from '../../../src/world/light/LightEngine.ts';
import { VoxelWorld } from '../../../src/world/VoxelWorld.ts';
import { block } from '../../helpers/lightWorld.ts';
import { registry } from '../../helpers/registry.ts';
import { createTestSim } from '../../helpers/simHarness.ts';

type Changed = Extract<SimEvent, { type: 'blocksChanged' }>;

describe('light in the simulation', () => {
  it('remeshes the light an edit on a column border changes, deep into the neighbour column', () => {
    const s = createTestSim({ seed: 'light-edit', worldType: 'flat', allowDebug: true });
    s.sim.addPlayer(1, 2);
    s.step(60);
    const fill = (state: string) => {
      s.events.length = 0;
      s.host.send({ type: 'debug.fill', x0: 31, y0: 65, z0: 5, x1: 31, y1: 65, z1: 5, state });
      s.step();
      return s.events.filter((e): e is Changed => e.type === 'blocksChanged');
    };
    const placed = fill('block:torch');
    expect(block(s.sim.world, 31, 65, 5)).toBe(14);
    expect(block(s.sim.world, 39, 65, 5)).toBe(6);
    // The cell itself (its remesh reaches x 32 only), then every cell the torch lit: up to 13
    // blocks away, over the grass, so sections of column (1, 0) well past the border.
    expect(placed).toHaveLength(2);
    expect(placed[1]).toEqual({
      type: 'blocksChanged',
      x0: 18,
      y0: 65,
      z0: -8,
      x1: 44,
      y1: 78,
      z1: 18,
    });
    const removed = fill('block:air');
    expect(block(s.sim.world, 39, 65, 5)).toBe(0);
    expect(removed[1]?.x1).toBe(44);
  });

  it('promotes a column to LIT only when no light entry waits in it or around it', () => {
    const world = new VoxelWorld(registry.air, registry.unknownBlock);
    const light = new LightEngine(registry.tables);
    const source = new InlineColumnSource(registry);
    const spec = { seed: 'light-lit', worldType: 'default' } as const;
    const edits = new EditStore();
    const pipeline = new ColumnPipeline(world, registry.air, light, edits, source, spec, 1000);
    source.connect({ deliver: (r) => pipeline.deliver(r), requestFailed: () => {} });
    const out: SimEvent[] = [];
    pipeline.setView(1, 16, 16, 2);
    pipeline.stream(out);
    pipeline.integrate(1000);
    expect(light.seamBacklog()).toBeGreaterThan(0);
    pipeline.promote(out);
    let blocked = 0;
    let stitched = 0;
    for (const { cx, cz } of world.columns.values()) {
      if (!light.stitched(cx, cz)) {
        expect(pipeline.state(cx, cz)).toBe(COLUMN_GENERATED);
        continue;
      }
      stitched++;
      if (light.settled(cx, cz)) continue;
      expect(pipeline.state(cx, cz)).toBe(COLUMN_GENERATED);
      blocked++;
    }
    expect(blocked).toBeGreaterThan(0);
    light.stitch(Number.POSITIVE_INFINITY);
    pipeline.promote(out);
    let lit = 0;
    for (const { cx, cz } of world.columns.values())
      if (pipeline.state(cx, cz) >= COLUMN_LIT) lit++;
    expect(lit).toBe(stitched);
  });
});
