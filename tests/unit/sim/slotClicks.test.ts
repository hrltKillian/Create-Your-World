import { describe, expect, it } from 'vitest';
import { outputSlotOf } from '../../../src/content/crafting.ts';
import { WEAR_SLOTS } from '../../../src/content/schema.ts';
import type { GraveEntity, StationEntity } from '../../../src/sim/blockEntities.ts';
import { type Command, OPEN_SLOTS_BASE } from '../../../src/sim/commands.ts';
import { countItem, createInventory, type ItemStack } from '../../../src/sim/inventory.ts';
import type { ItemDropState } from '../../../src/sim/itemDrops.ts';
import { stateHash } from '../../../src/sim/stateHash.ts';
import { inBag, shiftClick, slotClick } from '../../../src/sim/testing/slotMoves.ts';
import { cellKey } from '../../../src/world/coords.ts';
import { registry } from '../../helpers/registry.ts';
import { eventsOf, playerTestSim, rejections } from '../../helpers/simHarness.ts';

/*
 * The slot clicks of decision 20 (sim/slotClicks.ts) and the screens they need (sim/screens.ts):
 * every command goes through JSON (SerializingSimHost), as `?host=serialize` sends it.
 */

const C = OPEN_SLOTS_BASE;
const L = (slot: number) => slotClick(slot);
const R = (slot: number) => slotClick(slot, 1);
const BAG: Command = { type: 'screen.open', kind: 'bag' };
const CLOSE: Command = { type: 'screen.close' };
const hotkey = (slot: number, hotbar: number): Command => ({ type: 'slot.hotkey', slot, hotbar });
const stack = (item: string, count: number): ItemStack => ({ item: `item:${item}`, count });

/** A flat world, player 1 with the Bag open (`bag: false`: no screen). */
function setup(bag = true, serialize = true) {
  const s = playerTestSim({ seed: 'clicks', serialize });
  if (bag) s.send(BAG);
  const drops = () =>
    [...s.sim.entities.values()].filter((e): e is ItemDropState => e.kind === 'itemDrop');
  return { ...s, inv: s.player.inventory, drops };
}

