import { FLAG_LIQUID, FLAG_SOLID } from '../../content/registry.ts';
import { HOTBAR_SLOTS } from '../../core/player.ts';
import type { ItemStack } from '../../sim/inventory.ts';
import { findBiome, type Place, spiral } from '../../world/gen/find.ts';
import { LatticeCache, pointInfo } from '../../world/gen/sample.ts';
import type { App } from '../App.ts';
import { fill, teleport } from '../automation.ts';
import { setStat } from '../survivalAutomation.ts';
import {
  arenaOf,
  assert,
  type Cell,
  chunksMeshed,
  needsGeneratedPlayer,
  SEARCH_RADIUS,
  standAt,
  stateKey,
} from './support.ts';

/**
 * The scenes of the M9 browser checks (selftest/m9.ts), built in the generated world from the
 * pack's data (engine code never names content): open ground of a biome picked by its climate, a
 * cabin and an open pad of the arena cabin's wall, a pool of the arena pond's water, the station
 * that boils that water, and gauges reset to a known start.
 */

/** Blocks around a findBiome hit searched for open ground of that biome. */
const GROUND_RINGS = 40;
/** Longest wait for a teleport's loading radius to be meshed (stretched on slow renderers). */
export const VISIT_MS = 30_000;
/** The open pad: 3 blocks either side of the player, 4 high. */
export const PAD_ROOM = 3;
export const PAD_HEIGHT = 4;

/** These checks step the simulation themselves: the generated world with fixed steps. */
export function needsGeneratedFixedPlayer(app: App): string | null {
  return needsGeneratedPlayer(app) ?? (app.params.fixedStep ? null : 'needs ?fixedStep=1');
}

/** The pack's survival balance. */
export const balance = (app: App) => app.registry!.pack.balance;
const biomes = (app: App) => app.session!.host.view.gen.biomes;

/** The biome with the coldest nights (the tundra). */
export function coldestBiome(app: App): number {
  const all = biomes(app);
  let coldest = 0;
  all.forEach((b, i) => {
    if (b.def.climate.nightC < all[coldest]!.def.climate.nightC) coldest = i;
  });
  return coldest;
}

/** The biome with the most toxic air by day (the marsh) and that toxicity per minute. */
export function toxicBiome(app: App): { index: number; perMin: number } {
  let index = -1;
  let perMin = 0;
  biomes(app).forEach((b, i) => {
    const day = b.def.toxicityPerMin?.day ?? 0;
    if (day > perMin) [index, perMin] = [i, day];
  });
  assert(index >= 0, 'no biome has a toxic air by day');
  return { index, perMin };
}

/**
 * A column of a biome within GROUND_RINGS blocks of a place, in the loaded world, whose top block
 * is the generated ground itself, solid and harmless (no liquid, plant, tree or building on it):
 * the head has the open sky. Returns its feet cell.
 */
function openGround(app: App, biome: number, near: Place): Cell | null {
  const world = app.world!;
  const registry = app.registry!;
  const flags = registry.tables.flags;
  const ctx = app.session!.host.view.gen;
  const cache = new LatticeCache();
  let found = null as Cell | null;
  spiral(GROUND_RINGS, (dx, dz) => {
    const x = near.x + dx;
    const z = near.z + dz;
    const feet = world.heightAt(x, z);
    if (feet < 0) return false;
    const top = world.getBlock(x, feet - 1, z);
    if ((flags[top]! & (FLAG_SOLID | FLAG_LIQUID)) !== FLAG_SOLID) return false;
    if (registry.blockDef(top).contact) return false;
    const info = pointInfo(ctx, x, z, cache);
    if (info.biome !== biome || info.height + 1 !== feet) return false;
    found = { x, y: feet, z };
    return true;
  });
  return found;
}

/**
 * Takes the player to open ground of a biome: the nearest column of it from the spawn, then, once
 * the area is loaded, `openGround` near it. Returns the feet cell.
 */
