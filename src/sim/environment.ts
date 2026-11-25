import type { RawTables, Registry } from '../content/registry.ts';
import type { BalanceDef, BiomeDef, ClimateBalance } from '../content/schema.ts';
import { toColumn } from '../world/coords.ts';
import { skyOf } from '../world/light.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import type { Inventory } from './inventory.ts';
import { eyeHeight, PHYSICS } from './physics.ts';
import type { PlayerState } from './player.ts';
import { comfortBonus } from './progression.ts';
import type { Simulation } from './Simulation.ts';
import { daylightAt, hourOf, NIGHT_DAYLIGHT } from './time.ts';

/*
 * What the world does to a player (docs « Survie »): the thermal model, the toxicity of the air,
 * worn gear and the blocks the body touches. `sampleEnvironment` runs every few ticks
 * (`stepSurvival`); `touch` every tick. Module scratch only: nothing is allocated per call.
 */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Thermal model step 1: 0 at night, 1 by day, so the biomes' night values are really reached. */
export function dayFactor(daylight: number): number {
  return Math.min(1, Math.max(0, (daylight - NIGHT_DAYLIGHT) / (1 - NIGHT_DAYLIGHT)));
}

/** What the thermal model reads about a player's surroundings. */
export interface ThermalInput {
  /** The biome's climate (°C). */
  dayC: number;
  nightC: number;
  /** Thermal model step 1 (`dayFactor`). */
  day: number;
  /** Feet height (altitude cooling). */
  y: number;
  cave: boolean;
  /** °C from the strongest heat sources around. */
  heat: number;
  inWater: boolean;
  /** Worn gear (°C). */
  warmth: number;
  cooling: number;
}

/** Thermal model steps 2–6: the temperature a player feels (°C). */
export function feltTemperature(input: Readonly<ThermalInput>, c: ClimateBalance): number {
  let t = input.cave
    ? c.caveC
    : lerp(input.nightC, input.dayC, input.day) -
      c.altitudePerBlock * Math.max(0, input.y - c.altitudeFrom);
  t += input.heat;
  if (input.inWater) t -= c.waterC;
  // Gear brings the air back towards comfort, never past it.
  if (t < c.comfortMinC) t = Math.min(c.comfortMinC, t + input.warmth);
  else if (t > c.comfortMaxC) t = Math.max(c.comfortMaxC, t - input.cooling);
  return t;
}

/**
 * Thermal model step 7: where the temperature gauge drifts to (0 within the comfort range, widened
 * by `bonus` °C on each side: the resistance skill).
 */
export function targetTemperature(felt: number, b: BalanceDef, bonus: number): number {
  const c = b.climate;
  const limit = b.temperature.limit;
  const low = c.comfortMinC - bonus;
  const high = c.comfortMaxC + bonus;
  if (felt < low) return -Math.min(limit, c.targetPerDegree * (low - felt));
  if (felt > high) return Math.min(limit, c.targetPerDegree * (felt - high));
  return 0;
}

/** Totals of the worn items (`WearDef`). */
export interface Gear {
  /** Armour value (combat, M10; the Bag shows it). */
  armor: number;
  warmth: number;
  cooling: number;
  /** Factor on the toxicity of the air (1 without a filter). */
  airFilter: number;
  /** Foul water at the feet is harmless. */
  waterproof: boolean;
}

/** Adds up the effects of the worn items into `out`. */
export function wornGear(registry: Registry, equipment: Inventory, out: Gear): Gear {
  out.armor = 0;
  out.warmth = 0;
  out.cooling = 0;
  out.airFilter = 1;
  out.waterproof = false;
  for (let i = 0; i < equipment.length; i++) {
    const stack = equipment[i];
    const wear = stack ? registry.item(stack.item)?.wear : undefined;
    if (!wear) continue;
    out.armor += wear.armor ?? 0;
    out.warmth += wear.warmth ?? 0;
    out.cooling += wear.cooling ?? 0;
    out.airFilter *= wear.airFilter ?? 1;
    out.waterproof ||= wear.waterproof === true;
  }
  return out;
}

/** Reach of the heat scan around a player: the largest heat radius + 1, cached per table. */
let radiusOf: RawTables | null = null;
let scanRadius = 0;
/** The strongest heat contributions found by a scan, largest first. */
let strongest = new Float64Array(0);

/**
 * Thermal model step 4: the sum of the `sources` strongest heat sources around a point, each one
 * fading linearly from its °C at the block's centre to 0 one block past its radius (so every block
 * within the radius warms).
 */
