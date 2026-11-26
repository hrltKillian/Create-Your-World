import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND, ticksOf } from '../../../src/sim/clock.ts';
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
import {
  createSurvival,
  type DeathCause,
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
function thermalIn(biome: string, day: number, gear = gearOf()) {
  const { dayC, nightC } = climate(biome).climate;
  const input: ThermalInput = {
    dayC,
    nightC,
    day,
    y: 64,
    cave: false,
    heat: 0,
    inWater: false,
    chill: 0,
    warmth: gear.warmth,
    cooling: gear.cooling,
  };
  return input;
}

const idle: Exposure = {
  sprinting: false,
  metabolism: 1,
  underwater: false,
  toxicity: 0,
  damage: 0,
  ignites: false,
  burnCause: 'fire',
  douses: false,
  fireTicks: 0,
};

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
  s.target = targetTemperature(feltTemperature(input, b.climate), b, 0);
};

const cold = (s: SurvivalState) => thermalStatus(s.temperature, b) <= -1;
const freezing = (s: SurvivalState) => thermalStatus(s.temperature, b) === -2;
const hot = (s: SurvivalState) => thermalStatus(s.temperature, b) >= 1;
const overheating = (s: SurvivalState) => thermalStatus(s.temperature, b) === 2;

describe('hunger, thirst and an idle death', () => {
  it('empties thirst in 16 min; standing still costs no hunger (the reference game’s)', () => {
    expect(
      minutesUntil(
        () => {},
        (s) => s.hunger < b.hunger.max,
      ),
    ).toBe(Number.POSITIVE_INFINITY);
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

  it('spends exhaustion on the hidden saturation first, then on hunger, a step at a time', () => {
    const h = b.hunger;
    const s = createSurvival(b);
    expect(s.saturation).toBe(h.startSaturation);
    s.exhaustion = h.exhaustionPerStep * 3 + 1;
    stepGauges(s, b, idle);
    expect(s.saturation).toBe(h.startSaturation - 3 * h.step);
    expect(s.exhaustion).toBeCloseTo(1, 9);
    expect(s.hunger).toBe(h.max);
    // Saturation gone: hunger pays.
    s.saturation = 0;
    s.exhaustion = h.exhaustionPerStep * 2;
    stepGauges(s, b, idle);
    expect(s.hunger).toBe(h.max - 2 * h.step);
    // The metabolism skill makes each step cost less.
    s.exhaustion = h.exhaustionPerStep;
    stepGauges(s, b, { ...idle, metabolism: 0.5 });
    expect(s.hunger).toBe(h.max - 2.5 * h.step);
  });

  it('starves at 0: a blow every starveSeconds', () => {
    const s = createSurvival(b);
    s.hunger = 0;
    s.saturation = 0;
    const ticks = ticksOf(b.hunger.starveSeconds);
    for (let i = 0; i < ticks - 1; i++) stepGauges(s, b, idle);
    expect(s.health).toBe(b.health.max);
    stepGauges(s, b, idle);
    expect(s.health).toBe(b.health.max - b.hunger.starveDamage);
    expect(s.cause).toBe('starvation');
  });
});

describe('temperature', () => {
  it('locks the thermal examples: tundra at night by a fire giving 20 °C is 4 °C, target −30', () => {
    expect(dayFactor(NIGHT_DAYLIGHT)).toBe(0);
    expect(dayFactor(1)).toBe(1);
    const fire = { ...thermalIn('biome:tundra', 0), heat: 20 };
    expect(feltTemperature(fire, b.climate)).toBeCloseTo(4, 6);
    expect(targetTemperature(feltTemperature(fire, b.climate), b, 0)).toBeCloseTo(-30, 6);
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
    expect(targetTemperature(feltTemperature(day, b.climate), b, 0)).toBe(0);
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
  const harmful = (s: SurvivalState) => s.toxicity >= b.toxicity.harmAt;

  it('marsh: harmful at about 16 min by day; more than 40 min with a filter mask', () => {
    const minutes = minutesUntil((s) => (s.airToxicity = marsh.day), harmful);
    expect(minutes).toBeCloseTo(b.toxicity.harmAt / marsh.day, 1);
    const mask = gearOf('item:filter_mask').airFilter;
    expect(minutesUntil((s) => (s.airToxicity = marsh.day * mask), harmful)).toBeGreaterThan(40);
  });

  it('decays without a source, never stops regeneration and hurts from harmAt', () => {
    const s = createSurvival(b);
    s.toxicity = 10;
    stepGauges(s, b, idle);
    expect(s.toxicity).toBeCloseTo(10 - b.toxicity.decayPerMin / MINUTE, 9);
    // Each value lies 1 above a threshold: the step's decay must not take it below. Below harmAt
    // a fed player heals as usual (no status in the way, plan v3 « M20 »).
    s.health = 50;
    s.toxicity = b.toxicity.harmAt - 1;
    s.foodTicks = 0;
    for (let i = 0; i < ticksOf(b.health.fastRegenSeconds); i++) stepGauges(s, b, idle);
    expect(s.health).toBe(50 + b.health.regenAmount);
    s.health = 50;
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
  it('regenerates the reference game’s way: fast while full and saturated, else every 4 s', () => {
    const h = b.health;
    // Full hunger with saturation left: regenAmount every fastRegenSeconds, tiring the player.
    const s = createSurvival(b);
    s.health = 50;
    const fast = ticksOf(h.fastRegenSeconds);
    for (let i = 0; i < fast - 1; i++) stepGauges(s, b, idle);
    expect(s.health).toBe(50);
    stepGauges(s, b, idle);
    expect(s.health).toBe(50 + h.regenAmount);
    expect(s.exhaustion).toBeCloseTo(h.regenExhaustion, 9);
    // From regenHungerAt without saturation: every regenSeconds.
    const slow = createSurvival(b);
    slow.health = 50;
    slow.hunger = h.regenHungerAt;
    slow.saturation = 0;
    for (let i = 0; i < ticksOf(h.regenSeconds) - 1; i++) stepGauges(slow, b, idle);
    expect(slow.health).toBe(50);
    stepGauges(slow, b, idle);
    expect(slow.health).toBe(50 + h.regenAmount);
    // Not below regenHungerAt, nor without water; the cold band changes nothing (« M20 »).
    for (const [field, value] of [
      ['hunger', h.regenHungerAt - 1],
      ['thirst', h.regenThirstAt - 1],
    ] as const) {
      const low = createSurvival(b);
      low.health = 50;
      low.saturation = 0;
      low[field] = value;
      for (let i = 0; i < ticksOf(h.regenSeconds) * 2; i++) stepGauges(low, b, idle);
      expect(low.health).toBe(50);
    }
    const chilled = createSurvival(b);
    chilled.health = 50;
    chilled.temperature = -b.temperature.mildAt;
    chilled.target = chilled.temperature;
    for (let i = 0; i < fast; i++) stepGauges(chilled, b, idle);
    expect(chilled.health).toBe(50 + h.regenAmount);
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
    // No healing meanwhile: no saturation, hunger below regenHungerAt.
    player.survival.saturation = 0;
    player.survival.hunger = b.health.regenHungerAt - 1;
    s.step(60);
    expect(player.body.onGround).toBe(true);
    expect(b.health.max - player.survival.health).toBeGreaterThanOrEqual(38);
    expect(b.health.max - player.survival.health).toBeLessThanOrEqual(40);
    expect(player.survival.cause).toBe('fall');
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

  it('kills for a cause and makes a player immune to damage by debug command', () => {
    const s = createTestSim({ seed: 'kill-god', worldType: 'flat', allowDebug: true });
    const player = s.sim.addPlayer(1, 2);
    s.step(20);
    s.host.send({ type: 'debug.god', on: true });
    s.host.send({ type: 'debug.setStat', stat: 'temperature', value: -b.temperature.limit });
    s.step(10 * TICKS_PER_SECOND);
    // Freezing bites no one immune.
    expect(player.survival.health).toBe(b.health.max);
    s.events.length = 0;
    s.host.send({ type: 'debug.kill', cause: 'drowning' });
    s.host.send({ type: 'debug.kill', cause: 'boredom' as DeathCause });
    s.host.send({ type: 'debug.god', on: 'yes' as unknown as boolean });
    s.step(1);
    expect(player.survival).toMatchObject({ health: 0, cause: 'drowning', dead: true, god: true });
    expect(s.events.filter((e) => e.type === 'died')).toMatchObject([{ cause: 'drowning' }]);
    const rejected = s.events.filter((e) => e.type === 'rejected');
    expect(rejected).toMatchObject([
      { command: 'debug.kill', reason: 'invalid' },
      { command: 'debug.god', reason: 'invalid' },
    ]);
    // A respawn keeps the immunity; mortal again, the cold bites.
    s.host.send({ type: 'player.respawn' });
    s.host.send({ type: 'debug.setStat', stat: 'temperature', value: -b.temperature.limit });
    s.step(TICKS_PER_SECOND);
    expect(player.survival).toMatchObject({ health: b.respawn.health, god: true });
    s.host.send({ type: 'debug.god', on: false });
    s.step(TICKS_PER_SECOND);
    expect(player.survival.health).toBeLessThan(b.respawn.health);
  });

  it('leaves stamina alone while hungry or thirsty: no cap, no slower regeneration', () => {
    const s = createTestSim({ seed: 'stamina', worldType: 'flat', allowDebug: true });
    const player = s.sim.addPlayer(1, 2);
    s.step(30);
    s.host.send({ type: 'debug.setStat', stat: 'hunger', value: b.hunger.lowAt - 1 });
    s.step(2);
    expect(player.stamina).toBe(STAMINA.max);
    s.host.send({ type: 'debug.setStat', stat: 'stamina', value: 0 });
    s.host.send({ type: 'debug.setStat', stat: 'thirst', value: b.thirst.lowAt - 1 });
    // Resting for long: stamina comes back at once, for one second.
    s.step(TICKS_PER_SECOND);
    expect(player.stamina).toBeCloseTo(STAMINA.regenPerSecond, 6);
  });

  it('hurts with the cold only beyond severeAt, and the cold costs no extra hunger', () => {
    const s = createSurvival(b);
    s.temperature = -b.temperature.severeAt + 1;
    s.target = s.temperature;
    s.health = 50;
    for (let i = 0; i < ticksOf(b.health.fastRegenSeconds); i++) stepGauges(s, b, idle);
    // A fed player heals even in the cold band, and the cold costs nothing more than the heal.
    expect(s.health).toBe(50 + b.health.regenAmount);
    expect(s.hunger).toBe(b.hunger.max);
    expect(s.exhaustion).toBeCloseTo(b.health.regenExhaustion, 9);
    s.temperature = -b.temperature.severeAt - 1;
    s.target = s.temperature;
    const before = s.health;
    stepGauges(s, b, idle);
    expect(before - s.health).toBeCloseTo(b.temperature.severeDamagePerMin / MINUTE, 9);
  });
});
