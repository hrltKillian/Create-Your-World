import { describe, expect, it } from 'vitest';
import { type Command, NEUTRAL_INPUT } from '../../../src/sim/commands.ts';
import type { SimEvent } from '../../../src/sim/events.ts';
import { createTestSim } from '../../helpers/simHarness.ts';

function setup(allowDebug = true) {
  const harness = createTestSim({ seed: 'inv', worldType: 'flat', allowDebug, serialize: true });
  const player = harness.sim.addPlayer(1, 2);
  harness.step(30);
  harness.events.length = 0;
  const send = (...commands: Command[]) => {
    harness.events.length = 0;
    for (const command of commands) harness.host.send(command);
    harness.step(1);
    return harness.events;
  };
  return { ...harness, player, send };
}

const rejected = (events: SimEvent[]) =>
  events.filter((e) => e.type === 'rejected').map((e) => e.type === 'rejected' && e.reason);

describe('inventory commands', () => {
  it('throws one item or a whole stack through JSON, announcing each change', () => {
    const s = setup();
    s.send({ type: 'debug.give', item: 'item:dirt', count: 10 });
    const events = s.send(
      { type: 'inv.drop', slot: 0, all: false },
      { type: 'inv.drop', slot: 0, all: true },
    );
    expect(events.filter((e) => e.type === 'inventoryChanged')).toHaveLength(2);
    expect(s.player.inventory[0]).toBeNull();
    const drops = [...s.sim.entities.values()].filter((e) => e.kind === 'itemDrop');
    expect(drops.map((d) => d.kind === 'itemDrop' && d.count)).toEqual([1, 9]);
  });

  it('rejects malformed slots, slots past the inventory and empty ones', () => {
    const s = setup();
    s.send({ type: 'debug.give', item: 'item:dirt', count: 1 });
    const bad: Command[] = [
      { type: 'inv.drop', slot: -1, all: true },
      { type: 'inv.drop', slot: s.player.inventory.length, all: true },
      { type: 'inv.drop', slot: 0.5, all: true },
      { type: 'inv.drop', slot: Number.NaN, all: true },
      { type: 'inv.drop', slot: 0, all: 'yes' as unknown as boolean },
    ];
    expect(rejected(s.send(...bad))).toEqual(bad.map(() => 'invalid'));
    expect(rejected(s.send({ type: 'inv.drop', slot: 7, all: false }))).toEqual([
      'nothing to move',
    ]);
    expect(s.player.inventory[0]).toEqual({ item: 'item:dirt', count: 1 });
  });

  it('gives known items with fresh durability, only in debug worlds', () => {
    const s = setup();
    expect(
      rejected(
        s.send(
          { type: 'debug.give', item: 'item:nope', count: 1 },
          { type: 'debug.give', item: 'item:dirt', count: 0 },
          { type: 'debug.give', item: 'item:dirt', count: 1.5 },
        ),
      ),
    ).toEqual(['unknown item', 'invalid', 'invalid']);
    s.send({ type: 'debug.give', item: 'item:flint_hatchet', count: 1 });
    expect(s.player.inventory[0]).toEqual({ item: 'item:flint_hatchet', count: 1, durability: 60 });
    const locked = setup(false);
    expect(rejected(locked.send({ type: 'debug.give', item: 'item:dirt', count: 1 }))).toEqual([
      'debug disabled',
    ]);
  });

  it('rejects malformed client targets', () => {
    const s = setup();
    const targets = [
      { x: 0.5, y: 64, z: 0, face: 2 },
      { x: 0, y: 64, z: 0, face: 6 },
      { x: 0, y: Number.NaN, z: 0, face: 2 },
      { x: 2e6, y: 64, z: 0, face: 2 },
    ];
    const events = s.send(...targets.map((target) => ({ ...NEUTRAL_INPUT, target })));
    expect(rejected(events)).toEqual(targets.map(() => 'invalid'));
  });
});
