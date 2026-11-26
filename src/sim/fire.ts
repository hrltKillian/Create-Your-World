import type { Registry } from '../content/registry.ts';
import { FLAG_SOLID } from '../content/registry.ts';
import { hash32 } from '../core/hash.ts';
import { WORLD_HEIGHT } from '../world/coords.ts';
import { BY_WORLD, removeBlock } from './blockRemoval.ts';
import { UPDATE_FIRE } from './blockUpdates.ts';
import { ticksOf } from './clock.ts';
import { editBlock } from './edits.ts';
import type { SimEvent } from './events.ts';
import type { Simulation } from './Simulation.ts';
import { fallingOn } from './weather.ts';

/*
 * Fire (plan v5 « M47 »), the reference game's rules. A fire block (the pack's `bindings.fire`,
 * with its `age` 0–15) ticks every 1.5–2 s (block updates, UPDATE_FIRE):
 * - it goes out without a solid block under it nor a flammable block beside it, and now and then
 *   under rain (more often the older it is);
 * - it ages; with nothing flammable beside it, it burns out once past age 3 (at once without a
 *   solid floor); at age 15 it may burn out over a block that does not burn;
 * - each block beside it that burns (`BlockDef.flammability.burn`) may burn away, often into a
 *   new fire;
 * - it spreads into the air within 1 block across and from 1 below to 4 above (less likely the
 *   higher), where a block beside that air catches (`flammability.catch`), never into the rain.
 * Every draw is a hash of the seed, the cell, the tick and a salt: the same world burns the same.
 */

export const FIRE = {
  /** Seconds between two ticks of a fire (the reference game's 30–40 ticks). */
  delay: [1.5, 2] as const,
  /** Out of this, the chance a side (or above and below: `vertical`) burns away. */
  sideRange: 300,
  verticalRange: 250,
  /** Out of this (+100 for each block over 1 above the fire), the chance to spread into a cell. */
  spreadBase: 100,
  /** The spread's odds: (catch + 40 + this) / (age + 30); the reference game's normal difficulty. */
  difficulty: 14,
  /** A fire in the rain goes out with this chance, and this more for each age. */
  rainOut: 0.2,
  rainOutPerAge: 0.03,
  /** Past this age a fire with nothing flammable beside it burns out. */
  bareAge: 3,
  maxAge: 15,
} as const;

/** Salts of the draws. */
const DELAY_SALT = 0x66697265;
const DRAW_SALT = 0x6275726e;

/** Cells beside one: x, y, z per face (east, west, up, down, south, north). */
const SIDES = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];

interface FireTables {
  /** The fire block's index, −1 without one. */
  readonly block: number;
  /** Its state of age 0. */
  readonly state: number;
  /** By block index: catch and burn odds (0: never). */
  readonly catchOdds: Uint8Array;
  readonly burnOdds: Uint8Array;
}

const tablesOf = new WeakMap<Registry, FireTables>();

/** The registry's fire tables (built once). */
function fireTables(registry: Registry): FireTables {
  let tables = tablesOf.get(registry);
  if (tables) return tables;
  const blocks = registry.pack.blocks;
  const catchOdds = new Uint8Array(blocks.length);
  const burnOdds = new Uint8Array(blocks.length);
  blocks.forEach((block, i) => {
    catchOdds[i] = block.flammability?.catch ?? 0;
    burnOdds[i] = block.flammability?.burn ?? 0;
  });
  const key = registry.pack.manifest.bindings.fire;
  const block = key ? blocks.findIndex((b) => b.key === key) : -1;
  tables = {
    block,
    state: block < 0 ? -1 : registry.defaultState(key!),
    catchOdds,
    burnOdds,
  };
  tablesOf.set(registry, tables);
  return tables;
}

/** Whether a block state is a fire. */
export function isFire(registry: Registry, state: number): boolean {
  const block = fireTables(registry).block;
  return block >= 0 && registry.tables.blockOf[state] === block;
}

/** A draw in [0, n) for a cell this tick. */
function draw(sim: Simulation, x: number, y: number, z: number, salt: number, n: number): number {
  return hash32(hash32(sim.ctx.seedHash, x, y, z), sim.tick, DRAW_SALT + salt) % n;
}

/** Schedules a fire's next tick after its delay. */
function scheduleFire(sim: Simulation, x: number, y: number, z: number): void {
  const min = ticksOf(FIRE.delay[0]);
  const span = ticksOf(FIRE.delay[1]) - min + 1;
  const delay = min + (hash32(hash32(sim.ctx.seedHash, x, y, z), sim.tick, DELAY_SALT) % span);
  sim.blockUpdates.schedule(x, y, z, UPDATE_FIRE, sim.tick + delay);
}

/**
 * Lights a fire of an age in an empty cell (lightning, a spread, a block burnt away); false where
 * there is no fire block, the cell is not air, or nothing would hold it.
 */
export function lightFire(
  sim: Simulation,
  x: number,
  y: number,
  z: number,
  age: number,
  out: SimEvent[],
): boolean {
  const fire = fireTables(sim.registry);
  if (fire.state < 0 || y < 0 || y >= WORLD_HEIGHT) return false;
  if (sim.world.getBlock(x, y, z) !== sim.registry.air || !canHold(sim, x, y, z)) return false;
  const state = sim.registry.withState(fire.state, 'age', String(Math.min(FIRE.maxAge, age)));
  if (!editBlock(sim.world, sim.light, x, y, z, state, out)) return false;
  scheduleFire(sim, x, y, z);
  return true;
}

function burnOdds(sim: Simulation, x: number, y: number, z: number): number {
  const block = sim.registry.tables.blockOf[sim.world.getBlock(x, y, z)]!;
  return fireTables(sim.registry).burnOdds[block]!;
}

