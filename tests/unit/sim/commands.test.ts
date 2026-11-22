import { describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { buildRegistry } from '../../../src/content/registry.ts';
import { type InputCommand, NEUTRAL_INPUT } from '../../../src/sim/commands.ts';
import type { SimEvent } from '../../../src/sim/events.ts';
import { LocalSimHost } from '../../../src/sim/host.ts';
import { InlineColumnSource } from '../../../src/sim/InlineColumnSource.ts';
import { Simulation } from '../../../src/sim/Simulation.ts';
import { stateHash } from '../../../src/sim/stateHash.ts';

const registry = buildRegistry(basePack);

function setup(worldType: 'default' | 'flat' = 'flat') {
  const source = new InlineColumnSource(registry);
  const sim = new Simulation({
    seed: 'cmd',
    worldType,
    registry,
    source,
    maxInFlight: 8,
    allowDebug: true,
  });
  source.connect((r) => sim.deliver(r));
  const player = sim.addPlayer(1, 2);
  const host = new LocalSimHost(sim, 1);
  const events: SimEvent[] = [];
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) host.advance(1, events);
  };
  step(60);
  return { sim, host, player, events, step };
}

const rejected = (events: SimEvent[]) =>
  events.filter((e) => e.type === 'rejected').map((e) => e.type === 'rejected' && e.reason);

describe('command validation', () => {
  it('rejects non-finite or out-of-range input and keeps the previous input', () => {
    const { host, player, events, step } = setup();
    const bad: InputCommand[] = [
      { ...NEUTRAL_INPUT, forward: Number.NaN },
      { ...NEUTRAL_INPUT, strafe: 2 },
      { ...NEUTRAL_INPUT, yaw: Number.POSITIVE_INFINITY },
      { ...NEUTRAL_INPUT, pitch: 3 },
      { ...NEUTRAL_INPUT, slot: 8 },
      { ...NEUTRAL_INPUT, slot: 1.5 },
    ];
    host.send({ ...NEUTRAL_INPUT, forward: 1 });
    step();
    events.length = 0;
    for (const command of bad) host.send(command);
    step();
    expect(rejected(events)).toEqual(bad.map(() => 'invalid'));
    expect(player.input.forward).toBe(1);
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
    expect(events.filter((e) => e.type === 'blocksChanged')).toHaveLength(1);
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
  it('changes with a block edit, a new input and a moved entity, and ignores storage form', () => {
    const { sim, host, step } = setup();
    const base = stateHash(sim);
    host.send({
      type: 'debug.fill',
      x0: 5,
      y0: 70,
      z0: 5,
      x1: 5,
      y1: 70,
      z1: 5,
      state: 'block:stone',
    });
    step();
    const edited = stateHash(sim);
    expect(edited).not.toBe(base);
    // Expanding then compacting a section's storage does not change the hash.
    const section = sim.world.getColumn(0, 0)!.sections[2]!;
    section.compact();
    expect(stateHash(sim)).toBe(edited);
    host.send({ ...NEUTRAL_INPUT, secondary: true });
    step();
    const withInput = stateHash(sim);
    host.send({ ...NEUTRAL_INPUT });
    step();
    expect(stateHash(sim)).not.toBe(withInput);
  });
});