export async function visitBiome(app: App, biome: number): Promise<Cell> {
  const session = app.session!;
  const key = biomes(app)[biome]!.def.key;
  const { x, z } = session.spawn;
  const from = { x: Math.floor(x), z: Math.floor(z) };
  const hit = findBiome(session.host.view.gen, key, from, SEARCH_RADIUS);
  assert(hit, `no ${key} within ${SEARCH_RADIUS} blocks of the spawn (${from.x}, ${from.z})`);
  teleport(app, hit.x + 0.5, 'surface', hit.z + 0.5);
  await chunksMeshed(app, session.loadingRadius(), VISIT_MS);
  const ground = openGround(app, biome, hit);
  assert(ground, `no open ground of ${key} within ${GROUND_RINGS} blocks of (${hit.x}, ${hit.z})`);
  await standAt(app, ground, ground.y);
  await chunksMeshed(app, session.loadingRadius(), VISIT_MS);
  return ground;
}

/** The cell of the player's feet. */
export function feetCell(app: App): Cell {
  const b = app.session!.player.body;
  return { x: Math.floor(b.x), y: Math.floor(b.y), z: Math.floor(b.z) };
}

/** Full health, hunger and thirst, no toxicity, the body at 0: a check measures from there. */
export function freshGauges(app: App): void {
  const b = balance(app);
  setStat(app, 'health', b.health.max);
  setStat(app, 'hunger', b.hunger.max);
  setStat(app, 'thirst', b.thirst.max);
  setStat(app, 'toxicity', 0);
  setStat(app, 'temperature', 0);
}

/** The arena cabin's wall block (solid and opaque), for floors, walls and roofs. */
const wallKey = (app: App) => stateKey(app, app.registry!.defaultState(arenaOf(app).cabin.wall));

/** Clears a room of air around the feet cell (`r` blocks either side, `h` high) on a wall floor. */
export function clearRoom(app: App, c: Cell, r: number, h: number): void {
  fill(app, c.x - r, c.y, c.z - r, c.x + r, c.y + h - 1, c.z + r, stateKey(app, app.registry!.air));
  fill(app, c.x - r, c.y - 1, c.z - r, c.x + r, c.y - 1, c.z + r, wallKey(app));
}

/** The arena pond's liquid, the first empty container it fills and the filled one. */
export function pondWater(app: App) {
  const registry = app.registry!;
  const state = registry.defaultState(arenaOf(app).pond.liquid);
  const liquid = registry.blockDef(state).liquid;
  assert(liquid?.drinkable, `${stateKey(app, state)} is not a drinkable liquid`);
  const fills = Object.entries(liquid.fills);
  const [empty, filled] = fills[0] ?? [];
  assert(empty && filled, `${stateKey(app, state)} fills no container`);
  return { state, liquid, empty, filled };
}

/** Clears an open pad where the player stands, with a pool of pond water; returns a pool cell. */
export function buildPool(app: App): Cell {
  const feet = feetCell(app);
  clearRoom(app, feet, PAD_ROOM, PAD_HEIGHT);
  const water = stateKey(app, pondWater(app).state);
  fill(app, feet.x - 1, feet.y - 1, feet.z - 3, feet.x + 1, feet.y - 1, feet.z - 2, water);
  return { x: feet.x, y: feet.y - 1, z: feet.z - 2 };
}

/** The process that boils the filled container, its station and the station's block (campfire). */
export function boiler(app: App) {
  const registry = app.registry!;
  const { filled } = pondWater(app);
  const process = registry.crafting.processes.find((p) => p.inputs.some((i) => i.item === filled));
  assert(process, `no process takes ${filled}`);
  assert(process.inputs.length === 1, `${process.key} needs more than the water`);
  const block = registry.blocks.find((def) => def.station === process.station);
  const station = registry.crafting.station(process.station);
  assert(block && station, `no block is the station ${process.station}`);
  return { process, station, block };
}

/** The boiler's block, lit (no station entity runs a filled block out), which gives heat. */
export function litFire(app: App): string {
  const registry = app.registry!;
  const lit = registry.withState(registry.defaultState(boiler(app).block.key), 'lit', '1');
  assert(registry.tables.heat[lit]! > 0, `${stateKey(app, lit)} gives no heat`);
  return stateKey(app, lit);
}

/** A hotbar slot with nothing in it (the bare hand). */
export function emptyHand(app: App): number {
  const inventory = app.session!.player.inventory;
  const slot = inventory.findIndex((stack, i) => i < HOTBAR_SLOTS && stack === null);
  assert(slot >= 0, 'no empty hotbar slot for the bare hand');
  return slot;
}

/** A stack for messages. */
export const stackText = (stack: ItemStack | null | undefined) =>
  stack ? `${stack.item} ×${stack.count} (uses ${stack.durability ?? '-'})` : 'nothing';