function solidBelow(sim: Simulation, x: number, y: number, z: number): boolean {
  return (sim.registry.tables.flags[sim.world.getBlock(x, y - 1, z)]! & FLAG_SOLID) !== 0;
}

/** Whether a block beside a cell burns. */
function flammableBeside(sim: Simulation, x: number, y: number, z: number): boolean {
  for (let i = 0; i < 18; i += 3)
    if (burnOdds(sim, x + SIDES[i]!, y + SIDES[i + 1]!, z + SIDES[i + 2]!) > 0) return true;
  return false;
}

/** Whether a fire holds in a cell: a solid floor, or something flammable beside. */
function canHold(sim: Simulation, x: number, y: number, z: number): boolean {
  return solidBelow(sim, x, y, z) || flammableBeside(sim, x, y, z);
}

/** How readily a fire spreads into an empty cell: the best `catch` beside it (0 if none). */
function igniteOdds(sim: Simulation, x: number, y: number, z: number): number {
  if (sim.world.getBlock(x, y, z) !== sim.registry.air) return 0;
  const catchOdds = fireTables(sim.registry).catchOdds;
  const blockOf = sim.registry.tables.blockOf;
  let best = 0;
  for (let i = 0; i < 18; i += 3) {
    const state = sim.world.getBlock(x + SIDES[i]!, y + SIDES[i + 1]!, z + SIDES[i + 2]!);
    best = Math.max(best, catchOdds[blockOf[state]!]!);
  }
  return best;
}

/**
 * Whether the rain falls on a cell now: on what is just above it, since a fire there counts in its
 * column's heightmap (the reference game's fire never shelters itself).
 */
function rained(sim: Simulation, x: number, y: number, z: number): boolean {
  return fallingOn(sim, x, y + 1, z) === 'rain';
}

/** A fire's younger flame for a cell it takes (its age plus 0 or 1). */
function nextAge(sim: Simulation, x: number, y: number, z: number, age: number): number {
  return Math.min(FIRE.maxAge, age + (draw(sim, x, y, z, 7, 5) >> 2));
}

/** UPDATE_FIRE: a fire goes out, ages, burns the blocks beside it and spreads (see the header). */
export function burnFire(sim: Simulation, x: number, y: number, z: number, out: SimEvent[]): void {
  const registry = sim.registry;
  const state = sim.world.getBlock(x, y, z);
  if (!isFire(registry, state)) return;
  const age = Number(registry.prop(state, 'age') ?? '0');
  if (goesOut(sim, x, y, z, age)) {
    removeBlock(sim, BY_WORLD, x, y, z, false, out);
    return;
  }
  const older = Math.min(FIRE.maxAge, age + (draw(sim, x, y, z, 2, 3) >> 1));
  if (older !== age) {
    const aged = registry.withState(state, 'age', String(older));
    editBlock(sim.world, sim.light, x, y, z, aged, out);
  }
  scheduleFire(sim, x, y, z);
  if (!flammableBeside(sim, x, y, z)) return;
  for (let i = 0; i < 18; i += 3) {
    const range = SIDES[i + 1] !== 0 ? FIRE.verticalRange : FIRE.sideRange;
    burnBeside(sim, x + SIDES[i]!, y + SIDES[i + 1]!, z + SIDES[i + 2]!, range, age, out);
  }
  spread(sim, x, y, z, age, out);
}

/** Whether a fire of an age goes out this tick (see the header). */
function goesOut(sim: Simulation, x: number, y: number, z: number, age: number): boolean {
  if (!canHold(sim, x, y, z)) return true;
  const rainOut = 100 * (FIRE.rainOut + FIRE.rainOutPerAge * age);
  if (rained(sim, x, y, z) && draw(sim, x, y, z, 1, 100) < rainOut) return true;
  if (!flammableBeside(sim, x, y, z)) return !solidBelow(sim, x, y, z) || age > FIRE.bareAge;
  return age === FIRE.maxAge && draw(sim, x, y, z, 3, 4) === 0 && burnOdds(sim, x, y - 1, z) === 0;
}

/** A block beside a fire may burn away, often into a new fire. */
function burnBeside(
  sim: Simulation,
  x: number,
  y: number,
  z: number,
  range: number,
  age: number,
  out: SimEvent[],
): void {
  const odds = burnOdds(sim, x, y, z);
  if (odds === 0 || draw(sim, x, y, z, 4, range) >= odds) return;
  removeBlock(sim, BY_WORLD, x, y, z, false, out);
  if (draw(sim, x, y, z, 5, age + 10) < 5 && !rained(sim, x, y, z))
    lightFire(sim, x, y, z, nextAge(sim, x, y, z, age), out);
}

/** A fire spreads into the air around it where something beside catches. */
function spread(
  sim: Simulation,
  x: number,
  y: number,
  z: number,
  age: number,
  out: SimEvent[],
): void {
  for (let dy = -1; dy <= 4; dy++) {
    const base = FIRE.spreadBase + (dy > 1 ? (dy - 1) * 100 : 0);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        const tx = x + dx;
        const ty = y + dy;
        const tz = z + dz;
        const odds = igniteOdds(sim, tx, ty, tz);
        if (odds === 0) continue;
        const chance = Math.floor((odds + 40 + FIRE.difficulty) / (age + 30));
        if (chance > 0 && draw(sim, tx, ty, tz, 6, base) <= chance && !rained(sim, tx, ty, tz))
          lightFire(sim, tx, ty, tz, nextAge(sim, tx, ty, tz, age), out);
      }
    }
  }
}
