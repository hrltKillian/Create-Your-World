import { COLLISION_LIQUID, FLAG_OPAQUE } from '../content/registry.ts';
import type { BiomeKey, CreatureDef, CreatureSpawn } from '../content/schema.ts';
import { hash32, hashUnit } from '../core/hash.ts';
import type { Column } from '../world/Column.ts';
import {
  blockToColumn,
  columnIndex,
  columnKey,
  insideBorder,
  SECTION_SIZE,
  toColumn,
  toLocal,
  WORLD_HEIGHT,
} from '../world/coords.ts';
import { effectiveLight, MAX_LIGHT, skyOf } from '../world/light.ts';
import { COLUMN_LIT } from './ColumnPipeline.ts';
import { solidCell } from './collision.ts';
import {
  type CreatureState,
  creatureDef,
  isGone,
  isHostile,
  nearestPlayer2,
  parkCreature,
  removeCreature,
  spawnCreature,
} from './creatures.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';
import { daylightAt, dayOf, hourOf, phaseOf } from './time.ts';

/*
 * Creatures coming and going (docs « Créatures et combat », Apparition, Disparition; tick step
 * 13). Every 30 ticks, each living player draws 4 candidate cells in a ring 24–56 blocks away
 * (never within 16 blocks of a player), on the ground or in a cave; a creature whose spawn entry
 * fits the cell (biome, time, effective light, caps) appears there with its group. Hostiles need
 * an effective light ≤ 4, a world with hostiles and the grace period over; the other creatures
 * come back at most once a minute. Herds are placed when a column is first generated (the column
 * is then saved). Departures (`departs`, every tick): hostiles leave beyond 96 blocks, or 48 after
 * 30 s out of view; the others leave with their column while it is unloaded. Every draw is a hash
 * of the world seed and the tick: nothing to save.
 */

export const SPAWN = {
  everyTicks: 30,
  candidates: 4,
  ringMin: 24,
  ringMax: 56,
  /** Never this close to a player. */
  playerClearance: 16,
  /** Hostiles on the surface: 3 + floor(day / 2), at most 9, within 96 blocks. */
  surfaceBase: 3,
  surfaceMax: 9,
  surfaceRadius: 96,
  caveCap: 4,
  caveRadius: 48,
  /** Territorial and defensive creatures, then passive ones, within 96 blocks. */
  guardCap: 4,
  passiveCap: 8,
  perColumn: 3,
  /** Non-hostile creatures come back on these ticks only (once a minute). */
  herdEveryTicks: 1800,
  /** Chance that a column gets a herd when first generated. */
  herdChance: 0.08,
  /** Herd members stand within this many blocks of its first one. */
  herdSpread: 3,
  /** Hostiles leave beyond ACTIVE_RADIUS (96 blocks), or beyond 48 after 30 s out of view. */
  despawnUnseen: 48,
  unseenTicks: 900,
  /** Kept entries of the spawn log. */
  logSize: 256,
  /** Cave candidates search this many blocks down for a floor. */
  caveScan: 16,
  /** Surface candidates search this many blocks down from the top block for a floor. */
  surfaceScan: 6,
} as const;

/** A hostile spawn, for tests (`sim.spawnLog`). */
export interface SpawnLogEntry {
  readonly tick: number;
  readonly creature: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Effective light of the cell when it appeared. */
  readonly light: number;
  readonly cave: boolean;
}

/** Salts of the hashes drawn. */
const SALT_CANDIDATE = 0x51a7;
const SALT_HERD = 0x4e2d;

/** Creatures counted around a player for the caps (filled by `countAround`). */
const counts = { surface: 0, cave: 0, guards: 0, passive: 0 };

/** Tick step 13: every 30 ticks, spawns around each living player. */
export function stepSpawning(sim: Simulation): void {
  if (sim.tick % SPAWN.everyTicks !== 0 || !sim.rules.spawns) return;
  const herdTick = sim.tick % SPAWN.herdEveryTicks === 0;
  const hostiles = sim.rules.hostiles && sim.tick >= sim.rules.graceTicks;
  if (!herdTick && !hostiles) return;
  for (const player of sim.players.values()) {
    if (player.survival.health <= 0 || !sim.isActive(player)) continue;
    countAround(sim, player);
    for (let i = 0; i < SPAWN.candidates; i++) trySpawn(sim, player, i, herdTick, hostiles);
  }
}

