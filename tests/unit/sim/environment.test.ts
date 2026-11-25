import { describe, expect, it, vi } from 'vitest';
import { TICKS_PER_SECOND } from '../../../src/sim/clock.ts';
import {
  type Contact,
  feltTemperature,
  heatAround,
  inCave,
  type ThermalInput,
  touch,
} from '../../../src/sim/environment.ts';
import { createPlayer } from '../../../src/sim/player.ts';
import type { Simulation } from '../../../src/sim/Simulation.ts';
import { thermalStatus } from '../../../src/sim/survival.ts';
import { emptyWorld } from '../../helpers/flatWorld.ts';
import { litWorld, STONE } from '../../helpers/lightWorld.ts';
import { registry } from '../../helpers/registry.ts';
import { createTestSim } from '../../helpers/simHarness.ts';

const b = registry.pack.balance;
const MINUTE = 60 * TICKS_PER_SECOND;

const thermal = (fields: Partial<ThermalInput>): ThermalInput => ({
  dayC: 20,
  nightC: 20,
  day: 1,
  y: 64,
  cave: false,
  heat: 0,
  inWater: false,
  warmth: 0,
  cooling: 0,
  ...fields,
});

describe('thermal model', () => {
  it('cools with altitude and in water, and gives caves their own air', () => {
    const c = b.climate;
    const high = thermal({ y: c.altitudeFrom + 40 });
    expect(feltTemperature(high, c)).toBeCloseTo(20 - 40 * c.altitudePerBlock, 9);
    expect(feltTemperature(thermal({ inWater: true }), c)).toBe(20 - c.waterC);
    expect(feltTemperature(thermal({ cave: true, dayC: -30, nightC: -30 }), c)).toBe(c.caveC);
  });

  it('brings gear never past comfort', () => {
    const c = b.climate;
    const warm = thermal({ dayC: 5, warmth: 30 });
    expect(feltTemperature(warm, c)).toBe(c.comfortMinC);
    const cool = thermal({ dayC: 40, cooling: 30 });
    expect(feltTemperature(cool, c)).toBe(c.comfortMaxC);
  });

  it('adds the two strongest heat sources, each fading linearly past its radius', () => {
    const world = emptyWorld(1);
    const campfire = registry.stateId('block:campfire[lit=1]');
    const kiln = registry.stateId('block:kiln[facing4=n,lit=1]');
    const torch = registry.defaultState('block:torch');
    world.setBlock(0, 64, 0, campfire);
    world.setBlock(2, 64, 0, kiln);
    world.setBlock(0, 64, 2, torch);
    world.setBlock(-1, 64, 0, registry.stateId('block:campfire[lit=0]'));
    const at = { x: 0.5, y: 64.5, z: 1.5 };
    const heat = (state: number, x: number, z: number) => {
      const d = Math.hypot(x + 0.5 - at.x, 0, z + 0.5 - at.z);
      const reach = registry.tables.heatRadius[state]! + 1;
      return registry.tables.heat[state]! * Math.max(0, 1 - d / reach);
    };
    const sources = [heat(campfire, 0, 0), heat(kiln, 2, 0), heat(torch, 0, 2)].sort(
      (p, q) => q - p,
    );
    expect(sources[2]).toBeGreaterThan(0);
    const sum = heatAround(world, registry.tables, at.x, at.y, at.z, b.climate.heatSources);
    expect(sum).toBeCloseTo(sources[0]! + sources[1]!, 9);
    expect(heatAround(world, registry.tables, 20.5, 64.5, 20.5, 2)).toBe(0);
  });

  it('looks a column up once per block column of the heat scan, and once for the feet', () => {
    const world = emptyWorld(1);
    world.setBlock(0, 64, 0, registry.stateId('block:campfire[lit=1]'));
    const lookups = vi.spyOn(world, 'getColumn');
    const heat = heatAround(world, registry.tables, 0.5, 64.5, 1.5, b.climate.heatSources);
    expect(heat).toBeGreaterThan(0);
    // The scan is a cube of side 2r + 1 (r: the largest heat radius + 1).
    let r = 0;
    for (let s = 0; s < registry.tables.stateCount; s++)
      r = Math.max(r, registry.tables.heatRadius[s]! + 1);
    expect(lookups.mock.calls.length).toBe((2 * r + 1) ** 2);
    lookups.mockClear();
    const player = createPlayer(1, 0.5, 64, 0.5, 2, b);
    player.body.onGround = true;
    const contact: Contact = { toxicity: 0, damage: 0, ignites: false, douses: false };
    touch(registry, world, player, contact);
    expect(lookups.mock.calls.length).toBe(1);
  });

  it('finds caves: no sky at the head, deep enough under the surface', () => {
    const { world } = litWorld(1, (w) => {
      for (let x = -3; x <= 3; x++)
        for (let z = -3; z <= 3; z++) for (let y = 60; y <= 80; y++) w.setBlock(x, y, z, STONE);
      w.setBlock(0, 64, 0, registry.air);
      w.setBlock(0, 65, 0, registry.air);
      w.getColumn(0, 0)!.heightmap.fill(81);
    });
    expect(inCave(world, 0, 65, 0, b.climate.caveDepth)).toBe(true);
    expect(inCave(world, 0, 76, 0, b.climate.caveDepth)).toBe(false);
    expect(inCave(world, 10, 82, 10, b.climate.caveDepth)).toBe(false);
  });
});

