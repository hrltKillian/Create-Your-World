import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../../../src/sim/clock.ts';
import type { DebugStat } from '../../../src/sim/commands.ts';
import {
  dayFactor,
  feltTemperature,
  type Gear,
  type ThermalInput,
  targetTemperature,
  wornGear,
} from '../../../src/sim/environment.ts';
import type { ItemStack } from '../../../src/sim/inventory.ts';
import { STAMINA } from '../../../src/sim/player.ts';
import type { Shelter } from '../../../src/sim/shelter.ts';
import {
  addEffect,
  createSurvival,
  type Exposure,
  fallDamage,
  type SurvivalState,
  stepGauges,
  thermalStatus,
} from '../../../src/sim/survival.ts';
import { NIGHT_DAYLIGHT } from '../../../src/sim/time.ts';
import { registry } from '../../helpers/registry.ts';
import { createTestSim } from '../../helpers/simHarness.ts';

/*
 * Balance tests (docs « M9 », « Survie »): the survival model runs on the pack's balance and must
 * land in the windows of the docs; the exact times come from the same balance numbers.
 */

const b = registry.pack.balance;
const MINUTE = 60 * TICKS_PER_SECOND;

const climate = (key: string) => registry.pack.biomes!.find((biome) => biome.key === key)!;

/** Worn items by key (any slot order: gear adds up). */
function gearOf(...items: string[]): Gear {
  const equipment: (ItemStack | null)[] = items.map((item) => ({ item, count: 1 }));
  const empty = { armor: 0, warmth: 0, cooling: 0, airFilter: 1, waterproof: false };
  return wornGear(registry, equipment, empty);
}

/** The thermal model's input for a biome in the open, by day (1) or night (0), with gear. */
function thermalIn(biome: string, day: number, gear = gearOf(), shelter: Shelter = 'exposed') {
  const { dayC, nightC } = climate(biome).climate;
  const input: ThermalInput = {
    dayC,
    nightC,
    day,
    y: 64,
    cave: false,
    shelter,
    heat: 0,
    inWater: false,
    warmth: gear.warmth,
    cooling: gear.cooling,
  };
  return input;
}

const idle: Exposure = { sprinting: false, underwater: false, toxicity: 0, damage: 0 };

/**
 * Steps a fresh survival state (its environment set by `setup`) tick by tick; returns the minutes
 * until `done` holds, or Infinity within `maxMinutes`.
 */
function minutesUntil(
  setup: (s: SurvivalState) => void,
  done: (s: SurvivalState) => boolean,
  maxMinutes = 60,
  exposure: Exposure = idle,
): number {
  const s = createSurvival(b);
  setup(s);
  for (let tick = 1; tick <= maxMinutes * MINUTE; tick++) {
    stepGauges(s, b, exposure);
    if (done(s)) return tick / MINUTE;
  }
  return Number.POSITIVE_INFINITY;
}

/** Sets the temperature target of a thermal input. */
const towards = (input: ThermalInput) => (s: SurvivalState) => {
  s.target = targetTemperature(feltTemperature(input, b.climate), b);
};

const cold = (s: SurvivalState) => thermalStatus(s.temperature, b) <= -1;
const freezing = (s: SurvivalState) => thermalStatus(s.temperature, b) === -2;
const hot = (s: SurvivalState) => thermalStatus(s.temperature, b) >= 1;
const overheating = (s: SurvivalState) => thermalStatus(s.temperature, b) === 2;

