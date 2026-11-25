import { describe, expect, it } from 'vitest';
import { WEAR_SLOTS } from '../../../src/content/schema.ts';
import { OPEN_SLOTS_BASE } from '../../../src/sim/commands.ts';
import { type Contact, type Gear, touch, wornGear } from '../../../src/sim/environment.ts';
import { wearFilters, wearGear } from '../../../src/sim/equipment.ts';
import type { SimEvent } from '../../../src/sim/events.ts';
import { toolWear } from '../../../src/sim/mining.ts';
import { inBag, shiftClick, slotClick } from '../../../src/sim/testing/slotMoves.ts';
import { registry } from '../../helpers/registry.ts';
import { playerTestSim, rejections } from '../../helpers/simHarness.ts';

/*
 * Worn equipment (docs « Inventaire », « Équipement de danger »): the Bag's five boxes take only
 * their own kind of gear; what is worn warms, cools, armours, filters the air and keeps the feet
 * dry; a filter wears out with use.
 */

/** Slot number of an equipment slot in the Bag's slot clicks. */
const worn = (slot: (typeof WEAR_SLOTS)[number]) => OPEN_SLOTS_BASE + WEAR_SLOTS.indexOf(slot);
const empty = (): Gear => ({ armor: 0, warmth: 0, cooling: 0, airFilter: 1, waterproof: false });

