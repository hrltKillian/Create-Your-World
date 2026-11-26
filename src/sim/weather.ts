import type { BiomeDef, WeatherBalance } from '../content/schema.ts';
import { hash32 } from '../core/hash.ts';
import { ticksOf } from './clock.ts';
import type { SimEvent } from './events.ts';
import type { Simulation } from './Simulation.ts';
import { daylightAt, hourOf } from './time.ts';

/*
 * The weather (plan v3 « M34 »): the world's time is cut into spells of `weather.spellSeconds`,
 * each of one kind drawn from the seed with the balance's weights (the first `clearSpells` of a
 * world clear). A pure function of the seed and the tick: nothing to save, and a station catching
 * up knows the rain of any past tick. `debug.setWeather` holds a kind for a while (not saved). What
 * falls in wet weather is the biome's (`BiomeDef.precipitation`: rain, snow or nothing); it falls
 * on what has no block above it. Rain and snow chill and put a fire out (environment.ts,
 * survival.ts), clouds dim the sky's light (spawns, light-shy creatures, the shaders), a storm
 * spawns more hostiles and throws lightning near the players (events for the client).
 */

export const WEATHER_KINDS = ['clear', 'rain', 'storm', 'fog'] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

/** A kind held by `debug.setWeather` until a tick. */
export interface WeatherOverride {
  readonly kind: WeatherKind;
  readonly until: number;
}

const SPELL_SALT = 0x77656174;
const STRIKE_SALT = 0x626f6c74;
/** Lightning strikes this far around a player at most (blocks, each axis). */
const STRIKE_REACH = 48;

/** The kind of the spell a tick falls in (the seed's draw). */
export function weatherAt(seedHash: number, tick: number, w: WeatherBalance): WeatherKind {
  const spell = Math.floor(tick / ticksOf(w.spellSeconds));
  if (spell < w.clearSpells) return 'clear';
  const { clear, rain, storm, fog } = w.weights;
  let left = (hash32(seedHash, spell, SPELL_SALT) % 1000) * ((clear + rain + storm + fog) / 1000);
  for (const kind of WEATHER_KINDS) {
    left -= w.weights[kind];
    if (left < 0) return kind;
  }
  return 'clear';
}

/** The weather at a tick of a simulation: its debug override while it holds, else the draw. */
export function weatherOf(sim: Simulation, tick = sim.tick): WeatherKind {
  const held = sim.weatherOverride;
  if (held && tick < held.until) return held.kind;
  return weatherAt(sim.ctx.seedHash, tick, sim.registry.pack.balance.weather);
}

/** Whether a kind drops rain or snow (where the biome lets it fall). */
export function isWet(kind: WeatherKind): boolean {
  return kind === 'rain' || kind === 'storm';
}

/** What falls in a biome in wet weather. */
export function precipitationOf(biome: BiomeDef | undefined): 'rain' | 'snow' | 'none' {
  return biome?.precipitation ?? 'rain';
}

/**
 * What falls on a cell now (rain, snow or none): wet weather, a biome where it falls, nothing
 * above the cell (its column's heightmap at or below it).
 */
export function fallingOn(sim: Simulation, x: number, y: number, z: number, tick = sim.tick) {
  if (!isWet(weatherOf(sim, tick))) return 'none';
  return fallsOn(sim, x, y, z);
}

/** What would fall on a cell in wet weather: the biome's precipitation, under the open sky. */
export function fallsOn(sim: Simulation, x: number, y: number, z: number) {
  const top = sim.world.heightAt(x, z);
  if (top < 0 || top > y) return 'none';
  const index = sim.world.biomeAt(x, z);
  return precipitationOf(index < 0 ? undefined : sim.ctx.biomeDefs[index]);
}

/** Share of the sky's light left under a kind's clouds. */
export function dimOf(kind: WeatherKind, w: WeatherBalance): number {
  return kind === 'clear' ? 1 : w.dim[kind];
}

/** The sky's light factor now: the hour's daylight under the weather's clouds. */
export function skyLight(sim: Simulation): number {
  const w = sim.registry.pack.balance.weather;
  return daylightAt(hourOf(sim.time.ticks)) * dimOf(weatherOf(sim), w);
}

/**
 * Tick step 3 (after the clock): in a storm, lightning strikes near each player now and then
 * (`lightning`: the client's flash and thunder), on average every `weather.lightningSeconds`.
 */
export function stepWeather(sim: Simulation, out: SimEvent[]): void {
  if (weatherOf(sim) !== 'storm') return;
  const mean = ticksOf(sim.registry.pack.balance.weather.lightningSeconds);
  for (const player of sim.players.values()) {
    const h = hash32(sim.ctx.seedHash, sim.tick, player.playerId, STRIKE_SALT);
    if (h % mean !== 0) continue;
    const span = 2 * STRIKE_REACH + 1;
    const x = Math.floor(player.body.x) - STRIKE_REACH + (hash32(h, 1) % span);
    const z = Math.floor(player.body.z) - STRIKE_REACH + (hash32(h, 2) % span);
    out.push({ type: 'lightning', x, z });
  }
}

/** `debug.setWeather`: holds a kind for `seconds` (null: back to the seed's draw). */
export function holdWeather(sim: Simulation, kind: WeatherKind | null, seconds: number): boolean {
  if (kind === null) {
    sim.weatherOverride = null;
    return true;
  }
  if (!WEATHER_KINDS.includes(kind) || !(seconds > 0)) return false;
  sim.weatherOverride = { kind, until: sim.tick + ticksOf(seconds) };
  return true;
}