describe('slot clicks', () => {
  it('refuse every click and hotkey with no screen open', () => {
    const s = setup(false);
    s.inv[0] = stack('dirt', 5);
    expect(rejections(s.send(L(0), R(0), shiftClick(0), L(-1), hotkey(3, 0)))).toEqual(
      new Array(5).fill('no screen'),
    );
    expect([s.inv[0], s.player.cursor]).toEqual([stack('dirt', 5), null]);
  });

  it('left click: takes a stack, puts it down, merges what fits and swaps', () => {
    const s = setup();
    s.inv[0] = stack('dirt', 10);
    s.inv[1] = stack('dirt', 60);
    s.inv[2] = stack('sand', 5);
    const changed = eventsOf(s.send(L(0)), 'inventoryChanged');
    expect(changed).toEqual([{ type: 'inventoryChanged', playerId: 1 }]);
    expect([s.inv[0], s.player.cursor]).toEqual([null, stack('dirt', 10)]);
    // Onto 60 dirt: 4 fit, 6 stay on the cursor.
    s.send(L(1));
    expect([s.inv[1], s.player.cursor]).toEqual([stack('dirt', 64), stack('dirt', 6)]);
    // A different stack swaps with the cursor's.
    s.send(L(2));
    expect([s.inv[2], s.player.cursor]).toEqual([stack('dirt', 6), stack('sand', 5)]);
    s.send(L(0));
    expect([s.inv[0], s.player.cursor]).toEqual([stack('sand', 5), null]);
    // Nothing on either side, or a full stack of the cursor's item: nothing moves.
    expect(rejections(s.send(L(3)))).toEqual(['nothing to move']);
    expect(rejections(s.send(L(2), L(1)))).toEqual(['nothing to move']);
    expect([s.inv[1], s.player.cursor]).toEqual([stack('dirt', 64), stack('dirt', 6)]);
  });

  it('right click: takes half a stack (rounded up), puts one item down, swaps a different one', () => {
    const s = setup();
    s.inv[0] = stack('dirt', 7);
    s.inv[1] = stack('sand', 2);
    s.send(R(0));
    expect([s.inv[0], s.player.cursor]).toEqual([stack('dirt', 3), stack('dirt', 4)]);
    s.send(R(5), R(5), R(0));
    expect([s.inv[0], s.inv[5], s.player.cursor]).toEqual([
      stack('dirt', 4),
      stack('dirt', 2),
      stack('dirt', 1),
    ]);
    s.send(R(1));
    expect([s.inv[1], s.player.cursor]).toEqual([stack('dirt', 1), stack('sand', 2)]);
    // Half of a single item is that item.
    s.send(L(2), R(1));
    expect([s.inv[1], s.player.cursor]).toEqual([null, stack('dirt', 1)]);
    s.inv[3] = stack('dirt', 64);
    expect(rejections(s.send(R(3)))).toEqual(['nothing to move']);
  });

  it('Shift+click sends a stack across and leaves the cursor as it is', () => {
    const s = setup();
    s.inv[0] = stack('dirt', 10);
    s.inv[1] = stack('sand', 3);
    s.send(L(1), shiftClick(0));
    expect([s.inv[0], s.inv[8], s.player.cursor]).toEqual([
      null,
      stack('dirt', 10),
      stack('sand', 3),
    ]);
    s.send(shiftClick(8));
    expect([s.inv[0], s.inv[8]]).toEqual([stack('dirt', 10), null]);
    expect(rejections(s.send(shiftClick(5)))).toEqual(['nothing to move']);
    // Either button, Shift held: the same move.
    s.send(slotClick(0, 1, true));
    expect(s.inv[8]).toEqual(stack('dirt', 10));
  });

  it('a click outside the panel throws the cursor stack (left) or one of its items (right)', () => {
    const s = setup();
    s.inv[0] = stack('dirt', 10);
    s.send(L(0), slotClick(-1, 1));
    expect(s.player.cursor).toEqual(stack('dirt', 9));
    s.send(slotClick(-1, 0));
    expect(s.player.cursor).toBeNull();
    expect(s.drops().map((d) => [d.item, d.count, d.pickupDelay > 0])).toEqual([
      ['item:dirt', 1, true],
      ['item:dirt', 9, true],
    ]);
    expect(rejections(s.send(slotClick(-1)))).toEqual(['nothing to move']);
  });

  it('a station output only gives: taken onto an empty cursor or one of its item, never filled', () => {
    const s = setup(false);
    s.put(0, 65, -2, 'block:kiln[facing4=s,lit=0]');
    s.send({ type: 'container.open', x: 0, y: 65, z: -2 });
    const def = registry.crafting.station('station:kiln')!;
    const out = outputSlotOf(def);
    const kiln = s.sim.blockEntities.get(cellKey(0, 65, -2)) as StationEntity;
    kiln.slots[out] = stack('copper_ingot', 2);
    s.send(L(C + out));
    expect([kiln.slots[out], s.player.cursor]).toEqual([null, stack('copper_ingot', 2)]);
    expect(rejections(s.send(L(C + out), R(C + out)))).toEqual(['slot', 'slot']);
    kiln.slots[out] = stack('copper_ingot', 1);
    s.send(R(C + out));
    expect([kiln.slots[out], s.player.cursor]).toEqual([null, stack('copper_ingot', 3)]);
    // Something else on the cursor: the output's stack stays where it is.
    kiln.slots[out] = stack('copper_ingot', 1);
    s.inv[1] = stack('dirt', 1);
    s.send(L(0), L(1));
    expect(rejections(s.send(L(C + out)))).toEqual(['slot']);
    expect([kiln.slots[out], s.player.cursor, s.inv[0]]).toEqual([
      stack('copper_ingot', 1),
      stack('dirt', 1),
      stack('copper_ingot', 3),
    ]);
  });

  it('a hotbar key swaps a slot with a hotbar slot, where the slot takes it, not with a cursor', () => {
    const s = setup();
    const head = C + WEAR_SLOTS.indexOf('head');
    s.inv[10] = stack('dirt', 5);
    s.send(hotkey(10, 0));
    expect([s.inv[0], s.inv[10]]).toEqual([stack('dirt', 5), null]);
    s.inv[10] = stack('sand', 3);
    s.send(hotkey(10, 0));
    expect([s.inv[0], s.inv[10]]).toEqual([stack('sand', 3), stack('dirt', 5)]);
    // Into the head slot: a hood, never dirt.
    s.inv[1] = stack('dirt', 1);
    s.inv[2] = { item: 'item:fur_hood', count: 1, durability: 7 };
    expect(rejections(s.send(hotkey(head, 1), hotkey(0, 0), hotkey(-1, 0), hotkey(3, 8)))).toEqual([
      'slot',
      'nothing to move',
      'invalid',
      'invalid',
    ]);
    s.send(hotkey(head, 2));
    expect([s.player.equipment[0]?.item, s.inv[2]]).toEqual(['item:fur_hood', null]);
    s.send(L(1));
    expect(rejections(s.send(hotkey(10, 3)))).toEqual(['cursor']);
  });

  it('number the inventory by its size and the open screen past 64, refusing the rest', () => {
    const s = setup();
    s.inv[0] = stack('dirt', 1);
    expect(rejections(s.send(L(32), L(63), L(C + WEAR_SLOTS.length), L(256)))).toEqual(
      new Array(4).fill('invalid'),
    );
    // A grown inventory (upgrades, M19): its new slots click, and the bag reaches them.
    s.player.inventory = createInventory(40);
    const inv = s.player.inventory;
    for (let i = 8; i < 32; i++) inv[i] = stack('stone', 64);
    inv[0] = stack('dirt', 3);
    s.send(shiftClick(0));
    expect(inv[32]).toEqual(stack('dirt', 3));
    s.send(L(32), L(39));
    expect([inv[32], inv[39]]).toEqual([null, stack('dirt', 3)]);
    expect(rejections(s.send(L(40)))).toEqual(['invalid']);
  });

  it('refuse malformed commands, the Bag twice, a dead player and closing nothing', () => {
    const s = setup(false);
    const bad = [
      { type: 'screen.open', kind: 'chest' },
      { type: 'slot.click', slot: 0, button: 2, shift: false },
      { type: 'slot.click', slot: 0, button: 0, shift: 'yes' },
      { type: 'slot.click', slot: 1.5, button: 0, shift: false },
      { type: 'slot.click', slot: -2, button: 0, shift: false },
      { type: 'slot.hotkey', slot: 0, hotbar: 1.5 },
    ] as unknown as Command[];
    expect(rejections(s.send(...bad))).toEqual(bad.map(() => 'invalid'));
    expect(rejections(s.send(CLOSE, BAG, BAG))).toEqual(['nothing open', 'already open']);
    expect(s.player.screen).toEqual({ kind: 'bag' });
    s.send({ type: 'debug.setStat', stat: 'health', value: 0 });
    expect(s.player.screen).toBeNull();
    expect(rejections(s.send(BAG, { type: 'container.open', x: 0, y: 65, z: -2 }))).toEqual([
      'dead',
      'dead',
    ]);
  });
});