/**
 * Departures (docs « Disparition »), every tick for each creature, after the timers of an active
 * one (`active`: not dormant); returns whether it left the simulation. A creature leaving (dying,
 * burrowing) goes once its time is up, or at once out of the simulation. A hostile goes beyond 48
 * blocks of every player after 30 s out of view, or out of the simulation: beyond ACTIVE_RADIUS
 * (96 blocks) or in a column that is not lit. The others wait out of the simulation, and leave with
 * their column while it is unloaded (`parkCreature`: saved with it, back when it loads).
 */
export function departs(
  sim: Simulation,
  c: CreatureState,
  def: CreatureDef,
  active: boolean,
): boolean {
  if (isGone(c) || isHostile(def)) {
    if (active && (isGone(c) ? c.modeTicks > 0 : !forgotten(sim, c))) return false;
    removeCreature(sim, c.id);
    return true;
  }
  if (active || sim.columnState(blockToColumn(c.body.x), blockToColumn(c.body.z)) > 0) return false;
  parkCreature(sim, c);
  return true;
}

/** A hostile beyond 48 blocks of every player after 30 s out of view. */
function forgotten(sim: Simulation, c: Readonly<CreatureState>): boolean {
  if (c.unseen < SPAWN.unseenTicks) return false;
  return nearestPlayer2(sim, c.body.x, c.body.z) > SPAWN.despawnUnseen * SPAWN.despawnUnseen;
}

/** Counts the creatures that fill each cap around a player. */
function countAround(sim: Simulation, player: PlayerState): void {
  counts.surface = 0;
  counts.cave = 0;
  counts.guards = 0;
  counts.passive = 0;
  const { x, z } = player.body;
  for (const c of sim.entities.values()) {
    if (c.kind !== 'creature' || isGone(c)) continue;
    const dx = c.body.x - x;
    const dz = c.body.z - z;
    const d2 = dx * dx + dz * dz;
    const def = creatureDef(sim, c);
    if (isHostile(def)) {
      if (c.cave && d2 <= SPAWN.caveRadius * SPAWN.caveRadius) counts.cave++;
      if (!c.cave && d2 <= SPAWN.surfaceRadius * SPAWN.surfaceRadius) counts.surface++;
    } else if (d2 <= SPAWN.surfaceRadius * SPAWN.surfaceRadius) {
      if (def.category === 'passive') counts.passive++;
      else counts.guards++;
    }
  }
}

/** Room left under the cap of a creature's kind of place, around the current player. */
function capLeft(def: CreatureDef, cave: boolean, day: number): number {
  if (isHostile(def)) {
    if (cave) return SPAWN.caveCap - counts.cave;
    const cap = Math.min(SPAWN.surfaceMax, SPAWN.surfaceBase + Math.floor(day / 2));
    return cap - counts.surface;
  }
  return def.category === 'passive'
    ? SPAWN.passiveCap - counts.passive
    : SPAWN.guardCap - counts.guards;
}

/** Creatures standing in a column (the per-column cap). */
function creaturesIn(sim: Simulation, cx: number, cz: number): number {
  let n = 0;
  for (const c of sim.entities.values()) {
    if (c.kind !== 'creature' || isGone(c)) continue;
    if (blockToColumn(c.body.x) === cx && blockToColumn(c.body.z) === cz) n++;
  }
  return n;
}

/** Whether a player stands within the clearance of a point. */
function nearAPlayer(sim: Simulation, x: number, z: number): boolean {
  return nearestPlayer2(sim, x, z) <= SPAWN.playerClearance * SPAWN.playerClearance;
}

/**
 * Feet height of a spot to stand on at (x, z) from `top` down `scan` blocks: room for two blocks
 * of body over an opaque solid floor (never on leaves or in a liquid); −1 when there is none.
 */
function floorBelow(sim: Simulation, x: number, z: number, top: number, scan: number): number {
  const tables = sim.registry.tables;
  const world = sim.world;
  for (let y = Math.min(top, WORLD_HEIGHT - 2); y > Math.max(0, top - scan); y--) {
    const below = world.getBlock(x, y - 1, z);
    if ((tables.flags[below]! & FLAG_OPAQUE) === 0 || !solidCell(world, tables, x, y - 1, z))
      continue;
    if (solidCell(world, tables, x, y, z) || solidCell(world, tables, x, y + 1, z)) continue;
    if (tables.collision[world.getBlock(x, y, z)] !== COLLISION_LIQUID) return y;
  }
  return -1;
}

/** Feet height of a ground spot at (x, z) of a loaded column (−1: none). */
function surfaceFloor(sim: Simulation, column: Column, x: number, z: number): number {
  const top = column.heightmap[columnIndex(toLocal(x), toLocal(z))]!;
  return floorBelow(sim, x, z, top, SPAWN.surfaceScan);
}

