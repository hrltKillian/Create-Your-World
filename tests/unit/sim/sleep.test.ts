import { describe, expect, it } from 'vitest';
import { SLEEP_NIGHT_HINT, SLEEP_SHELTER_HINT } from '../../../src/sim/sleep.ts';
import {
  DAY_TICKS,
  dayOf,
  HOUR_TICKS,
  hourOf,
  nextHour,
  passedHour,
  withinHours,
} from '../../../src/sim/time.ts';
import { registry } from '../../helpers/registry.ts';
import { eventsOf, playerTestSim } from '../../helpers/simHarness.ts';

/*
 * Sleeping (docs « Sommeil ») and the clock's messages (« Jour/nuit »): the hours and costs come
 * from the pack's balance.
 */

const b = registry.pack.balance;
const BED = { x: 0, y: 65, z: -1 };
const ON_BED = { target: { ...BED, face: 2 } };

/** A closed plank hut around the player (inside x −1…1, y 65…67, z −2…1) with a bedroll. */
function hut(seed: string) {
  const s = playerTestSim({ seed });
  s.send(
    { type: 'debug.fill', x0: -2, y0: 64, z0: -3, x1: 2, y1: 68, z1: 2, state: 'block:planks' },
    { type: 'debug.fill', x0: -1, y0: 65, z0: -2, x1: 1, y1: 67, z1: 1, state: 'block:air' },
  );
  s.fill(BED.x, BED.y, BED.z, BED.x, BED.y, BED.z, 'block:bedroll[facing4=n]');
  return s;
}

/** Presses secondary on the bedroll for one tick; returns its events. */
function lieDown(s: ReturnType<typeof hut>) {
  s.events.length = 0;
  s.tick(1, { ...ON_BED, secondary: true });
  s.tick(1);
  return [...s.events];
}

describe('sleeping', () => {
  it('skips a night in a closed shelter to 06:00, for its hunger and thirst, and sets the respawn', () => {
    const s = hut('sleep');
    s.send({ type: 'debug.setTime', hours: 22 });
    const day = dayOf(s.sim.time.ticks);
    const { hunger, thirst } = s.player.survival;
    const events = lieDown(s);
    expect(hourOf(s.sim.time.ticks)).toBeCloseTo(b.sleep.wakeHour, 2);
    expect(dayOf(s.sim.time.ticks)).toBe(day + 1);
    expect(s.player.survival.hunger).toBeCloseTo(hunger - b.sleep.hunger, 1);
    expect(s.player.survival.thirst).toBeCloseTo(thirst - b.sleep.thirst, 1);
    expect(s.player.respawn).toEqual(BED);
    expect(eventsOf(events, 'slept')).toEqual([{ type: 'slept', playerId: 1, day: day + 1 }]);
    expect(eventsOf(events, 'nightSurvived')).toEqual([{ type: 'nightSurvived', night: day }]);
  });

  it('works past midnight too, until 05:00', () => {
    const s = hut('sleep-late');
    s.send({ type: 'debug.setTime', hours: b.sleep.toHour - 0.5 });
    const day = dayOf(s.sim.time.ticks);
    lieDown(s);
    expect(dayOf(s.sim.time.ticks)).toBe(day);
    expect(hourOf(s.sim.time.ticks)).toBeCloseTo(b.sleep.wakeHour, 2);
  });

  it('is refused by day and outside a closed shelter, with a hint', () => {
    const s = hut('sleep-refused');
    s.send({ type: 'debug.setTime', hours: 12 });
    const noon = s.sim.time.ticks;
    expect(eventsOf(lieDown(s), 'hint').map((e) => e.key)).toEqual([SLEEP_NIGHT_HINT]);
    expect(s.sim.time.ticks).toBe(noon + 2);
    s.send({ type: 'debug.setTime', hours: 23 });
    // A hole in the roof: the sky comes in.
    s.fill(0, 68, 0, 0, 68, 0, 'block:air');
    s.step(2);
    expect(eventsOf(lieDown(s), 'hint').map((e) => e.key)).toEqual([SLEEP_SHELTER_HINT]);
    expect(s.player.respawn).toBeNull();
  });

  it('forgets the respawn point once the bedroll is broken', () => {
    const s = hut('sleep-break');
    s.send({ type: 'debug.setTime', hours: 22 });
    lieDown(s);
    expect(s.player.respawn).toEqual(BED);
    s.tick(60, { ...ON_BED, primary: true });
    expect(s.block(BED.x, BED.y, BED.z)).toBe('block:air');
    expect(s.player.respawn).toBeNull();
  });
});

describe('the clock', () => {
  it('finds hours within a range across midnight, and the next time of an hour', () => {
    expect(withinHours(22, 19.5, 5)).toBe(true);
    expect(withinHours(4.9, 19.5, 5)).toBe(true);
    expect(withinHours(12, 19.5, 5)).toBe(false);
    expect(withinHours(10, 8, 12)).toBe(true);
    expect(withinHours(12, 8, 12)).toBe(false);
    expect(nextHour(22 * HOUR_TICKS, 6)).toBe(DAY_TICKS + 6 * HOUR_TICKS);
    expect(nextHour(DAY_TICKS + 2 * HOUR_TICKS, 6)).toBe(DAY_TICKS + 6 * HOUR_TICKS);
    expect(nextHour(6 * HOUR_TICKS, 6)).toBe(DAY_TICKS + 6 * HOUR_TICKS);
    expect(passedHour(6 * HOUR_TICKS - 1, 6 * HOUR_TICKS, 6)).toBe(1);
    expect(passedHour(6 * HOUR_TICKS, 6 * HOUR_TICKS + 1, 6)).toBe(0);
    expect(passedHour(7 * HOUR_TICKS, DAY_TICKS + 7 * HOUR_TICKS, 6)).toBe(2);
    // Backwards (a debug clock move) passes nothing.
    expect(passedHour(DAY_TICKS + 7 * HOUR_TICKS, 5 * HOUR_TICKS, 6)).toBe(0);
  });

  it('says the sun sets at 18:30 and the first night is survived at 06:00', () => {
    const s = playerTestSim({ seed: 'clock' });
    s.send({ type: 'debug.setTime', hours: 18.49 });
    s.events.length = 0;
    s.step(30);
    expect(eventsOf(s.events, 'sunset')).toEqual([{ type: 'sunset', day: 1 }]);
    s.send({ type: 'debug.setTime', hours: 23.99 });
    s.step(30);
    s.send({ type: 'debug.setTime', hours: 5.99 });
    s.events.length = 0;
    s.step(30);
    expect(eventsOf(s.events, 'nightSurvived')).toEqual([{ type: 'nightSurvived', night: 1 }]);
  });
});