describe('hunger, thirst and an idle death', () => {
  it('empties hunger in 25 min (± 1 %) and thirst in 16 min', () => {
    const hunger = minutesUntil(
      () => {},
      (s) => s.hunger === 0,
    );
    expect(hunger).toBeCloseTo(b.hunger.max / b.hunger.perMin, 2);
    expect(Math.abs(hunger - 25)).toBeLessThanOrEqual(0.25);
    const thirst = minutesUntil(
      () => {},
      (s) => s.thirst === 0,
    );
    expect(thirst).toBeCloseTo(b.thirst.max / b.thirst.perMin, 2);
    expect(thirst).toBeCloseTo(16, 1);
  });

  it('kills an idle player of thirst between 18 and 26 min (about 21.6)', () => {
    let cause = '';
    const death = minutesUntil(
      () => {},
      (s) => {
        cause = s.cause;
        return s.health === 0;
      },
    );
    const expected = b.thirst.max / b.thirst.perMin + b.health.max / b.thirst.emptyDamagePerMin;
    expect(death).toBeCloseTo(expected, 2);
    expect(death).toBeGreaterThan(18);
    expect(death).toBeLessThan(26);
    expect(cause).toBe('dehydration');
  });

  it('kills an idle player in the simulation too (meadow, day then night)', () => {
    const s = createTestSim({ seed: 'idle', worldType: 'flat', allowDebug: true });
    const player = s.sim.addPlayer(1, 2);
    let ticks = 0;
    while (player.survival.health > 0 && ticks < 30 * MINUTE) {
      s.step(MINUTE / 2);
      s.events.length = 0;
      ticks += MINUTE / 2;
    }
    expect(ticks / MINUTE).toBeGreaterThan(18);
    expect(ticks / MINUTE).toBeLessThan(26);
    expect(player.survival.cause).toBe('dehydration');
    // Dead, the gauges stand still.
    const thirst = player.survival.thirst;
    const hunger = player.survival.hunger;
    s.step(60);
    expect(player.survival.hunger).toBe(hunger);
    expect(player.survival.thirst).toBe(thirst);
  });

  it('drains faster while sprinting, and stamina spent costs hunger', () => {
    const sprinting = { ...idle, sprinting: true };
    const hunger = minutesUntil(
      () => {},
      (s) => s.hunger === 0,
      60,
      sprinting,
    );
    expect(hunger).toBeCloseTo(b.hunger.max / b.hunger.perMin / b.hunger.sprintFactor, 2);
    const s = createSurvival(b);
    s.staminaSpent = b.hunger.staminaPerPoint * 3;
    stepGauges(s, b, idle);
    expect(s.hunger).toBeCloseTo(b.hunger.max - 3 - b.hunger.perMin / MINUTE, 6);
    expect(s.staminaSpent).toBe(0);
  });
});

describe('temperature', () => {
  it('locks the thermal examples: tundra shelter at night is 4.4 °C, target −28', () => {
    expect(dayFactor(NIGHT_DAYLIGHT)).toBe(0);
    expect(dayFactor(1)).toBe(1);
    const shelter = thermalIn('biome:tundra', 0, gearOf(), 'enclosed');
    expect(feltTemperature(shelter, b.climate)).toBeCloseTo(4.4, 6);
    expect(targetTemperature(feltTemperature(shelter, b.climate), b)).toBeCloseTo(-28, 6);
  });

  it('tundra without gear: Cold at about 2.5 min and Freezing at about 4.4, day or night', () => {
    for (const day of [0, 1]) {
      const input = thermalIn('biome:tundra', day);
      const t = b.temperature;
      expect(minutesUntil(towards(input), cold)).toBeCloseTo(t.mildAt / t.awayPerMin, 1);
      expect(minutesUntil(towards(input), cold)).toBeGreaterThanOrEqual(2.2);
      expect(minutesUntil(towards(input), cold)).toBeLessThanOrEqual(2.8);
      expect(minutesUntil(towards(input), freezing)).toBeCloseTo(t.severeAt / t.awayPerMin, 1);
      expect(minutesUntil(towards(input), freezing)).toBeGreaterThanOrEqual(3.9);
      expect(minutesUntil(towards(input), freezing)).toBeLessThanOrEqual(4.9);
    }
  });

  it('tundra in fur: comfort by day, Cold without damage at night, never Freezing', () => {
    const fur = gearOf('item:fur_hood', 'item:fur_coat');
    const day = thermalIn('biome:tundra', 1, fur);
    expect(targetTemperature(feltTemperature(day, b.climate), b)).toBe(0);
    expect(minutesUntil(towards(day), cold)).toBe(Number.POSITIVE_INFINITY);
    const night = thermalIn('biome:tundra', 0, fur);
    expect(minutesUntil(towards(night), freezing, 120)).toBe(Number.POSITIVE_INFINITY);
    const s = createSurvival(b);
    towards(night)(s);
    for (let i = 0; i < 10 * MINUTE; i++) stepGauges(s, b, idle);
    expect(thermalStatus(s.temperature, b)).toBe(-1);
    expect(s.health).toBe(b.health.max);
  });

  it('desert: Overheating at about 4.4 min by day; a veil and a straw hat keep it safe', () => {
    const open = thermalIn('biome:ochre_desert', 1);
    const t = b.temperature;
    const minutes = minutesUntil(towards(open), overheating);
    expect(minutes).toBeCloseTo(t.severeAt / t.awayPerMin, 1);
    expect(Math.abs(minutes - 4.4)).toBeLessThanOrEqual(0.5);
    const veiled = thermalIn('biome:ochre_desert', 1, gearOf('item:fiber_veil', 'item:straw_hat'));
    expect(minutesUntil(towards(veiled), hot, 120)).toBe(Number.POSITIVE_INFINITY);
  });

  it('drifts back towards comfort faster than away from it, and hurts while Freezing', () => {
    const s = createSurvival(b);
    s.temperature = -b.temperature.limit;
    s.target = 0;
    stepGauges(s, b, idle);
    expect(s.temperature + b.temperature.limit).toBeCloseTo(b.temperature.backPerMin / MINUTE, 9);
    expect(s.health).toBeCloseTo(b.health.max - b.temperature.severeDamagePerMin / MINUTE, 9);
    expect(s.cause).toBe('cold');
    // Never past 0 on the way back: from there it drifts away at the slower rate.
    s.temperature = -0.001;
    s.target = 50;
    stepGauges(s, b, idle);
    expect(s.temperature).toBe(0);
    stepGauges(s, b, idle);
    expect(s.temperature).toBeCloseTo(b.temperature.awayPerMin / MINUTE, 9);
  });
});

