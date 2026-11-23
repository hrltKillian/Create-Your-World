import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../../../src/sim/clock.ts';
import {
  feltTemperature,
  heatAround,
  inCave,
  type ThermalInput,
} from '../../../src/sim/environment.ts';
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
  shelter: 'exposed',
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

  it('shades a covered player only in hot air, and gear never goes past comfort', () => {
    const c = b.climate;
    expect(feltTemperature(thermal({ shelter: 'covered' }), c)).toBe(20);
    const hot = thermal({ shelter: 'covered', dayC: 40 });
    expect(feltTemperature(hot, c)).toBe(40 - c.shadeC);
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
  it('chills an exposed player in the tundra at night: Cold within 3 min', () => {
    const s = biomeWorld('biome:tundra', 23);
    s.step(5400);
    expect(s.player.survival.shelter).toBe('exposed');
    expect(s.player.survival.temperature).toBeLessThanOrEqual(-b.temperature.mildAt);
    expect(thermalStatus(s.player.survival.temperature, b)).toBe(-1);
  });

  it('warms a player in a closed hut with a campfire in the tundra at night', () => {
    const s = biomeWorld('biome:tundra', 23);
    s.host.send({ type: 'debug.setStat', stat: 'temperature', value: -50 });
    const fill =
      (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => (state: string) =>
        s.host.send({ type: 'debug.fill', x0, y0, z0, x1, y1, z1, state });
    fill(-2, 65, -2, 2, 68, 2)('block:planks');
    fill(-1, 65, -1, 1, 67, 1)('block:air');
    fill(1, 65, 1, 1, 65, 1)('block:campfire[lit=1]');
    s.step(3 * MINUTE);
    expect(s.player.survival.shelter).toBe('enclosed');
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
