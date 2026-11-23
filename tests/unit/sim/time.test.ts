import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../../src/sim/events.ts';
import { stateHash } from '../../../src/sim/stateHash.ts';
import {
  createTime,
  DAY_TICKS,
  daylightAt,
  dayOf,
  deserializeTime,
  HOUR_TICKS,
  hourOf,
  NIGHT_DAYLIGHT,
  phaseOf,
  serializeTime,
  setHour,
  stepTime,
} from '../../../src/sim/time.ts';
import { createTestSim } from '../../helpers/simHarness.ts';

const rejected = (events: SimEvent[]) =>
  events.flatMap((e) => (e.type === 'rejected' ? [`${e.command}: ${e.reason}`] : []));

describe('time of day', () => {
  it('starts a world at 07:00 of day 1, in full daylight', () => {
    const time = createTime();
    expect(hourOf(time.ticks)).toBe(7);
    expect(dayOf(time.ticks)).toBe(1);
    expect(phaseOf(hourOf(time.ticks))).toBe('day');
    expect(daylightAt(hourOf(time.ticks))).toBe(1);
    expect(time.frozen).toBe(false);
  });

  it('advances one hour every 1500 ticks and counts days from midnight', () => {
    expect(HOUR_TICKS).toBe(1500);
    expect(DAY_TICKS).toBe(36_000);
    const time = createTime();
    for (let i = 0; i < 1500; i++) stepTime(time);
    expect(hourOf(time.ticks)).toBe(8);
    for (let i = 0; i < 16 * HOUR_TICKS - 1; i++) stepTime(time);
    expect(dayOf(time.ticks)).toBe(1);
    stepTime(time);
    expect(hourOf(time.ticks)).toBe(0);
    expect(dayOf(time.ticks)).toBe(2);
  });

  it('names the phases: dawn 04:30, day 06:00, dusk 18:30, night 20:30', () => {
    const hours = [0, 4.4, 4.5, 5.9, 6, 12, 18.4, 18.5, 20.4, 20.5, 23.9];
    expect(hours.map(phaseOf)).toEqual([
      'night',
      'night',
      'dawn',
      'dawn',
      'day',
      'day',
      'day',
      'dusk',
      'dusk',
      'night',
      'night',
    ]);
  });

  it('dims daylight to 0.12 at night, smoothly and monotonically through dusk and dawn', () => {
    expect(NIGHT_DAYLIGHT).toBe(0.12);
    expect(daylightAt(12)).toBe(1);
    expect(daylightAt(0)).toBe(NIGHT_DAYLIGHT);
    expect(daylightAt(22)).toBe(NIGHT_DAYLIGHT);
    // Halfway through dusk and dawn: halfway between night and day.
    expect(daylightAt(19.5)).toBeCloseTo(0.56, 10);
    expect(daylightAt(5.25)).toBeCloseTo(0.56, 10);
    // No jump at any phase boundary.
    for (const h of [4.5, 6, 18.5, 20.5])
      expect(daylightAt(h - 1e-6)).toBeCloseTo(daylightAt(h), 5);
    for (let i = 1; i <= 40; i++) {
      const dusk = 18.5 + (2 * i) / 40;
      expect(daylightAt(dusk)).toBeLessThan(daylightAt(dusk - 0.05));
      const dawn = 4.5 + (1.5 * i) / 40;
      expect(daylightAt(dawn)).toBeGreaterThan(daylightAt(dawn - 0.0375));
    }
  });

  it('sets an hour of the current day, refusing hours out of range', () => {
    const time = createTime();
    time.ticks += 2 * DAY_TICKS;
    expect(setHour(time, 13.5)).toBe(true);
    expect(dayOf(time.ticks)).toBe(3);
    expect(hourOf(time.ticks)).toBe(13.5);
    for (const bad of [-1, 24, Number.NaN, Number.POSITIVE_INFINITY])
      expect(setHour(time, bad)).toBe(false);
    expect(hourOf(time.ticks)).toBe(13.5);
  });

  it('round-trips through JSON and repairs malformed saves', () => {
    const time = createTime();
    time.ticks = 123_456;
    time.frozen = true;
    const saved = JSON.parse(JSON.stringify(serializeTime(time)));
    expect(deserializeTime(saved)).toEqual(time);
    expect(deserializeTime(undefined)).toEqual(createTime());
    expect(deserializeTime({ ticks: -5, frozen: 'yes' })).toEqual(createTime());
    expect(deserializeTime({ ticks: 1.5 })).toEqual(createTime());
  });

  it('runs at tick step 3 of the simulation and obeys debug.setTime and debug.freezeTime', () => {
    const s = createTestSim({ seed: 'time', worldType: 'flat', allowDebug: true });
    s.sim.addPlayer(1, 2);
    s.step(1500);
    expect(hourOf(s.sim.time.ticks)).toBe(8);
    expect(s.host.view.time()).toBe(s.sim.time);
    // Commands come first in a tick, then the clock: midnight, then one tick.
    s.host.send({ type: 'debug.setTime', hours: 0 });
    s.step(1);
    expect(s.sim.time.ticks).toBe(1);
    const running = stateHash(s.sim);
    s.host.send({ type: 'debug.freezeTime', frozen: true });
    s.step(100);
    expect(s.sim.time.ticks).toBe(1);
    expect(s.sim.time.frozen).toBe(true);
    // The clock is part of the state hash.
    expect(stateHash(s.sim)).not.toBe(running);
    s.host.send({ type: 'debug.freezeTime', frozen: false });
    s.step(10);
    expect(s.sim.time.ticks).toBe(11);
  });

  it('rejects bad clock commands, and every clock command without debugging', () => {
    const s = createTestSim({ seed: 'time', worldType: 'flat', allowDebug: true });
    s.sim.addPlayer(1, 2);
    s.host.send({ type: 'debug.setTime', hours: 24 });
    s.host.send({ type: 'debug.freezeTime', frozen: 'yes' as unknown as boolean });
    s.step(1);
    expect(rejected(s.events)).toEqual(['debug.setTime: invalid', 'debug.freezeTime: invalid']);
    expect(s.sim.time).toEqual({ ticks: createTime().ticks + 1, frozen: false });

    const locked = createTestSim({ seed: 'time', worldType: 'flat' });
    locked.sim.addPlayer(1, 2);
    locked.host.send({ type: 'debug.setTime', hours: 3 });
    locked.host.send({ type: 'debug.freezeTime', frozen: true });
    locked.step(1);
    expect(rejected(locked.events)).toEqual([
      'debug.setTime: debug disabled',
      'debug.freezeTime: debug disabled',
    ]);
  });
});
