import { describe, expect, it } from 'vitest';
import { fuelSlotOf, outputSlotOf } from '../../../src/content/crafting.ts';
import type { StationEntity } from '../../../src/sim/blockEntities.ts';
import { ticksOf } from '../../../src/sim/clock.ts';
import { sampleEnvironment } from '../../../src/sim/environment.ts';
import { daylightAt, hourOf } from '../../../src/sim/time.ts';
import {
  fallingOn,
  skyLight,
  WEATHER_KINDS,
  weatherAt,
  weatherOf,
} from '../../../src/sim/weather.ts';
import { cellKey } from '../../../src/world/coords.ts';
import { registry } from '../../helpers/registry.ts';
import { eventsOf, playerTestSim } from '../../helpers/simHarness.ts';

/*
 * The weather (plan v3 « M34 »): spells drawn from the seed (pure: any tick), held by
 * `debug.setWeather`; rain or snow falls by biome on what has no block above; it chills and puts a
 * fire out; clouds dim the sky's light; a storm throws lightning; a rain barrel under the sky fills
 * empty containers. Numbers from the pack's balance.
 */

const w = registry.pack.balance.weather;
const SPELL = ticksOf(w.spellSeconds);

function outside() {
  const s = playerTestSim({ seed: 'weather' });
  const hold = (weather: string | null, seconds = 600) =>
    s.send({ type: 'debug.setWeather', weather: weather as never, seconds });
  /** Sets the biome of the player's column to the pack's one with this precipitation. */
  const biome = (precipitation: 'rain' | 'snow' | 'none') => {
    const def = s.sim.ctx.biomeDefs.findIndex((b) => (b.precipitation ?? 'rain') === precipitation);
    s.sim.world.getColumn(0, 0)!.biomes.fill(def);
  };
  return { ...s, hold, biome };
}

describe('weather', () => {
  it('is drawn per spell from the seed, the first spells clear, the kinds near their weights', () => {
    for (let spell = 0; spell < w.clearSpells; spell++)
      expect(weatherAt(1234, spell * SPELL + 5, w)).toBe('clear');
    const counts: Record<string, number> = { clear: 0, rain: 0, storm: 0, fog: 0 };
    const spells = 4000;
    for (let spell = w.clearSpells; spell < w.clearSpells + spells; spell++) {
      const kind = weatherAt(99, spell * SPELL, w);
      // The same all along a spell.
      expect(weatherAt(99, spell * SPELL + SPELL - 1, w)).toBe(kind);
      counts[kind]!++;
    }
    const total = Object.values(w.weights).reduce((a, b) => a + b, 0);
    for (const kind of WEATHER_KINDS)
      expect(counts[kind]! / spells).toBeCloseTo(w.weights[kind] / total, 1);
  });

  it('is held by debug.setWeather for its seconds, then back to the draw', () => {
    const s = outside();
    s.hold('storm', 2);
    expect(weatherOf(s.sim)).toBe('storm');
    s.tick(ticksOf(2));
    expect(weatherOf(s.sim)).toBe(weatherAt(s.sim.ctx.seedHash, s.sim.tick, w));
    const hail = s.send({ type: 'debug.setWeather', weather: 'hail' as never, seconds: 1 });
    expect(eventsOf(hail, 'rejected')).toHaveLength(1);
  });

  it('falls by biome on what has no block above: rain, snow or nothing', () => {
    const s = outside();
    const head = 66;
    expect(fallingOn(s.sim, 0, head, 0)).toBe('none');
    s.hold('rain');
    s.biome('rain');
    expect(fallingOn(s.sim, 0, head, 0)).toBe('rain');
    s.biome('snow');
    expect(fallingOn(s.sim, 0, head, 0)).toBe('snow');
    s.biome('none');
    expect(fallingOn(s.sim, 0, head, 0)).toBe('none');
    s.biome('rain');
    s.put(0, 70, 0, 'block:stone');
    expect(fallingOn(s.sim, 0, head, 0)).toBe('none');
  });

  it('chills a player out in the rain and puts a fire out', () => {
    const s = outside();
    s.biome('rain');
    sampleEnvironment(s.sim, s.player);
    const dry = s.player.survival.ambient;
    s.hold('rain');
    sampleEnvironment(s.sim, s.player);
    expect(s.player.survival.ambient).toBeCloseTo(dry - w.rainChillC, 6);
    s.player.survival.burnTicks = 100;
    s.tick(1);
    expect(s.player.survival.burnTicks).toBe(0);
  });

  it('dims the sky under clouds, and a storm throws lightning near the player', () => {
    const s = outside();
    const day = daylightAt(hourOf(s.sim.time.ticks));
    expect(skyLight(s.sim)).toBeCloseTo(day, 9);
    s.hold('storm');
    expect(skyLight(s.sim)).toBeCloseTo(day * w.dim.storm, 9);
    s.events.length = 0;
    s.tick(ticksOf(w.lightningSeconds) * 6);
    const strikes = eventsOf(s.events, 'lightning');
    expect(strikes.length).toBeGreaterThan(0);
    for (const e of strikes) expect(Math.max(Math.abs(e.x), Math.abs(e.z))).toBeLessThanOrEqual(49);
  });

  it('fills an empty flask in a rain barrel under the sky, never in dry weather or under a roof', () => {
    const s = outside();
    s.biome('rain');
    s.put(2, 65, 0, 'block:rain_barrel');
    s.put(2, 65, 2, 'block:rain_barrel');
    s.put(2, 66, 2, 'block:planks');
    const def = registry.crafting.station('station:rain_barrel')!;
    // Opening a barrel makes its block entity.
    const barrel = (z: number) => {
      s.send({ type: 'debug.open', x: 2, y: 65, z }, { type: 'screen.close' });
      return s.sim.blockEntities.get(cellKey(2, 65, z)) as StationEntity;
    };
    const open = barrel(0);
    const roofed = barrel(2);
    for (const b of [open, roofed]) b.slots[0] = { item: 'item:flask_empty', count: 1 };
    const out = outputSlotOf(def);
    expect(fuelSlotOf(def)).toBe(-1);
    s.tick(ticksOf(31));
    expect(open.slots[out]).toBeNull();
    s.hold('rain');
    s.tick(ticksOf(31));
    expect(open.slots[out]).toMatchObject({ item: 'item:flask_boiled', count: 1 });
    expect(roofed.slots[out]).toBeNull();
  });
});
