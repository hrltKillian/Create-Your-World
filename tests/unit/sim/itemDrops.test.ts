import { describe, expect, it } from 'vitest';
import { DEFAULT_STACK } from '../../../src/content/items.ts';
import type { SimEvent } from '../../../src/sim/events.ts';
import { countItem } from '../../../src/sim/inventory.ts';
import { DROPS, type ItemDropState, spawnDrop } from '../../../src/sim/itemDrops.ts';
import { createTestSim } from '../../helpers/simHarness.ts';

/** A flat world (ground top at y 65) with the player standing at (0.5, 65, 0.5). */
function setup() {
  const harness = createTestSim({ seed: 'drops', worldType: 'flat', allowDebug: true });
  const player = harness.sim.addPlayer(1, 2);
  harness.step(60);
  harness.events.length = 0;
  const drops = () =>
    [...harness.sim.entities.values()].filter((e): e is ItemDropState => e.kind === 'itemDrop');
  return { ...harness, player, drops };
}

const pickups = (events: SimEvent[]) => events.filter((e) => e.type === 'itemPickedUp');

describe('item drops', () => {
  it('fall to the ground and are picked up within the magnet radius only', () => {
    const s = setup();
    const near = spawnDrop(s.sim, { item: 'item:dirt', count: 3 }, 0.5 + 1.5, 67, 0.5);
    const far = spawnDrop(s.sim, { item: 'item:sand', count: 2 }, 0.5, 65, 0.5 + 2.1);
    s.step(30);
    expect(s.sim.entities.has(near.id)).toBe(false);
    expect(countItem(s.player.inventory, 'item:dirt')).toBe(3);
    expect(pickups(s.events)).toEqual([
      { type: 'itemPickedUp', playerId: 1, entityId: near.id, item: 'item:dirt', count: 3 },
    ]);
    expect(far.body.y).toBeCloseTo(65, 3);
    expect(far.body.onGround).toBe(true);
    expect(s.sim.entities.has(far.id)).toBe(true);
  });

  it('wait out the pickup delay of thrown items', () => {
    const s = setup();
    const delay = DROPS.thrownPickupDelayTicks;
    const thrown = spawnDrop(s.sim, { item: 'item:dirt', count: 1 }, 0.5, 65, 0.5, 0, 0, 0, delay);
    s.step(DROPS.thrownPickupDelayTicks - 1);
    expect(s.sim.entities.has(thrown.id)).toBe(true);
    s.step(1);
    expect(s.sim.entities.has(thrown.id)).toBe(false);
    // inv.drop throws one item forward with that delay.
    s.host.send({ type: 'debug.give', item: 'item:torch', count: 3 });
    s.host.send({ type: 'inv.drop', slot: 1, all: false });
    s.step(1);
    expect(s.player.inventory[1]).toEqual({ item: 'item:torch', count: 2 });
    const [drop] = s.drops();
    expect(drop?.item).toBe('item:torch');
    expect(drop?.pickupDelay).toBe(DROPS.thrownPickupDelayTicks - 1);
    expect(drop!.body.z).toBeLessThan(0.5); // thrown north, along the view
  });

  it.each([0, -0.5])(
    'come back to their thrower standing on them after 2 s (pitch %s)',
    (pitch) => {
      const s = setup();
      s.host.send({ type: 'debug.give', item: 'item:torch', count: 3 });
      s.tick(1, { pitch });
      s.host.send({ type: 'inv.drop', slot: 0, all: false });
      s.tick(DROPS.thrownPickupDelayTicks - 1, { pitch });
      expect(s.drops()).toHaveLength(1);
      expect(countItem(s.player.inventory, 'item:torch')).toBe(2);
      s.tick(2, { pitch });
      expect(s.drops()).toEqual([]);
      expect(countItem(s.player.inventory, 'item:torch')).toBe(3);
      expect(pickups(s.events)).toHaveLength(1);
    },
  );

  it('go to anyone standing by once the delay is over, the first in id order', () => {
    const s = setup();
    s.host.send({ type: 'debug.give', item: 'item:torch', count: 3 });
    const other = s.sim.addPlayer(2, 2);
    const b = s.player.body;
    s.sim.teleport(other, b.x, b.y, b.z - 0.5);
    s.host.send({ type: 'inv.drop', slot: 0, all: false });
    s.step(DROPS.thrownPickupDelayTicks - 1);
    expect(s.drops()).toHaveLength(1);
    s.step(2);
    expect(s.drops()).toEqual([]);
    const held =
      countItem(s.player.inventory, 'item:torch') + countItem(other.inventory, 'item:torch');
    expect(held).toBe(3);
  });

  it('merge a throw into a drop lying close by, which then waits for the throw’s delay', () => {
    const s = setup();
    const lying = spawnDrop(s.sim, { item: 'item:dirt', count: 1 }, 3.5, 65, -0.5);
    const thrown = spawnDrop(s.sim, { item: 'item:dirt', count: 1 }, 3.6, 65, -0.5, 0, 0, 0, 1e6);
    s.step(DROPS.mergeEveryTicks);
    expect(s.drops().map((d) => [d.id, d.count])).toEqual([[lying.id, 2]]);
    expect(s.drops()[0]!.pickupDelay).toBeGreaterThan(1000);
    void thrown;
  });

  it('merge every 10 ticks, but never tools', () => {
    const s = setup();
    spawnDrop(s.sim, { item: 'item:dirt', count: 40 }, 10.5, 65, 10.5);
    spawnDrop(s.sim, { item: 'item:dirt', count: 40 }, 10.8, 65, 10.5);
    spawnDrop(s.sim, { item: 'item:flint_pickaxe', count: 1, durability: 60 }, 10.5, 65, 10.7);
    spawnDrop(s.sim, { item: 'item:flint_pickaxe', count: 1, durability: 60 }, 10.6, 65, 10.7);
    s.step(10);
    expect(s.drops().map((d) => [d.item, d.count])).toEqual([
      ['item:dirt', DEFAULT_STACK],
      ['item:dirt', 80 - DEFAULT_STACK],
      ['item:flint_pickaxe', 1],
      ['item:flint_pickaxe', 1],
    ]);
  });

  it('merge unknown items only under the same saved key', () => {
    const s = setup();
    const unknown = (original: string) => ({
      item: s.sim.registry.unknownItem,
      count: 2,
      original,
    });
    spawnDrop(s.sim, unknown('item:relic'), 10.5, 65, 10.5);
    spawnDrop(s.sim, unknown('item:charm'), 10.6, 65, 10.5);
    spawnDrop(s.sim, unknown('item:relic'), 10.7, 65, 10.5);
    s.step(10);
    expect(s.drops().map((d) => [d.original, d.count])).toEqual([
      ['item:relic', 4],
      ['item:charm', 2],
    ]);
  });

  it('despawn after 5 minutes and stay under the cap of 200', () => {
    const s = setup();
    const old = spawnDrop(s.sim, { item: 'item:dirt', count: 1 }, 10.5, 65, 10.5);
    old.age = DROPS.despawnTicks - 2;
    s.step(1);
    expect(s.sim.entities.has(old.id)).toBe(true);
    s.step(1);
    expect(s.sim.entities.has(old.id)).toBe(false);
    const first = spawnDrop(s.sim, { item: 'item:sand', count: 1 }, 12.5, 65, 12.5);
    for (let i = 0; i < DROPS.max; i++)
      spawnDrop(s.sim, { item: 'item:dirt', count: 1 }, 12.5, 65, 14.5);
    expect(s.drops()).toHaveLength(DROPS.max);
    expect(s.sim.entities.has(first.id)).toBe(false);
  });

  it('give fills the inventory and drops the rest at the feet', () => {
    const s = setup();
    const full = DEFAULT_STACK * s.player.inventory.length;
    s.host.send({ type: 'debug.give', item: 'item:dirt', count: full + 4 });
    s.step(1);
    expect(countItem(s.player.inventory, 'item:dirt')).toBe(full);
    expect(s.drops().map((d) => d.count)).toEqual([4]);
  });
});
