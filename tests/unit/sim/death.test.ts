import { describe, expect, it } from 'vitest';
import type { GraveEntity } from '../../../src/sim/blockEntities.ts';
import { ticksOf } from '../../../src/sim/clock.ts';
import type { Inventory } from '../../../src/sim/inventory.ts';
import { spawnDrop } from '../../../src/sim/itemDrops.ts';
import { MemoryStorage } from '../../../src/sim/MemoryStorage.ts';
import { persistentHash } from '../../../src/sim/persistence.ts';
import type { PlayerState } from '../../../src/sim/player.ts';
import { blockEntityRecord, playerRecord, readBlockEntity } from '../../../src/sim/saveRecords.ts';
import { cellKey } from '../../../src/world/coords.ts';
import { registry } from '../../helpers/registry.ts';
import { restoreFrom, saveTo, settle } from '../../helpers/save.ts';
import { eventsOf, playerTestSim } from '../../helpers/simHarness.ts';

/*
 * Death and respawn (docs « Mort »): everything carried goes into an Abandoned Pack, nothing is
 * lost or duplicated, the grave is recorded and saved, and the player comes back with the
 * balance's respawn gauges and effects.
 */

const b = registry.pack.balance;
const FEET = { x: 0, y: 65, z: 0 };

/** Item counts by key over slot arrays. */
function totals(...lists: readonly Inventory[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const list of lists)
    for (const stack of list) if (stack) out[stack.item] = (out[stack.item] ?? 0) + stack.count;
  return out;
}

/** The item keys of slots (null for an empty one). */
const keysOf = (slots: Inventory) => slots.map((stack) => stack?.item ?? null);

/** Everything a player carries, the craft queue's reserved ingredients included. */
const carried = (p: PlayerState) =>
  totals(p.inventory, p.equipment, ...p.craft.map((entry) => entry.reserved));

const packAt = (s: ReturnType<typeof playerTestSim>, x: number, y: number, z: number) =>
  s.sim.blockEntities.get(cellKey(x, y, z)) as GraveEntity | undefined;

/** A player with a full kit: tools, worn gear, stacks and a craft under way. */
function equipped(seed: string) {
  const s = playerTestSim({ seed });
  s.give('item:flint_pickaxe');
  s.give('item:fur_coat');
  s.give('item:dirt', 70);
  s.give('item:plant_fiber', 10);
  s.give('item:berries', 4);
  s.send({ type: 'equip.move', from: 1 });
  s.player.inventory[0]!.durability = 17;
  s.send({ type: 'craft.enqueue', recipe: 'recipe:cord', count: 2 });
  return s;
}

