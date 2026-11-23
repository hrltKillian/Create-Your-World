import { describe, expect, it } from 'vitest';
import { outputSlotOf, stationSlotCount } from '../../../src/content/crafting.ts';
import type { StationEntity } from '../../../src/sim/blockEntities.ts';
import { TICKS_PER_SECOND, ticksOf } from '../../../src/sim/clock.ts';
import type { ItemStack } from '../../../src/sim/inventory.ts';
import { stepStation } from '../../../src/sim/stations.ts';
import { registry } from '../../helpers/registry.ts';
import { eventsOf, playerTestSim } from '../../helpers/simHarness.ts';

/*
 * Drinking water (docs « Eau potable »): sips, filled containers, their charges and boiling. The
 * expected amounts come from the pack (liquids, items, balance).
 */

const b = registry.pack.balance;
const MINUTE = 60 * TICKS_PER_SECOND;
const liquid = (key: string) => registry.blockDef(registry.defaultState(key as never)).liquid!;
const consume = (item: string) => registry.item(item)!.consume!;
/** Looking down at the cell (0, 64, −1) from (0.5, 65, 0.5). */
const DOWN = { pitch: -1.2 };

/** A flat world with a pool of `water` just in front of the player, thirst at about 40. */
function pool(water = 'block:fresh_water') {
  const s = playerTestSim({ seed: 'water' });
  s.fill(0, 64, -1, 0, 64, -1, water);
  s.send({ type: 'debug.setStat', stat: 'thirst', value: 40 });
  return { ...s, start: s.player.survival.thirst };
}

/** Thirst lost to the drain over `ticks` ticks of idling. */
const drain = (ticks: number) => (b.thirst.perMin * ticks) / MINUTE;

describe('sips', () => {
  it('drink from fresh water with the hand empty, held 0.8 s each', () => {
    const s = pool();
    const sip = ticksOf(b.water.sipSec);
    const fresh = liquid('block:fresh_water');
    s.tick(sip - 1, { ...DOWN, secondary: true });
    expect(s.player.survival.thirst).toBeCloseTo(s.start - drain(sip - 1), 6);
    expect(s.player.drank).toBe(false);
    s.events.length = 0;
    s.tick(1, { ...DOWN, secondary: true });
    expect(s.player.survival.thirst).toBeCloseTo(s.start + fresh.thirstPerSip - drain(sip), 6);
    // The player has drunk (an objective asks for it).
    expect(s.player.drank).toBe(true);
    expect(s.player.survival.toxicity).toBeCloseTo(fresh.toxicityPerSip, 2);
    expect(eventsOf(s.events, 'consumed')).toEqual([
      { type: 'consumed', playerId: 1, item: 'block:fresh_water' },
    ]);
    // Held on, sip follows sip.
    s.tick(sip, { ...DOWN, secondary: true });
    const twice = s.start + 2 * fresh.thirstPerSip - drain(2 * sip);
    expect(s.player.survival.thirst).toBeCloseTo(twice, 6);
  });

  it('start over when released or when the water is no longer aimed at', () => {
    const s = pool();
    const sip = ticksOf(b.water.sipSec);
    s.tick(sip - 1, { ...DOWN, secondary: true });
    s.tick(1);
    s.tick(sip - 1, { ...DOWN, secondary: true });
    // Looking away, then back, while held: no sip until the button is pressed again.
    s.tick(1, { pitch: 0.5, secondary: true });
    s.tick(sip, { ...DOWN, secondary: true });
    expect(s.player.survival.thirst).toBeCloseTo(s.start - drain(3 * sip), 6);
  });

  it('of foul water quench as much but poison', () => {
    const s = pool('block:foul_water');
    const foul = liquid('block:foul_water');
    s.tick(ticksOf(b.water.sipSec), { ...DOWN, secondary: true });
    const sip = ticksOf(b.water.sipSec);
    expect(s.player.survival.thirst).toBeCloseTo(s.start + foul.thirstPerSip - drain(sip), 6);
    expect(s.player.survival.toxicity).toBeCloseTo(foul.toxicityPerSip, 2);
  });
});

describe('water containers', () => {
  it('fill on the press, then each held drink takes one charge until the flask is empty', () => {
    const s = pool();
    s.give('item:flask_empty');
    s.tick(1, { ...DOWN, secondary: true });
    const charges = registry.item('item:flask_raw')!.container!.charges;
    expect(s.player.inventory[0]).toEqual({
      item: 'item:flask_raw',
      count: 1,
      durability: charges,
    });
    // Still held: the flask just filled is not drunk.
    s.tick(TICKS_PER_SECOND * 3, { ...DOWN, secondary: true });
    expect(s.player.inventory[0]!.durability).toBe(charges);
    s.tick(1);
    const drink = consume('item:flask_raw');
    const hold = ticksOf(drink.seconds);
    const thirst = s.player.survival.thirst;
    const toxicity = s.player.survival.toxicity;
    s.tick(hold, { ...DOWN, secondary: true });
    expect(s.player.survival.thirst).toBeCloseTo(thirst + drink.thirst! - drain(hold), 6);
    expect(s.player.survival.toxicity).toBeCloseTo(toxicity + drink.toxicity!, 1);
    expect(s.player.inventory[0]).toEqual({
      item: 'item:flask_raw',
      count: 1,
      durability: charges - 1,
    });
    s.tick(hold * (charges - 1), { ...DOWN, secondary: true });
    expect(s.player.inventory[0]).toEqual({ item: 'item:flask_empty', count: 1 });
  });

  it('fill with foul water from a foul pond, which poisons more once drunk', () => {
    const s = pool('block:foul_water');
    s.give('item:waterskin_empty');
    s.tick(1, { ...DOWN, secondary: true });
    expect(s.player.inventory[0]!.item).toBe('item:waterskin_foul');
    expect(consume('item:waterskin_foul').toxicity).toBeGreaterThan(
      consume('item:waterskin_raw').toxicity!,
    );
    expect(consume('item:waterskin_boiled').toxicity ?? 0).toBe(0);
  });

  it('boil at the campfire into boiled water, keeping the charges left', () => {
    const def = registry.crafting.station('station:campfire')!;
    const slots: (ItemStack | null)[] = new Array(stationSlotCount(def)).fill(null);
    slots[0] = { item: 'item:flask_raw', count: 1, durability: 2 };
    slots[def.inputSlots] = { item: 'item:broadleaf_log', count: 1 };
    const campfire: StationEntity = {
      kind: 'station',
      x: 0,
      y: 64,
      z: 0,
      station: def.key,
      slots,
      burnTicksLeft: 0,
      burnTicks: 0,
      progressTicks: 0,
      process: '',
      lit: false,
      tick: 0,
    };
    const boil = registry.crafting.process('process:flask_boiled')!;
    for (let i = 0; i < ticksOf(boil.seconds); i++) stepStation(campfire, def, registry);
    expect(campfire.slots[0]).toBeNull();
    expect(campfire.slots[outputSlotOf(def)]).toEqual({
      item: 'item:flask_boiled',
      count: 1,
      durability: 2,
    });
  });
});