/** Whether a spawn entry fits a spot (place, time of day, biome, light). */
function fits(
  spawn: CreatureSpawn,
  cave: boolean,
  night: boolean,
  biome: BiomeKey | undefined,
  light: number,
): boolean {
  if (spawn.where !== (cave ? 'cave' : 'surface')) return false;
  if (spawn.when !== 'any' && (spawn.when === 'night') !== night) return false;
  if (spawn.biomes !== '*' && (biome === undefined || !spawn.biomes.includes(biome))) return false;
  return light <= (spawn.maxLight ?? MAX_LIGHT);
}

/** Which creatures may spawn now: hostiles, the others, under their caps or not (herds). */
const allow = { hostiles: false, others: false, capped: true, day: 1 };

function allowed(def: CreatureDef, cave: boolean): boolean {
  if (!(isHostile(def) ? allow.hostiles : allow.others)) return false;
  return !allow.capped || capLeft(def, cave, allow.day) > 0;
}

/** The spawn entry picked for a spot, and its creature. */
const picked = { def: null as CreatureDef | null, spawn: null as CreatureSpawn | null };

/**
 * Picks by weight (`pick` in [0, 1)) among the spawn entries that fit a spot, of the creatures
 * `allow` lets spawn; false when none does.
 */
function pickEntry(
  sim: Simulation,
  cave: boolean,
  night: boolean,
  biome: BiomeKey | undefined,
  light: number,
  pick: number,
): boolean {
  const creatures = sim.registry.pack.creatures ?? [];
  let total = 0;
  for (const def of creatures) {
    if (!allowed(def, cave)) continue;
    for (const spawn of def.spawn)
      if (fits(spawn, cave, night, biome, light)) total += spawn.weight;
  }
  let left = pick * total;
  for (const def of creatures) {
    if (!allowed(def, cave)) continue;
    for (const spawn of def.spawn) {
      if (!fits(spawn, cave, night, biome, light)) continue;
      picked.def = def;
      picked.spawn = spawn;
      if (left < spawn.weight) return true;
      left -= spawn.weight;
    }
  }
  return total > 0;
}

/** The biome key at a cell of a loaded column. */
function biomeAt(sim: Simulation, column: Column, x: number, z: number): BiomeKey | undefined {
  return sim.ctx.biomeDefs[column.biomes[columnIndex(toLocal(x), toLocal(z))]!]?.key;
}

/** One spawn candidate of a player: the `i`-th draw of this tick. */
function trySpawn(
  sim: Simulation,
  player: PlayerState,
  i: number,
  herdTick: boolean,
  hostiles: boolean,
): void {
  const h = hash32(sim.ctx.seedHash, sim.tick, player.id * SPAWN.candidates + i, SALT_CANDIDATE);
  const angle = hashUnit(h, 1) * 2 * Math.PI;
  const distance = SPAWN.ringMin + hashUnit(h, 2) * (SPAWN.ringMax - SPAWN.ringMin);
  const x = Math.floor(player.body.x + Math.cos(angle) * distance);
  const z = Math.floor(player.body.z + Math.sin(angle) * distance);
  if (!insideBorder(x, z) || nearAPlayer(sim, x + 0.5, z + 0.5)) return;
  const cx = toColumn(x);
  const cz = toColumn(z);
  const column = sim.world.getColumn(cx, cz);
  if (!column || sim.columnState(cx, cz) < COLUMN_LIT) return;
  const cave = hashUnit(h, 3) < 0.5;
  const top = column.heightmap[columnIndex(toLocal(x), toLocal(z))]!;
  const y = cave
    ? floorBelow(sim, x, z, 8 + Math.floor(hashUnit(h, 4) * Math.max(1, top - 16)), SPAWN.caveScan)
    : surfaceFloor(sim, column, x, z);
  if (y < 0) return;
  const packed = sim.world.getLight(x, y, z);
  // A cave spot sees no sky; a surface one does (never inside a dark, closed building).
  const underSky = skyOf(packed) > 0;
  if (underSky === cave) return;
  const hour = hourOf(sim.time.ticks);
  const phase = phaseOf(hour);
  const night = phase === 'night' || phase === 'dusk';
  const light = effectiveLight(packed, daylightAt(hour));
  allow.hostiles = hostiles;
  allow.others = herdTick;
  allow.capped = true;
  allow.day = dayOf(sim.time.ticks);
  if (!pickEntry(sim, cave, night, biomeAt(sim, column, x, z), light, hashUnit(h, 5))) return;
  const def = picked.def!;
  const [min, max] = picked.spawn!.group;
  const wanted = min + Math.floor(hashUnit(h, 6) * (max - min + 1));
  const room = Math.min(capLeft(def, cave, allow.day), SPAWN.perColumn - creaturesIn(sim, cx, cz));
  const group = Math.min(wanted, room);
  let herd = -1;
  for (let m = 0; m < group; m++) {
    // The first one on the candidate, the others close by on the same kind of spot.
    const mx = m === 0 ? x : x + Math.floor((hashUnit(h, 10 + m) - 0.5) * 2 * SPAWN.herdSpread);
    const mz = m === 0 ? z : z + Math.floor((hashUnit(h, 20 + m) - 0.5) * 2 * SPAWN.herdSpread);
    if (sim.columnState(toColumn(mx), toColumn(mz)) < COLUMN_LIT) continue;
    const my = m === 0 ? y : floorBelow(sim, mx, mz, y + 1, 3);
    if (my < 0 || nearAPlayer(sim, mx + 0.5, mz + 0.5)) continue;
    const memberLight = effectiveLight(sim.world.getLight(mx, my, mz), daylightAt(hour));
    if (memberLight > (picked.spawn!.maxLight ?? MAX_LIGHT)) continue;
    const c = spawnCreature(sim, def, mx + 0.5, my, mz + 0.5, herd, cave);
    herd = c.herd;
    countSpawn(def, cave);
    if (isHostile(def)) logSpawn(sim, c, memberLight);
  }
}