/** A flat world whose loaded columns all lie in `biome`, the clock frozen at `hour`. */
function biomeWorld(biome: string, hour: number) {
  const s = createTestSim({ seed: 'climate', worldType: 'flat', allowDebug: true });
  const player = s.sim.addPlayer(1, 2);
  s.step(20);
  setBiome(s.sim, biome);
  s.host.send({ type: 'debug.setTime', hours: hour });
  s.host.send({ type: 'debug.freezeTime', frozen: true });
  s.step(1);
  return { ...s, player };
}

function setBiome(sim: Simulation, key: string): void {
  const index = sim.ctx.biomeDefs.findIndex((biome) => biome.key === key);
  for (const column of sim.world.columns.values()) column.biomes.fill(index);
}

describe('environment in the simulation', () => {
  it('chills a player in the tundra at night past the first cold band within 3 min', () => {
    const s = biomeWorld('biome:tundra', 23);
    s.step(5400);
    expect(s.player.survival.temperature).toBeLessThanOrEqual(-b.temperature.mildAt);
    expect(thermalStatus(s.player.survival.temperature, b)).toBe(-1);
  });

  it('warms a player between two campfires in the open tundra at night (no shelter)', () => {
    const s = biomeWorld('biome:tundra', 23);
    s.host.send({ type: 'debug.setStat', stat: 'temperature', value: -50 });
    for (const x of [-1, 1])
      s.host.send({
        type: 'debug.fill',
        ...{ x0: x, y0: 65, z0: 0, x1: x, y1: 65, z1: 0 },
        state: 'block:campfire[lit=1]',
      });
    s.step(3 * MINUTE);
    expect(s.player.survival.ambient).toBeGreaterThan(b.climate.comfortMinC);
    expect(s.player.survival.temperature).toBeGreaterThanOrEqual(-10);
  });

  it('poisons a player in the marsh at noon: 20 ± 2 in 5 min, 3.3 at most with a mask', () => {
    for (const mask of [false, true]) {
      const s = biomeWorld('biome:fungal_marsh', 12);
      if (mask) s.player.equipment[1] = { item: 'item:filter_mask', count: 1, durability: 3600 };
      s.step(9000);
      const toxicity = s.player.survival.toxicity;
      if (mask) expect(toxicity).toBeLessThanOrEqual(3.3);
      else expect(Math.abs(toxicity - 20)).toBeLessThanOrEqual(2);
    }
  });

  it('poisons feet in foul water, unless waterproof boots keep it out', () => {
    for (const boots of [false, true]) {
      const s = biomeWorld('biome:meadow', 12);
      if (boots) s.player.equipment[4] = { item: 'item:waxed_boots', count: 1, durability: 300 };
      s.host.send({
        type: 'debug.fill',
        ...{ x0: -2, y0: 65, z0: -2, x1: 2, y1: 65, z1: 2 },
        state: 'block:foul_water',
      });
      s.step(MINUTE);
      const contact = registry.blockDef(registry.defaultState('block:foul_water')).contact!;
      if (boots) expect(s.player.survival.toxicity).toBe(0);
      else expect(s.player.survival.toxicity).toBeCloseTo(contact.toxicityPerMin!, 1);
    }
  });
});