describe('death', () => {
  it('leaves everything carried in an Abandoned Pack, nothing lost or duplicated', () => {
    const s = equipped('death');
    expect(s.player.craft).toHaveLength(1);
    const before = carried(s.player);
    const events = s.send({ type: 'debug.setStat', stat: 'health', value: 0 });
    expect(carried(s.player)).toEqual({});
    expect(s.player.craft).toEqual([]);
    expect(s.block(FEET.x, FEET.y, FEET.z)).toBe('block:abandoned_pack');
    const pack = packAt(s, FEET.x, FEET.y, FEET.z)!;
    expect(totals(pack.slots, pack.worn)).toEqual(before);
    // Worn and used stacks keep their uses; the worn ones stay apart, in their slots.
    expect(pack.slots).toContainEqual({ item: 'item:flint_pickaxe', count: 1, durability: 17 });
    expect(keysOf(pack.worn)).toEqual([null, null, 'item:fur_coat', null, null]);
    expect(totals(pack.slots)['item:fur_coat']).toBeUndefined();
    expect(s.player.graves).toEqual([FEET]);
    expect(s.player.survival.dead).toBe(true);
    expect(s.player.survival.packLeft).toBe(true);
    expect(eventsOf(events, 'died')).toEqual([
      { type: 'died', playerId: 1, cause: '', ...FEET, pack: true },
    ]);
    // Nothing on the ground.
    expect([...s.sim.entities.values()].filter((e) => e.kind === 'itemDrop')).toEqual([]);
  });

  it('tells the cause, freezes the body and picks nothing up until the respawn', () => {
    const s = playerTestSim({ seed: 'death-fall' });
    s.give('item:dirt', 3);
    s.send({ type: 'debug.teleport', x: 0.5, y: 120, z: 0.5 });
    s.events.length = 0;
    s.step(120);
    expect(eventsOf(s.events, 'died')).toMatchObject([{ cause: 'fall', ...FEET }]);
    const { x, z } = s.player.body;
    s.tick(30, { forward: 1, jump: true });
    expect(s.player.body.x).toBe(x);
    expect(s.player.body.z).toBe(z);
    // A drop at the dead player's feet stays there.
    spawnDrop(s.sim, { item: 'item:stick', count: 2 }, x, s.player.body.y + 0.5, z);
    s.step(40);
    expect([...s.sim.entities.values()].filter((e) => e.kind === 'itemDrop')).toHaveLength(1);
    expect(s.player.inventory.every((stack) => stack === null)).toBe(true);
  });

  it('comes back at the spawn with the respawn gauges, Weakened and untargeted', () => {
    const s = equipped('respawn');
    s.send({ type: 'debug.teleport', x: 6.5, y: 65, z: 6.5 });
    s.send({ type: 'debug.setStat', stat: 'health', value: 0 });
    expect(eventsOf(s.send({ type: 'debug.setStat', stat: 'health', value: 0 }), 'died')).toEqual(
      [],
    );
    const events = s.send({ type: 'player.respawn' });
    const r = b.respawn;
    const { x, y, z } = s.sim.spawn;
    expect(eventsOf(events, 'respawned')).toEqual([{ type: 'respawned', playerId: 1, x, y, z }]);
    const survival = s.player.survival;
    expect(survival.dead).toBe(false);
    expect(survival.health).toBeCloseTo(r.health, 1);
    expect(survival.hunger).toBeCloseTo(r.hunger, 1);
    expect(survival.thirst).toBeCloseTo(r.thirst, 1);
    expect(survival.effects).toEqual([
      { key: 'weakened', ticks: ticksOf(r.weakenedSec) - 1 },
      { key: 'untargeted', ticks: ticksOf(r.untargetedSec) - 1 },
    ]);
    expect(eventsOf(s.send({ type: 'player.respawn' }), 'rejected')).toMatchObject([
      { command: 'player.respawn', reason: 'alive' },
    ]);
  });

  it('comes back at the bedroll slept on last', () => {
    const s = playerTestSim({ seed: 'respawn-bed' });
    s.player.respawn = { x: 5, y: 65, z: -4 };
    s.send({ type: 'debug.setStat', stat: 'health', value: 0 });
    s.send({ type: 'player.respawn' });
    expect(s.player.body).toMatchObject({ x: 5.5, y: 65, z: -3.5 });
  });

  it('gives the pack back on secondary, what fits, and the emptied pack goes with its marker', () => {
    const s = equipped('recover');
    const before = carried(s.player);
    s.send({ type: 'debug.setStat', stat: 'health', value: 0 });
    s.send({ type: 'player.respawn' });
    s.send({ type: 'debug.teleport', x: 0.5, y: 65, z: 2.5 });
    // A full bag first: only the matching stacks top up.
    s.give('item:stone', 31 * 50);
    s.give('item:dirt', 20);
    const target = { target: { ...FEET, face: 4 } };
    s.tick(1, { ...target, secondary: true });
    s.tick(1);
    const pack = packAt(s, FEET.x, FEET.y, FEET.z)!;
    expect(pack).toBeDefined();
    expect(s.player.equipment[2]?.item).toBe('item:fur_coat');
    expect(s.player.graves).toEqual([FEET]);
    // Room again: the rest comes back, the pack and its marker go.
    for (let slot = 0; slot < 32; slot++)
      if (s.player.inventory[slot]?.item === 'item:stone') s.player.inventory[slot] = null;
    s.tick(1, { ...target, secondary: true });
    s.tick(1);
    expect(packAt(s, FEET.x, FEET.y, FEET.z)).toBeUndefined();
    expect(s.block(FEET.x, FEET.y, FEET.z)).toBe('block:air');
    expect(s.player.graves).toEqual([]);
    const back = carried(s.player);
    expect(back).toEqual({ ...before, 'item:dirt': before['item:dirt']! + 20 });
  });

  it('puts the worn items back on, never a spare from the bag in their place', () => {
    const s = playerTestSim({ seed: 'recover-worn' });
    // A spare body piece in the bag, before the coat in the pack's order.
    s.give('item:leather_tunic');
    s.give('item:fur_coat');
    s.send({ type: 'equip.move', from: 1 });
    s.give('item:waxed_boots');
    expect(s.player.equipment[2]?.item).toBe('item:fur_coat');
    s.send({ type: 'debug.setStat', stat: 'health', value: 0 });
    s.send({ type: 'player.respawn' });
    s.send({ type: 'debug.teleport', x: 0.5, y: 65, z: 2.5 });
    // The coat goes back on; the bag's spare tunic and the boots, never worn, go to the bag.
    s.tick(1, { target: { ...FEET, face: 4 }, secondary: true });
    s.tick(1);
    expect(packAt(s, FEET.x, FEET.y, FEET.z)).toBeUndefined();
    expect(keysOf(s.player.equipment)).toEqual([null, null, 'item:fur_coat', null, null]);
    const bag = totals(s.player.inventory);
    expect(bag).toEqual({ 'item:leather_tunic': 1, 'item:waxed_boots': 1 });
  });

  it('sends a worn item whose slot is taken again to the bag', () => {
    const s = playerTestSim({ seed: 'recover-taken' });
    s.give('item:fur_coat');
    s.send({ type: 'equip.move', from: 0 });
    s.send({ type: 'debug.setStat', stat: 'health', value: 0 });
    s.send({ type: 'player.respawn' });
    s.send({ type: 'debug.teleport', x: 0.5, y: 65, z: 2.5 });
    s.give('item:leather_tunic');
    s.send({ type: 'equip.move', from: 0 });
    s.tick(1, { target: { ...FEET, face: 4 }, secondary: true });
    s.tick(1);
    expect(keysOf(s.player.equipment)).toEqual([null, null, 'item:leather_tunic', null, null]);
    expect(totals(s.player.inventory)).toEqual({ 'item:fur_coat': 1 });
    expect(packAt(s, FEET.x, FEET.y, FEET.z)).toBeUndefined();
  });

  it('spills a pack filled over, worn items included, and forgets its marker', () => {
    const s = playerTestSim({ seed: 'pack-filled' });
    s.give('item:fur_coat');
    s.send({ type: 'equip.move', from: 0 });
    s.give('item:dirt', 4);
    s.send({ type: 'debug.setStat', stat: 'health', value: 0 });
    expect(s.player.graves).toEqual([FEET]);
    s.fill(FEET.x, FEET.y, FEET.z, FEET.x, FEET.y, FEET.z, 'block:air');
    expect(packAt(s, FEET.x, FEET.y, FEET.z)).toBeUndefined();
    expect(s.player.graves).toEqual([]);
    const lying = [...s.sim.entities.values()].filter((e) => e.kind === 'itemDrop');
    expect(lying.map((drop) => drop.item).sort()).toEqual(['item:dirt', 'item:fur_coat']);
  });

  it('says no pack was left when the player carried nothing', () => {
    const s = playerTestSim({ seed: 'death-empty' });
    const events = s.send({ type: 'debug.setStat', stat: 'health', value: 0 });
    expect(eventsOf(events, 'died')).toEqual([
      { type: 'died', playerId: 1, cause: '', ...FEET, pack: false },
    ]);
    expect(s.player.graves).toEqual([]);
    expect(s.block(FEET.x, FEET.y, FEET.z)).toBe('block:air');
  });

  it('remembers that the last death left no pack, though an older one waits', () => {
    const s = playerTestSim({ seed: 'death-older-pack' });
    s.give('item:dirt', 5);
    s.send({ type: 'debug.setStat', stat: 'health', value: 0 });
    expect(s.player.survival.packLeft).toBe(true);
    s.send({ type: 'player.respawn' });
    expect(s.player.survival.packLeft).toBe(false);
    s.send({ type: 'debug.setStat', stat: 'health', value: 0 });
    expect(s.player.graves).toEqual([FEET]);
    expect(s.player.survival.packLeft).toBe(false);
  });

  it('leaves the pack next to a doorway it died in, never up through the rock', () => {
    const s = playerTestSim({ seed: 'death-doorway' });
    s.fill(-3, 65, -3, 3, 90, 3, 'block:stone');
    s.fill(0, 65, -3, 0, 66, 3, 'block:air');
    s.put(0, 65, 0, 'block:gate[facing4=s,open=1,half=lower]');
    s.put(0, 66, 0, 'block:gate[facing4=s,open=1,half=upper]');
    s.give('item:berries', 5);
    s.send({ type: 'debug.setStat', stat: 'health', value: 0 });
    expect(s.player.graves).toHaveLength(1);
    const [grave] = s.player.graves;
    expect(grave).toMatchObject({ x: 0, y: 65 });
    expect(Math.abs(grave!.z)).toBe(1);
    expect(totals(packAt(s, grave!.x, grave!.y, grave!.z)!.slots)).toEqual({ 'item:berries': 5 });
  });

  it('comes back beside a shaft dug at the spawn, on the ground, and lives', () => {
    const s = playerTestSim({ seed: 'respawn-shaft' });
    const { x, y, z } = s.sim.spawn;
    s.fill(Math.floor(x), 40, Math.floor(z), Math.floor(x), y - 1, Math.floor(z), 'block:air');
    for (let death = 0; death < 2; death++) {
      s.send({ type: 'debug.setStat', stat: 'health', value: 0 });
      const [back] = eventsOf(s.send({ type: 'player.respawn' }), 'respawned');
      expect(back!.y).toBe(y);
      expect(Math.floor(back!.x) !== Math.floor(x) || Math.floor(back!.z) !== Math.floor(z)).toBe(
        true,
      );
      s.step(40);
      expect(s.player.survival.dead).toBe(false);
      expect(s.player.body.y).toBe(y);
    }
  });

  it('comes back on the floor of a pit dug all around the spawn, unhurt', () => {
    const s = playerTestSim({ seed: 'respawn-pit' });
    const { x, y, z } = s.sim.spawn;
    const [bx, bz] = [Math.floor(x), Math.floor(z)];
    s.fill(bx - 6, 50, bz - 6, bx + 6, y - 1, bz + 6, 'block:air');
    s.send({ type: 'debug.setStat', stat: 'health', value: 0 });
    expect(eventsOf(s.send({ type: 'player.respawn' }), 'respawned')).toMatchObject([
      { x, y: 50, z },
    ]);
    s.step(40);
    expect(s.player.survival.health).toBeCloseTo(b.respawn.health, 0);
  });

  it('stacks a second pack above the first when dying on the same spot', () => {
    const s = playerTestSim({ seed: 'two-deaths' });
    s.give('item:dirt', 5);
    s.send({ type: 'debug.setStat', stat: 'health', value: 0 });
    s.send({ type: 'player.respawn' });
    s.send({ type: 'debug.teleport', x: 0.5, y: 65, z: 0.5 });
    s.give('item:stick', 2);
    s.send({ type: 'debug.setStat', stat: 'health', value: 0 });
    expect(s.player.graves).toEqual([FEET, { ...FEET, y: FEET.y + 1 }]);
    expect(totals(packAt(s, 0, 66, 0)!.slots)).toEqual({ 'item:stick': 2 });
  });
});