export function heatAround(
  world: VoxelWorld,
  tables: RawTables,
  x: number,
  y: number,
  z: number,
  sources: number,
): number {
  if (radiusOf !== tables) {
    radiusOf = tables;
    scanRadius = 0;
    for (let s = 0; s < tables.stateCount; s++)
      scanRadius = Math.max(scanRadius, tables.heatRadius[s]! + 1);
  }
  if (strongest.length < sources) strongest = new Float64Array(sources);
  strongest.fill(0, 0, sources);
  const bx = Math.floor(x);
  const by = Math.floor(y);
  const bz = Math.floor(z);
  const r = scanRadius;
  for (let cx = bx - r; cx <= bx + r; cx++) {
    for (let cz = bz - r; cz <= bz + r; cz++) {
      // One column lookup per block column, not per voxel.
      const column = world.getColumn(toColumn(cx), toColumn(cz));
      for (let cy = by - r; cy <= by + r; cy++) {
        const state = world.blockIn(column, cx, cy, cz);
        const radius = tables.heatRadius[state]!;
        if (radius === 0) continue;
        const dx = cx + 0.5 - x;
        const dy = cy + 0.5 - y;
        const dz = cz + 0.5 - z;
        const fade = 1 - Math.sqrt(dx * dx + dy * dy + dz * dz) / (radius + 1);
        const heat = tables.heat[state]! * fade;
        // Insertion into the sorted list of the strongest ones.
        for (let i = 0; i < sources; i++) {
          if (heat <= strongest[i]!) continue;
          strongest.copyWithin(i + 1, i, sources - 1);
          strongest[i] = heat;
          break;
        }
      }
    }
  }
  let total = 0;
  for (let i = 0; i < sources; i++) total += strongest[i]!;
  return total;
}

/** Caves (thermal model step 2): no sky light at the head, `depth` blocks or more underground. */
export function inCave(
  world: VoxelWorld,
  x: number,
  head: number,
  z: number,
  depth: number,
): boolean {
  const top = world.heightAt(x, z);
  if (top < 0 || skyOf(world.getLight(x, head, z)) > 0) return false;
  return top - head >= depth;
}

/** The biome of a loaded block column (undefined outside the loaded world). */
export function biomeAt(sim: Simulation, x: number, z: number): BiomeDef | undefined {
  const index = sim.world.biomeAt(x, z);
  return index < 0 ? undefined : sim.ctx.biomeDefs[index];
}

const thermal: ThermalInput = {
  dayC: 0,
  nightC: 0,
  day: 0,
  y: 0,
  cave: false,
  heat: 0,
  inWater: false,
  warmth: 0,
  cooling: 0,
};
const gear: Gear = { armor: 0, warmth: 0, cooling: 0, airFilter: 1, waterproof: false };

/**
 * Samples a player's surroundings into its survival state: the felt temperature and its target,
 * and the toxicity of the air (the biome's, by day or night, lowered by a filter mask). Returns false, leaving them as they were, outside the loaded world.
 */
export function sampleEnvironment(sim: Simulation, player: PlayerState): boolean {
  const body = player.body;
  const x = Math.floor(body.x);
  const z = Math.floor(body.z);
  const biome = biomeAt(sim, x, z);
  if (!biome) return false;
  const { registry, world } = sim;
  const b = registry.pack.balance;
  const s = player.survival;
  const head = Math.floor(body.y + eyeHeight(body));
  wornGear(registry, player.equipment, gear);
  const day = dayFactor(daylightAt(hourOf(sim.time.ticks)));
  thermal.dayC = biome.climate.dayC;
  thermal.nightC = biome.climate.nightC;
  thermal.day = day;
  thermal.y = body.y;
  thermal.cave = inCave(world, x, head, z, b.climate.caveDepth);
  const middle = body.y + PHYSICS.height / 2;
  thermal.heat = heatAround(world, registry.tables, body.x, middle, body.z, b.climate.heatSources);
  thermal.inWater = body.inWater;
  thermal.warmth = gear.warmth;
  thermal.cooling = gear.cooling;
  s.ambient = feltTemperature(thermal, b.climate);
  s.target = targetTemperature(s.ambient, b, comfortBonus(player, b));
  const air = biome.toxicityPerMin;
  s.airToxicity = air ? lerp(air.night, air.day, day) * gear.airFilter : 0;
  return true;
}

/** What the blocks a body touches do to it (block `contact`). */
export interface Contact {
  /** Toxicity per minute (foul water at the feet, unless waterproof). */
  toxicity: number;
  /** Health lost per second (thorns, magma). */
  damage: number;
}

/**
 * The contact of the blocks at the feet and, on the ground, under them (the strongest of each),
 * written into `out`.
 */
export function touch(
  registry: Registry,
  world: VoxelWorld,
  player: PlayerState,
  out: Contact,
): void {
  const body = player.body;
  const x = Math.floor(body.x);
  const z = Math.floor(body.z);
  // Both cells lie in one column: looked up once.
  const column = world.getColumn(toColumn(x), toColumn(z));
  out.toxicity = 0;
  out.damage = 0;
  addContact(registry, world.blockIn(column, x, Math.floor(body.y + 0.05), z), out);
  if (body.onGround)
    addContact(registry, world.blockIn(column, x, Math.floor(body.y - 0.05), z), out);
  if (out.toxicity > 0 && wornGear(registry, player.equipment, gear).waterproof) out.toxicity = 0;
}

function addContact(registry: Registry, state: number, out: Contact): void {
  const contact = registry.blockDef(state).contact;
  if (!contact) return;
  out.toxicity = Math.max(out.toxicity, contact.toxicityPerMin ?? 0);
  out.damage = Math.max(out.damage, contact.damagePerSec ?? 0);
}