describe('toxicity', () => {
  const marsh = climate('biome:fungal_marsh').toxicityPerMin!;
  const nauseous = (s: SurvivalState) => s.toxicity >= b.toxicity.nauseousAt;

  it('marsh: Nauseous at about 8.75 min by day; more than 40 min with a filter mask', () => {
    const minutes = minutesUntil((s) => (s.airToxicity = marsh.day), nauseous);
    expect(minutes).toBeCloseTo(b.toxicity.nauseousAt / marsh.day, 1);
    expect(Math.abs(minutes - 8.75)).toBeLessThanOrEqual(1);
    const mask = gearOf('item:filter_mask').airFilter;
    expect(minutesUntil((s) => (s.airToxicity = marsh.day * mask), nauseous)).toBeGreaterThan(40);
  });

  it('decays without a source, stops regeneration when Nauseous and hurts from 65', () => {
    const s = createSurvival(b);
    s.toxicity = 10;
    stepGauges(s, b, idle);
    expect(s.toxicity).toBeCloseTo(10 - b.toxicity.decayPerMin / MINUTE, 9);
    // Each value lies 1 above a threshold: the step's decay must not take it below.
    s.health = 50;
    s.toxicity = b.toxicity.nauseousAt + 1;
    stepGauges(s, b, idle);
    expect(s.health).toBe(50);
    s.toxicity = b.toxicity.harmAt + 1;
    stepGauges(s, b, idle);
    expect(s.health).toBeCloseTo(50 - b.toxicity.harmPerMin / MINUTE, 9);
    s.toxicity = b.toxicity.severeAt + 1;
    const before = s.health;
    stepGauges(s, b, idle);
    expect(before - s.health).toBeCloseTo(b.toxicity.severePerMin / MINUTE, 9);
    expect(s.cause).toBe('toxicity');
  });

  it('adds the contact of the blocks touched (foul water at the feet)', () => {
    const s = createSurvival(b);
    stepGauges(s, b, { ...idle, toxicity: 8, damage: 4 });
    expect(s.toxicity).toBeCloseTo(8 / MINUTE, 9);
    expect(s.health).toBeCloseTo(b.health.max - 4 / TICKS_PER_SECOND, 9);
    expect(s.cause).toBe('contact');
  });
});

