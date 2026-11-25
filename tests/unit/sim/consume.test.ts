import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND, ticksOf } from '../../../src/sim/clock.ts';
import { NO_USE } from '../../../src/sim/consume.ts';
import { PHYSICS } from '../../../src/sim/physics.ts';
import { registry } from '../../helpers/registry.ts';
import { eventsOf, playerTestSim } from '../../helpers/simHarness.ts';

/*
 * Eating and drinking the held item (docs « Priorité des actions »): held `consume.seconds`, after
 * the interactive blocks and before placing. Amounts come from the pack's items.
 */

const b = registry.pack.balance;
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
    // Standing still costs no hunger (plan v3 « M30 »: the reference game's exhaustion).
    expect(s.player.survival.hunger).toBeCloseTo(
      Math.min(b.hunger.max, hunger + berries.hunger!),
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

  it('stop slowing the player once the meal stops: another hand, a chest, an empty container', () => {
    const speed = (s: ReturnType<typeof playerTestSim>) =>
      Math.hypot(s.player.body.vx, s.player.body.vz);
    const slow = PHYSICS.walk * b.consume.moveFactor;
    // Running east, looking at the sky, while eating the berries of slot 0.
    const run = { forward: 1, sprint: true, yaw: -Math.PI / 2, pitch: 1.2, secondary: true };
    const meal = (s: ReturnType<typeof playerTestSim>) => {
      s.tick(10, run);
      expect(speed(s)).toBeCloseTo(slow, 6);
    };
    // Another food in hand: not eaten without a new press, and the sprint is back.
    const other = holding('item:berries', 20);
    other.give('item:raw_meat', 5);
    meal(other);
    other.tick(10, { ...run, slot: 1 });
    expect(speed(other)).toBeCloseTo(PHYSICS.sprint, 6);
    expect(other.player.sprinting).toBe(true);
    expect(other.player.inventory[1]).toMatchObject({ item: 'item:raw_meat', count: 5 });
    // A chest aimed at along the way (not opened: no new press) stops the meal for good.
    const chest = holding('item:berries', 20);
    chest.put(2, 65, -1, 'block:chest[facing4=s]');
    meal(chest);
    chest.tick(10, { ...run, target: { x: 2, y: 65, z: -1, face: 4 } });
    expect(speed(chest)).toBeCloseTo(PHYSICS.sprint, 6);
    expect(chest.player.sprinting).toBe(true);
    chest.tick(ticksOf(consume('item:berries').seconds), run);
    expect(chest.player.inventory[0]!.count).toBe(20);
    expect(chest.player.sprinting).toBe(true);
    // An empty flask aimed at the pond (filled on a press only): walking along the bank.
    const flask = holding('item:berries', 20);
    flask.give('item:flask_empty');
    flask.fill(-3, 64, -8, 6, 64, -1, 'block:fresh_water');
    const bank = { strafe: 1, pitch: -1.2, secondary: true };
    flask.tick(10, bank);
    expect(speed(flask)).toBeCloseTo(slow, 6);
    flask.tick(10, { ...bank, slot: 1 });
    expect(speed(flask)).toBeCloseTo(PHYSICS.walk, 6);
    expect(flask.player.inventory[1]!.item).toBe('item:flask_empty');
  });
});
