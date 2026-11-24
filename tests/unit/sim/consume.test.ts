import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND, ticksOf } from '../../../src/sim/clock.ts';
import { PHYSICS } from '../../../src/sim/physics.ts';
import { NO_USE } from '../../../src/sim/player.ts';
import { registry } from '../../helpers/registry.ts';
import { eventsOf, playerTestSim } from '../../helpers/simHarness.ts';

/*
 * Eating and drinking the held item (docs « Priorité des actions »): held `consume.seconds`, after
 * the interactive blocks and before placing. Amounts come from the pack's items.
 */

const b = registry.pack.balance;
const MINUTE = 60 * TICKS_PER_SECOND;
const consume = (item: string) => registry.item(item)!.consume!;
/** Looking at the grass just north of the player. */
const GROUND = { target: { x: 0, y: 64, z: -2, face: 2 } };

/** A flat world whose player holds `count` of an item in slot 0, hungry and hurt. */
function holding(item: string, count: number) {
  const s = playerTestSim({ seed: 'consume' });
  s.give(item, count);
  s.send(
    { type: 'debug.setStat', stat: 'hunger', value: 40 },
    { type: 'debug.setStat', stat: 'health', value: 50 },
  );
  return s;
}

describe('consumables', () => {
  it('are eaten once held for their time, one at a time, and give their hunger', () => {
    const s = holding('item:berries', 3);
    const berries = consume('item:berries');
    const hold = ticksOf(berries.seconds);
    const hunger = s.player.survival.hunger;
    s.tick(hold - 1, { ...GROUND, secondary: true });
    expect(s.player.inventory[0]!.count).toBe(3);
    s.events.length = 0;
    s.tick(1, { ...GROUND, secondary: true });
    expect(s.player.inventory[0]!.count).toBe(2);
    expect(s.player.survival.hunger).toBeCloseTo(
      hunger + berries.hunger! - (b.hunger.perMin * hold) / MINUTE,
      6,
    );
    expect(eventsOf(s.events, 'consumed')).toEqual([
      { type: 'consumed', playerId: 1, item: 'item:berries' },
    ]);
    // Nothing was placed on the ground meanwhile.
    expect(eventsOf(s.events, 'blockPlaced')).toEqual([]);
    // A release starts over; holding on eats the next ones, until none is left.
    s.tick(hold - 1, { ...GROUND, secondary: true });
    s.tick(1);
    expect(s.player.inventory[0]!.count).toBe(2);
    s.tick(2 * hold, { ...GROUND, secondary: true });
    expect(s.player.inventory[0]).toBeNull();
  });

  it('poison (raw meat), heal (bandage) and cure (antidote) as their data says', () => {
    const s = holding('item:raw_meat', 1);
    s.tick(ticksOf(consume('item:raw_meat').seconds), { secondary: true });
    expect(s.player.survival.toxicity).toBeCloseTo(consume('item:raw_meat').toxicity!, 1);
    // Food that quenches nothing is no drink.
    expect(s.player.drank).toBe(false);
    s.tick(1);
    s.give('item:antidote_tea');
    s.tick(ticksOf(consume('item:antidote_tea').seconds), { secondary: true });
    expect(s.player.survival.toxicity).toBe(0);
    expect(consume('item:antidote_tea').thirst).toBeGreaterThan(0);
    expect(s.player.drank).toBe(true);
    s.tick(1);
    s.give('item:bandage');
    const health = s.player.survival.health;
    s.tick(ticksOf(consume('item:bandage').seconds), { secondary: true });
    expect(s.player.survival.health).toBeCloseTo(health + consume('item:bandage').health!, 0);
  });

  it('come after an interactive block, and crouching still eats', () => {
    const s = holding('item:berries', 2);
    s.fill(0, 65, -2, 0, 65, -2, 'block:chest[facing4=s]');
    const chest = { target: { x: 0, y: 65, z: -2, face: 4 } };
    s.events.length = 0;
    s.tick(TICKS_PER_SECOND * 2, { ...chest, secondary: true });
    expect(eventsOf(s.events, 'blockEntityOpened')).toHaveLength(1);
    expect(s.player.inventory[0]!.count).toBe(2);
    s.tick(1);
    s.tick(ticksOf(consume('item:berries').seconds), { ...chest, crouch: true, secondary: true });
    expect(s.player.inventory[0]!.count).toBe(1);
  });

  it('slow the player to the balance share of the walk while eating or sipping, without sprint', () => {
    const speed = (s: ReturnType<typeof playerTestSim>) =>
      Math.hypot(s.player.body.vx, s.player.body.vz);
    const slow = PHYSICS.walk * b.consume.moveFactor;
    // Eating the held berries while running forward, looking at the sky.
    const s = holding('item:berries', 20);
    const run = { forward: 1, sprint: true, pitch: 1.2 };
    s.tick(20, { ...run, secondary: true });
    expect(s.player.interaction.useItem).not.toBe(NO_USE);
    expect(speed(s)).toBeCloseTo(slow, 6);
    expect(s.player.sprinting).toBe(false);
    // Let go: the sprint comes back at once.
    s.tick(20, run);
    expect(speed(s)).toBeCloseTo(PHYSICS.sprint, 6);
    expect(s.player.sprinting).toBe(true);
    // A sip from the pond just ahead, the hand empty, slows the same way (still on the bank).
    const sipping = playerTestSim({ seed: 'consume' });
    sipping.fill(-3, 64, -8, 3, 64, -1, 'block:fresh_water');
    sipping.tick(10, { forward: 1, sprint: true, secondary: true, pitch: -1.2 });
    expect(sipping.player.interaction.useItem).not.toBe(NO_USE);
    expect(speed(sipping)).toBeCloseTo(slow, 6);
  });
});
