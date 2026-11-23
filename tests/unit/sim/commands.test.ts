import { describe, expect, it } from 'vitest';
import { type InputCommand, NEUTRAL_INPUT } from '../../../src/sim/commands.ts';
import type { SimEvent } from '../../../src/sim/events.ts';
import { InlineColumnSource } from '../../../src/sim/InlineColumnSource.ts';
import type { ColumnSink, ColumnSource } from '../../../src/sim/ports.ts';
import { stateHash } from '../../../src/sim/stateHash.ts';
import { registry } from '../../helpers/registry.ts';
import { createTestSim } from '../../helpers/simHarness.ts';

function setup(worldType: 'default' | 'flat' = 'flat') {
  const harness = createTestSim({ seed: 'cmd', worldType, allowDebug: true });
  const player = harness.sim.addPlayer(1, 2);
  harness.step(60);
  return { ...harness, player };
}

const rejected = (events: SimEvent[]) =>
  events.filter((e) => e.type === 'rejected').map((e) => e.type === 'rejected' && e.reason);

describe('command validation', () => {
  it('rejects non-finite or out-of-range input and stops the player instead of keeping stale keys', () => {
    const { host, player, events, step } = setup();
    const bad: InputCommand[] = [
      { ...NEUTRAL_INPUT, forward: Number.NaN },
      { ...NEUTRAL_INPUT, strafe: 2 },
      { ...NEUTRAL_INPUT, yaw: Number.POSITIVE_INFINITY },
      { ...NEUTRAL_INPUT, pitch: 3 },
      { ...NEUTRAL_INPUT, slot: 8 },
      { ...NEUTRAL_INPUT, slot: 1.5 },
    ];
    host.send({ ...NEUTRAL_INPUT, forward: 1, yaw: 0.5 });
    step();
    events.length = 0;
    for (const command of bad) host.send(command);
    step();
    expect(rejected(events)).toEqual(bad.map(() => 'invalid'));
    expect(player.input.forward).toBe(0);
    expect(player.input.yaw).toBe(0.5);
    expect(Number.isFinite(player.body.x)).toBe(true);
  });

  it('rejects a view with a non-finite radius', () => {
    const { host, events, step } = setup();
    events.length = 0;
    host.send({ type: 'client.view', x: 0, z: 0, radius: Number.NaN });
    step();
    expect(rejected(events)).toEqual(['invalid']);
  });

  it('refuses fills outside the world or too large, and floors fractional corners', () => {
    const { sim, host, events, step } = setup();
    events.length = 0;
    host.send({
      type: 'debug.fill',
      x0: -1e6,
      y0: 300,
      z0: -1e6,
      x1: 1e6,
      y1: 300,
      z1: 1e6,
      state: 'block:stone',
    });
    host.send({
      type: 'debug.fill',
      x0: 0,
      y0: 0,
      z0: 0,
      x1: 100,
      y1: 100,
      z1: 100,
      state: 'block:stone',
    });
    step();
    expect(rejected(events)).toEqual(['outside the world', 'too large']);
    events.length = 0;
    host.send({
      type: 'debug.fill',
      x0: 2.7,
      y0: 70.2,
      z0: 2.9,
      x1: 2.1,
      y1: 70.9,
      z1: 2.2,
      state: 'block:stone',
    });
    step();
    expect(registry.states[sim.world.getBlock(2, 70, 2)]!.key).toBe('block:stone');
    expect(registry.states[sim.world.getBlock(3, 70, 3)]!.key).toBe('block:air');
    // The fill's box (floored corners), then the light it changed around it.
    const changed = events.filter((e) => e.type === 'blocksChanged');
    expect(changed).toHaveLength(2);
    expect(changed[0]).toEqual({
      type: 'blocksChanged',
      x0: 2,
      y0: 70,
      z0: 2,
      x1: 2,
      y1: 70,
      z1: 2,
    });
  });

  it('teleports to the flat surface, not the default terrain height', () => {
    const { host, player, step } = setup('flat');
    host.send({ type: 'debug.teleport', x: 4000.5, y: 'surface', z: 0.5 });
    step();
    expect(player.body.y).toBe(65);
    step(200);
    expect(player.body.y).toBeCloseTo(65, 3);
  });

  it('refuses teleports beyond the world border', () => {
    const { host, player, events, step } = setup();
    events.length = 0;
    host.send({ type: 'debug.teleport', x: 2e6, y: 70, z: 0 });
    step();
    expect(rejected(events)).toEqual(['invalid']);
    expect(Math.abs(player.body.x)).toBeLessThan(100);
  });
});

describe('stamina gate', () => {
  it('refuses real jumps without stamina in shallow water, as on land', () => {
    const { host, player, step } = setup('flat');
    const apex = (water: boolean) => {
      const fill = water ? 'block:fresh_water' : 'block:air';
      host.send({ type: 'debug.fill', x0: -3, y0: 65, z0: -3, x1: 3, y1: 65, z1: 3, state: fill });
      host.send({ type: 'debug.teleport', x: 0.5, y: 65, z: 0.5 });
      step(30);
      host.send({ type: 'debug.setStat', stat: 'stamina', value: 0 });
      // A one-tick tap: a real jump would rise 1.26.
      host.send({ ...NEUTRAL_INPUT, jump: true });
      step();
      host.send({ ...NEUTRAL_INPUT });
      let top = player.body.y;
      for (let i = 0; i < 20; i++) {
        step();
        top = Math.max(top, player.body.y);
      }
      return top - 65;
    };
    expect(apex(false)).toBeLessThan(0.001);
    expect(apex(true)).toBeLessThan(0.3);
  });
});