describe('death saves', () => {
  it('keep the pack, the grave marker, the respawn point and the death across a reload', async () => {
    const s = equipped('death-save');
    s.player.respawn = { x: 3, y: 65, z: 3 };
    s.send({ type: 'debug.setStat', stat: 'health', value: 0 });
    const pack = packAt(s, FEET.x, FEET.y, FEET.z)!;
    const storage = new MemoryStorage();
    await saveTo(storage, s.sim);
    const resumed = await restoreFrom(storage);
    settle(resumed.sim);
    const player = resumed.sim.players.get(1)!;
    expect(playerRecord('w', player)).toEqual(playerRecord('w', s.player));
    expect(player.graves).toEqual([FEET]);
    expect(player.respawn).toEqual({ x: 3, y: 65, z: 3 });
    expect(player.survival.dead).toBe(true);
    expect(player.survival.packLeft).toBe(true);
    const restored = resumed.sim.blockEntities.get(cellKey(FEET.x, FEET.y, FEET.z))!;
    expect(blockEntityRecord(restored)).toEqual(blockEntityRecord(pack));
    expect(persistentHash(resumed.sim)).toBe(persistentHash(s.sim));
    // Still dead after the reload: no second pack, and the respawn works.
    resumed.step(5);
    expect(player.graves).toEqual([FEET]);
    resumed.host.send({ type: 'player.respawn' });
    resumed.step(1);
    expect(player.survival.dead).toBe(false);
    expect(player.body).toMatchObject({ x: 3.5, y: 65, z: 3.5 });
  });

  it('read a malformed pack record as its valid slots', () => {
    const saved = {
      kind: 'grave',
      x: 1,
      y: 70,
      z: -2,
      slots: [{ item: 'item:dirt', count: 3 }, { item: 4 }, null, { item: 'item:gone', count: 1 }],
    };
    const read = {
      kind: 'grave',
      x: 1,
      y: 70,
      z: -2,
      slots: [
        { item: 'item:dirt', count: 3 },
        null,
        null,
        { item: 'item:unknown', count: 1, original: 'item:gone' },
      ],
      // A pack saved without its worn items apart wears nothing.
      worn: [null, null, null, null, null],
    };
    expect(readBlockEntity(saved, registry, 0)).toEqual(read);
    const worn = [{ item: 'item:fur_hood', count: 1 }, 'hat', null, null, null, { item: 'x' }];
    expect(readBlockEntity({ ...saved, worn }, registry, 0)).toEqual({
      ...read,
      worn: [{ item: 'item:fur_hood', count: 1 }, null, null, null, null],
    });
    expect(readBlockEntity({ ...saved, y: -1 }, registry, 0)).toBeNull();
  });
});