/** A new creature fills its cap. */
function countSpawn(def: CreatureDef, cave: boolean): void {
  if (isHostile(def)) {
    if (cave) counts.cave++;
    else counts.surface++;
  } else if (def.category === 'passive') counts.passive++;
  else counts.guards++;
}

function logSpawn(sim: Simulation, c: Readonly<CreatureState>, light: number): void {
  const log = sim.spawnLog;
  if (log.length >= SPAWN.logSize) log.shift();
  const { x, y, z } = c.body;
  log.push({ tick: sim.tick, creature: c.creature, x, y, z, light, cave: c.cave });
}

/**
 * Herds of a column generated for the first time (`sim.herdColumns` remembers those that got one,
 * and the save keeps them): with a hashed chance, a group of one of the non-hostile creatures whose
 * surface spawn fits the biome there, whatever the hour.
 */
export function placeHerds(sim: Simulation, column: Column): void {
  const key = columnKey(column.cx, column.cz);
  if (!sim.rules.spawns || sim.herdColumns.has(key)) return;
  const h = hash32(sim.ctx.seedHash, column.cx, column.cz, SALT_HERD);
  if (hashUnit(h, 1) >= SPAWN.herdChance) return;
  // Away from the column's edges, so the herd starts inside it.
  const span = SECTION_SIZE - 2 * SPAWN.herdSpread;
  const x = column.cx * SECTION_SIZE + SPAWN.herdSpread + Math.floor(hashUnit(h, 2) * span);
  const z = column.cz * SECTION_SIZE + SPAWN.herdSpread + Math.floor(hashUnit(h, 3) * span);
  const y = surfaceFloor(sim, column, x, z);
  if (y < 0) return;
  allow.hostiles = false;
  allow.others = true;
  allow.capped = false;
  const biome = biomeAt(sim, column, x, z);
  // Any hour: a spawn entry of the day or of the night fits.
  const found =
    pickEntry(sim, false, false, biome, 0, hashUnit(h, 4)) ||
    pickEntry(sim, false, true, biome, 0, hashUnit(h, 4));
  if (!found) return;
  const def = picked.def!;
  const [min, max] = picked.spawn!.group;
  const size = min + Math.floor(hashUnit(h, 5) * (max - min + 1));
  let herd = -1;
  for (let m = 0; m < size; m++) {
    const mx = x + (m === 0 ? 0 : Math.floor((hashUnit(h, 10 + m) - 0.5) * 2 * SPAWN.herdSpread));
    const mz = z + (m === 0 ? 0 : Math.floor((hashUnit(h, 20 + m) - 0.5) * 2 * SPAWN.herdSpread));
    const my = surfaceFloor(sim, column, mx, mz);
    if (my < 0) continue;
    herd = spawnCreature(sim, def, mx + 0.5, my, mz + 0.5, herd).herd;
  }
  if (herd >= 0) sim.herdColumns.add(key);
}