describe('entities', () => {
  it('gives players unique entity ids and finds them through the spatial hash', () => {
    const { sim, host, player, step } = setup();
    const second = sim.addPlayer(2, 2);
    expect(second.id).not.toBe(player.id);
    expect(sim.nextEntityId).toBe(3);
    expect(sim.entities.get(player.id)).toBe(player);
    const out: number[] = [];
    expect(sim.entitiesNear(player.body.x, player.body.z, 2, out).sort()).toEqual(
      [player.id, second.id].sort(),
    );
    host.send({ type: 'debug.teleport', x: 300.5, y: 'surface', z: 0.5 });
    step();
    expect(sim.entitiesNear(300.5, 0.5, 2, out)).toEqual([player.id]);
    expect(sim.entitiesNear(second.body.x, second.body.z, 2, out)).toEqual([second.id]);
  });
});

describe('state hash', () => {
  it('differs when only a block edit, an input or an entity position differs', () => {
    const a = setup();
    const b = setup();
    expect(stateHash(a.sim)).toBe(stateHash(b.sim));
    a.host.send({
      type: 'debug.fill',
      x0: 5,
      y0: 70,
      z0: 5,
      x1: 5,
      y1: 70,
      z1: 5,
      state: 'block:stone',
    });
    a.step();
    b.step();
    expect(stateHash(a.sim)).not.toBe(stateHash(b.sim));

    const c = setup();
    const d = setup();
    c.host.send({ ...NEUTRAL_INPUT, secondary: true });
    d.host.send({ ...NEUTRAL_INPUT });
    c.step();
    d.step();
    expect(stateHash(c.sim)).not.toBe(stateHash(d.sim));

    const e = setup();
    const f = setup();
    e.host.send({
      type: 'debug.teleport',
      x: e.player.body.x + 3,
      y: 'surface',
      z: e.player.body.z,
    });
    e.step();
    f.step();
    expect(stateHash(e.sim)).not.toBe(stateHash(f.sim));
  });

  it('ignores how sections are stored (uniform or expanded blocks and light)', () => {
    const { sim } = setup();
    const section = sim.world.getColumn(0, 0)!.sections[5]!;
    expect(section.blocks).toBeNull();
    const before = stateHash(sim);
    const stone = registry.defaultState('block:stone');
    sim.world.setBlock(3, 5 * 32 + 3, 3, stone);
    sim.world.setBlock(3, 5 * 32 + 3, 3, registry.air);
    expect(section.blocks).not.toBeNull();
    expect(stateHash(sim)).toBe(before);
    section.setLight(7, 0x30);
    section.setLight(7, section.uniformLight);
    expect(section.light).not.toBeNull();
    expect(stateHash(sim)).toBe(before);
    section.compact();
    expect(section.blocks).toBeNull();
    expect(stateHash(sim)).toBe(before);
  });

  it('does not depend on the order in which generated columns arrive', () => {
    /** Delivers each tick's requests in reverse order, one tick late. */
    class ReversedSource implements ColumnSource {
      readonly inner = new InlineColumnSource(registry);
      private pending: Parameters<ColumnSource['request']>[] = [];
      connect(sink: ColumnSink): void {
        this.inner.connect(sink);
      }
      request(...args: Parameters<ColumnSource['request']>): void {
        this.pending.push(args);
      }
      flush(): void {
        const batch = this.pending.reverse();
        this.pending = [];
        for (const args of batch) this.inner.request(...args);
      }
    }
    const run = (reversed: boolean) => {
      const late = new ReversedSource();
      const source = reversed ? late : new InlineColumnSource(registry);
      const { sim, host, step } = createTestSim({ seed: 'order', source });
      host.send({ type: 'client.view', x: 40, z: -70, radius: 2, detached: true });
      for (let i = 0; i < 200; i++) {
        step();
        late.flush();
      }
      return sim;
    };
    const a = run(false);
    const b = run(true);
    expect(b.world.columns.size).toBe(a.world.columns.size);
    expect(a.world.columns.size).toBeGreaterThan(9);
    expect(stateHash(b)).toBe(stateHash(a));
  });
});

describe('world border', () => {
  it('refuses fills and views beyond the border instead of wrapping onto loaded columns', () => {
    const { sim, host, events, step } = setup();
    const before = sim.world.getBlock(5, 70, 5);
    events.length = 0;
    for (const x of [2 ** 53, 2 ** 32 + 5, 1_000_001]) {
      host.send({
        type: 'debug.fill',
        x0: x,
        y0: 70,
        z0: 5,
        x1: x,
        y1: 70,
        z1: 5,
        state: 'block:stone',
      });
    }
    host.send({ type: 'client.view', x: -16, z: 67_108_880, radius: 2, detached: true });
    step();
    expect(rejected(events)).toEqual([
      'outside the world',
      'outside the world',
      'outside the world',
      'invalid',
    ]);
    expect(sim.world.getBlock(5, 70, 5)).toBe(before);
    expect(sim.world.getColumn(0, 0)!.cz).toBe(0);
  });
});