describe('health, breath, falls and effects', () => {
  it('regenerates 0.4/s after 6 s without damage, for half a point of hunger each', () => {
    const s = createSurvival(b);
    s.health = 50;
    s.calmTicks = 0;
    for (let i = 0; i < b.health.regenDelaySec * TICKS_PER_SECOND - 1; i++) stepGauges(s, b, idle);
    expect(s.health).toBe(50);
    const hunger = s.hunger;
    stepGauges(s, b, idle);
    const healed = b.health.regenPerSec / TICKS_PER_SECOND;
    expect(s.health).toBeCloseTo(50 + healed, 9);
    expect(hunger - s.hunger).toBeCloseTo(b.hunger.perMin / MINUTE + healed / 2, 9);
    // Not while hungry, thirsty or Cold.
    for (const field of ['hunger', 'thirst'] as const) {
      const low = createSurvival(b);
      low.health = 50;
      low[field] = b.health.regenFedAt - 1;
      stepGauges(low, b, idle);
      expect(low.health).toBe(50);
    }
    const chilled = createSurvival(b);
    chilled.health = 50;
    chilled.temperature = -b.temperature.mildAt;
    chilled.target = chilled.temperature;
    stepGauges(chilled, b, idle);
    expect(chilled.health).toBe(50);
  });

  it('holds the breath 15 s under water, then drowns at 5/s', () => {
    const under = { ...idle, underwater: true };
    expect(
      minutesUntil(
        () => {},
        (s) => s.breath === 0,
        1,
        under,
      ) * 60,
    ).toBeCloseTo(b.breath.seconds, 1);
    const s = createSurvival(b);
    s.breath = 0;
    stepGauges(s, b, under);
    expect(s.health).toBeCloseTo(b.health.max - b.breath.drowningPerSec / TICKS_PER_SECOND, 9);
    expect(s.cause).toBe('drowning');
    stepGauges(s, b, idle);
    expect(s.breath).toBeCloseTo(b.breath.refillPerSec / TICKS_PER_SECOND, 9);
  });

  it('takes 39 ± 1 health for a 10-block fall, nothing up to 3.5 blocks', () => {
    expect(fallDamage(3.5, b)).toBe(0);
    expect(fallDamage(10, b)).toBeCloseTo(39, 6);
    const s = createTestSim({ seed: 'fall', worldType: 'flat', allowDebug: true });
    const player = s.sim.addPlayer(1, 2);
    s.step(30);
    expect(player.survival.health).toBe(b.health.max);
    s.host.send({ type: 'debug.teleport', x: 0.5, y: 75, z: 0.5 });
    s.step(60);
    expect(player.body.onGround).toBe(true);
    expect(b.health.max - player.survival.health).toBeGreaterThanOrEqual(38);
    expect(b.health.max - player.survival.health).toBeLessThanOrEqual(40);
    expect(player.survival.cause).toBe('fall');
  });

  it('counts timed effects down and drops them at 0', () => {
    const s = createSurvival(b);
    addEffect(s, 'weakened', 3);
    addEffect(s, 'untargeted', 1);
    addEffect(s, 'weakened', 2);
    expect(s.effects).toEqual([
      { key: 'weakened', ticks: 3 },
      { key: 'untargeted', ticks: 1 },
    ]);
    stepGauges(s, b, idle);
    expect(s.effects).toEqual([{ key: 'weakened', ticks: 2 }]);
    stepGauges(s, b, idle);
    stepGauges(s, b, idle);
    expect(s.effects).toEqual([]);
  });
});

describe('stamina and the gauges', () => {
  it('sets the gauges by debug command, clamped, and refuses unknown ones', () => {
    const s = createTestSim({ seed: 'set-stat', worldType: 'flat', allowDebug: true });
    const player = s.sim.addPlayer(1, 2);
    s.step(20);
    s.host.send({ type: 'debug.setStat', stat: 'temperature', value: -500 });
    s.host.send({ type: 'debug.setStat', stat: 'health', value: 12 });
    s.host.send({ type: 'debug.setStat', stat: 'mana' as DebugStat, value: 1 });
    s.step(1);
    expect(player.survival.temperature).toBeCloseTo(-b.temperature.limit, 1);
    // Freezing already bites.
    expect(player.survival.health).toBeCloseTo(12, 1);
    const rejected = s.events.filter((e) => e.type === 'rejected');
    expect(rejected).toMatchObject([{ command: 'debug.setStat', reason: 'invalid' }]);
  });

  it('caps stamina at 50 while starving and halves its regeneration while parched', () => {
    const s = createTestSim({ seed: 'stamina', worldType: 'flat', allowDebug: true });
    const player = s.sim.addPlayer(1, 2);
    s.step(30);
    s.host.send({ type: 'debug.setStat', stat: 'hunger', value: b.hunger.lowAt - 1 });
    s.step(2);
    expect(player.stamina).toBe(b.hunger.lowStaminaMax);
    s.host.send({ type: 'debug.setStat', stat: 'hunger', value: b.hunger.max });
    s.host.send({ type: 'debug.setStat', stat: 'stamina', value: 0 });
    s.host.send({ type: 'debug.setStat', stat: 'thirst', value: b.thirst.lowAt - 1 });
    // Resting for long: stamina comes back at once, for one second.
    s.step(TICKS_PER_SECOND);
    expect(player.stamina).toBeCloseTo(STAMINA.regenPerSecond * b.thirst.lowStaminaRegen, 6);
  });
});