describe('equipment', () => {
  it('goes only into the box of its slot, swaps, and comes off with Shift+click', () => {
    const s = playerTestSim({ seed: 'equip' });
    s.give('item:fur_hood');
    s.give('item:straw_hat');
    s.give('item:dirt', 5);
    const inv = () => s.player.inventory.map((stack) => stack?.item ?? null);
    const head = () => s.player.equipment[0]?.item ?? null;
    s.send({ type: 'screen.open', kind: 'bag' });
    // A hood refused by the body box, dirt by the head box: each goes back where it was.
    expect(rejections(s.send(slotClick(0), slotClick(worn('body')), slotClick(0)))).toEqual([
      'slot',
    ]);
    expect(rejections(s.send(slotClick(2), slotClick(worn('head')), slotClick(2)))).toEqual([
      'slot',
    ]);
    s.send(slotClick(0), slotClick(worn('head')));
    expect(head()).toBe('item:fur_hood');
    expect(inv()[0]).toBeNull();
    // A hat put onto the hood swaps them, the hood back in the hat's slot.
    s.send(slotClick(1), slotClick(worn('head')), slotClick(1));
    expect(head()).toBe('item:straw_hat');
    expect(inv()[1]).toBe('item:fur_hood');
    // Dirt swapped onto the cursor for the hat never goes into the head box.
    expect(
      rejections(s.send(slotClick(worn('head')), slotClick(2), slotClick(worn('head')))),
    ).toEqual(['slot']);
    expect([head(), inv()[2], s.player.cursor?.item]).toEqual([
      null,
      'item:straw_hat',
      'item:dirt',
    ]);
    s.send(slotClick(2), slotClick(worn('head')));
    expect([head(), inv()[2], s.player.cursor]).toEqual(['item:straw_hat', 'item:dirt', null]);
    // Shift+click: a wearable goes on (swapping), a worn item comes off, anything else crosses
    // between hotbar and bag.
    s.send(shiftClick(1));
    expect(head()).toBe('item:fur_hood');
    expect(inv()[1]).toBe('item:straw_hat');
    s.send(shiftClick(worn('head')));
    expect(head()).toBeNull();
    expect(inv()).toContain('item:fur_hood');
    s.send(shiftClick(2));
    expect(inv().indexOf('item:dirt')).toBeGreaterThanOrEqual(8);
    expect(
      rejections(
        s.send(
          shiftClick(worn('feet')),
          shiftClick(OPEN_SLOTS_BASE + WEAR_SLOTS.length),
          slotClick(-2),
        ),
      ),
    ).toEqual(['nothing to move', 'invalid', 'invalid']);
  });

  it('adds up warmth, cooling and armour, and comes fresh with all its uses', () => {
    const s = playerTestSim({ seed: 'gear' });
    s.give('item:fur_coat');
    s.give('item:bronze_helmet');
    s.send(...inBag(shiftClick(0), shiftClick(1)));
    const coat = registry.item('item:fur_coat')!.wear!;
    const helmet = registry.item('item:bronze_helmet')!.wear!;
    expect(s.player.equipment[2]).toEqual({
      item: 'item:fur_coat',
      count: 1,
      durability: coat.durability,
    });
    expect(wornGear(registry, s.player.equipment, empty())).toEqual({
      armor: coat.armor! + helmet.armor!,
      warmth: coat.warmth!,
      cooling: 0,
      airFilter: 1,
      waterproof: false,
    });
    // Gear held in the hand does not wear by mining, as a tool does.
    const stone = registry.defaultState('block:stone');
    expect(toolWear(registry, stone, registry.itemId('item:fur_coat'))).toBe(0);
    expect(toolWear(registry, stone, registry.itemId('item:flint_pickaxe'))).toBeGreaterThan(0);
  });

  it('wears a filter one use per second of toxic air, and drops it once worn out', () => {
    const s = playerTestSim({ seed: 'filter' });
    s.give('item:filter_mask');
    s.send(...inBag(shiftClick(0)));
    const out: SimEvent[] = [];
    const uses = registry.item('item:filter_mask')!.wear!.durability;
    s.player.survival.airToxicity = 0;
    wearFilters(registry, s.player, out);
    expect(s.player.equipment[1]!.durability).toBe(uses);
    s.player.survival.airToxicity = 0.6;
    wearFilters(registry, s.player, out);
    expect(s.player.equipment[1]!.durability).toBe(uses - 1);
    s.player.equipment[1]!.durability = 1;
    wearFilters(registry, s.player, out);
    expect(s.player.equipment[1]).toBeNull();
    expect(out).toEqual([{ type: 'inventoryChanged', playerId: 1 }]);
  });

  it('wears the filter in the simulation once a second while the air is toxic', () => {
    const s = playerTestSim({ seed: 'filter-sim' });
    s.give('item:filter_mask');
    s.send(...inBag(shiftClick(0)));
    const before = s.player.equipment[1]!.durability!;
    // The flat world's air is clean: no wear.
    s.step(90);
    expect(s.player.equipment[1]!.durability).toBe(before);
    // A toxic air (kept from being sampled again): one use a second.
    s.player.survival.airToxicity = 4;
    s.player.survival.sampleTicks = 1e9;
    s.step(90);
    expect(s.player.equipment[1]!.durability).toBe(before - 3);
  });

  it('keeps foul water at the feet harmless with waterproof boots', () => {
    const s = playerTestSim({ seed: 'boots' });
    s.fill(0, 65, 0, 0, 65, 0, 'block:foul_water');
    const contact: Contact = { toxicity: 0, damage: 0 };
    touch(registry, s.sim.world, s.player, contact);
    expect(contact.toxicity).toBeGreaterThan(0);
    s.give('item:waxed_boots');
    s.send(...inBag(shiftClick(0)));
    touch(registry, s.sim.world, s.player, contact);
    expect(contact.toxicity).toBe(0);
  });
});

describe('gear wear', () => {
  it('wears the worn gear of the pack on a hit, never an unknown item kept from another pack', () => {
    const s = playerTestSim({ seed: 'gear-wear' });
    s.give('item:fur_coat');
    s.send(...inBag(shiftClick(0)));
    const coat = WEAR_SLOTS.indexOf('body');
    const uses = registry.item('item:fur_coat')!.wear!.durability;
    const kept = { item: 'item:unknown', count: 1, original: 'oldpack:item/mithril_boots' };
    const feet = WEAR_SLOTS.indexOf('feet');
    s.player.equipment[feet] = { ...kept };
    const out: SimEvent[] = [];
    wearGear(registry, s.player, out);
    expect(s.player.equipment[coat]!.durability).toBe(uses - 1);
    expect(s.player.equipment[feet]).toEqual(kept);
    s.player.equipment[coat] = null;
    out.length = 0;
    wearGear(registry, s.player, out);
    expect(s.player.equipment[feet]).toEqual(kept);
    expect(out).toEqual([]);
  });
});