describe('the cursor stack', () => {
  it('goes back to the inventory when the screen closes, at the feet when it is full', () => {
    const s = setup();
    s.inv[4] = stack('dirt', 10);
    s.send(L(4), CLOSE);
    expect([s.player.screen, s.player.cursor, s.inv[0]]).toEqual([null, null, stack('dirt', 10)]);
    s.send(BAG, L(0));
    s.inv.fill(stack('stone', 64));
    s.send(CLOSE);
    expect(s.player.cursor).toBeNull();
    expect(s.drops().map((d) => [d.item, d.count])).toEqual([['item:dirt', 10]]);
  });

  it('goes back when the simulation closes a chest the player walked away from', () => {
    const s = setup(false);
    s.put(0, 65, -2, 'block:chest[facing4=s]');
    s.inv[0] = stack('dirt', 6);
    s.send({ type: 'container.open', x: 0, y: 65, z: -2 }, L(0), R(C + 2));
    expect(s.player.cursor).toEqual(stack('dirt', 5));
    const events = s.send({ type: 'debug.teleport', x: 8.5, y: 'surface', z: 0.5 });
    expect(eventsOf(events, 'blockEntityClosed')).toHaveLength(1);
    expect([s.player.screen, s.player.cursor, s.inv[0]]).toEqual([null, null, stack('dirt', 5)]);
  });

  it('goes back when another screen opens in place of the open one', () => {
    const s = setup();
    s.put(0, 65, -2, 'block:chest[facing4=s]');
    s.inv[3] = stack('dirt', 2);
    s.send(L(3), { type: 'container.open', x: 0, y: 65, z: -2 });
    expect(s.player.screen).toEqual({ kind: 'block', x: 0, y: 65, z: -2 });
    expect([s.player.cursor, s.inv[0]]).toEqual([null, stack('dirt', 2)]);
    // And the Bag in place of the chest.
    s.send(L(0), BAG);
    expect([s.player.screen, s.player.cursor, s.inv[0]]).toEqual([
      { kind: 'bag' },
      null,
      stack('dirt', 2),
    ]);
  });

  it('goes into the Abandoned Pack at a death, nothing lost', () => {
    const s = setup();
    s.inv[0] = stack('dirt', 10);
    s.inv[1] = stack('sand', 4);
    s.send(R(0));
    s.send({ type: 'debug.setStat', stat: 'health', value: 0 });
    expect([s.player.screen, s.player.cursor]).toEqual([null, null]);
    const pack = [...s.sim.blockEntities.values()].find((e) => e.kind === 'grave') as GraveEntity;
    expect(countItem(pack.slots, 'item:dirt')).toBe(10);
    expect(countItem(pack.slots, 'item:sand')).toBe(4);
    expect(s.drops()).toEqual([]);
  });

  it('a cursor stack a dead player still holds goes back to the inventory at the respawn', () => {
    const s = setup(false);
    s.send({ type: 'debug.setStat', stat: 'health', value: 0 });
    // As a crafted save would hold it: the death took everything carried before.
    s.player.cursor = stack('dirt', 3);
    s.send({ type: 'player.respawn' });
    expect([s.player.cursor, countItem(s.player.inventory, 'item:dirt')]).toEqual([null, 3]);
  });

  it('is noted as seen, like the inventory, for the Logbook', () => {
    const s = setup(false);
    s.put(0, 65, -2, 'block:chest[facing4=s]');
    s.send({ type: 'container.open', x: 0, y: 65, z: -2 });
    const chest = s.sim.blockEntities.get(cellKey(0, 65, -2))!;
    chest.slots[0] = stack('bog_iron', 1);
    s.send(L(C));
    expect(s.player.seen['item:bog_iron']).toBe(true);
  });
});

describe('slot commands through JSON', () => {
  it('survive a JSON round trip and play the same as sent in memory', () => {
    const commands: Command[] = [
      ...inBag(L(0), R(5), L(-1), slotClick(5, 0, true), hotkey(8, 2)),
      { type: 'screen.open', kind: 'bag' },
      L(1),
      slotClick(-1, 1),
    ];
    for (const command of commands) expect(JSON.parse(JSON.stringify(command))).toEqual(command);
    const run = (serialize: boolean) => {
      const s = setup(false, serialize);
      s.inv[0] = stack('dirt', 9);
      s.inv[1] = stack('sand', 4);
      s.send(...commands);
      return { hash: stateHash(s.sim), cursor: s.player.cursor, inventory: s.player.inventory };
    };
    const relayed = run(true);
    expect(relayed).toEqual(run(false));
    expect(relayed.cursor).toEqual(stack('sand', 3));
    expect(relayed.inventory[2]).toEqual(stack('dirt', 1));
  });
});
