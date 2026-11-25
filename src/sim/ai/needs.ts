import type { CreatureDef } from '../../content/schema.ts';
import { feetCell } from '../../core/creatures.ts';
import { BY_WORLD, removeBlock } from '../blockRemoval.ts';
import { type CreatureState, SEEK_FOOD, SEEK_WATER } from '../creatures.ts';
import type { SimEvent } from '../events.ts';
import { removeDrop } from '../itemDrops.ts';
import type { Simulation } from '../Simulation.ts';

/*
 * What a creature eats and drinks (docs plan v2 « M17 »): a hungry grazer walks to the nearest
 * plant of its diet within `seekRadius` and grazes it (the plant is gone); a meat eater walks to
 * meat lying on the ground within that radius, hungry or not (a bait); a thirsty creature walks to
 * the nearest drinkable liquid. The walk is an ordinary `wander` with `seek` set; once its path is
 * spent within REACH of the goal, it eats or drinks. Zero allocation.
 */

/** A goal is reached within this many blocks (horizontally). */
const REACH = 1.6;
/** Plants and liquids are looked for this many blocks above and below the feet. */
const SEEK_HEIGHT = 2;

/** Scratch list of nearby entity ids. */
const near: number[] = [];

/**
 * Sets a walk's goal (`goalX/Y/Z` and `seek`) to what the creature needs most: water when thirsty,
 * then meat on the ground, then a plant when hungry (`baitOnly`: meat only, while it rests).
 * Returns false when it needs nothing it finds.
 */
export function chooseNeed(
  sim: Simulation,
  c: CreatureState,
  def: CreatureDef,
  baitOnly: boolean,
): boolean {
  const needs = sim.registry.pack.balance.creatures.needs;
  if (baitOnly)
    return (
      def.diet.meat !== undefined &&
      nearestMeat(sim, c, def.diet.meat, needs.seekRadius) &&
      seekFood(c)
    );
  if (c.thirst < needs.seekBelow && nearestCell(sim, c, def, needs.seekRadius, SEEK_WATER)) {
    c.seek = SEEK_WATER;
    return true;
  }
  if (def.diet.meat && nearestMeat(sim, c, def.diet.meat, needs.seekRadius)) {
    c.seek = SEEK_FOOD;
    return true;
  }
  const hungry = c.hunger < needs.seekBelow;
  if (def.diet.plants && hungry && nearestCell(sim, c, def, needs.seekRadius, SEEK_FOOD)) {
    c.seek = SEEK_FOOD;
    return true;
  }
  return false;
}

function seekFood(c: CreatureState): boolean {
  c.seek = SEEK_FOOD;
  return true;
}

/** At the end of a walk with `seek`: eats or drinks what lies at the goal, if it is still there. */
export function reachNeed(sim: Simulation, c: CreatureState, def: CreatureDef, out: SimEvent[]) {
  const seek = c.seek;
  c.seek = 0;
  const dx = c.goalX - c.body.x;
  const dz = c.goalZ - c.body.z;
  if (dx * dx + dz * dz > REACH * REACH) return;
  const needs = sim.registry.pack.balance.creatures.needs;
  if (seek === SEEK_WATER) {
    if (drinkable(sim, Math.floor(c.goalX), feetCell(c.goalY), Math.floor(c.goalZ)))
      c.thirst = Math.min(100, c.thirst + needs.drink);
    return;
  }
  if (def.diet.meat && eatMeat(sim, c, def.diet.meat)) {
    c.hunger = Math.min(100, c.hunger + needs.meatFood);
    return;
  }
  const x = Math.floor(c.goalX);
  const y = feetCell(c.goalY);
  const z = Math.floor(c.goalZ);
  if (eats(sim, def, sim.world.getBlock(x, y, z))) {
    removeBlock(sim, BY_WORLD, x, y, z, false, out);
    c.hunger = Math.min(100, c.hunger + needs.plantFood);
  }
}

/** Whether a block is a plant of the creature's diet. */
function eats(sim: Simulation, def: CreatureDef, state: number): boolean {
  const plants = def.diet.plants;
  if (!plants) return false;
  const key = sim.registry.blockDef(state).key;
  for (let i = 0; i < plants.length; i++) if (plants[i] === key) return true;
  return false;
}

/** Whether a cell holds a liquid one may drink. */
function drinkable(sim: Simulation, x: number, y: number, z: number): boolean {
  return sim.registry.blockDef(sim.world.getBlock(x, y, z)).liquid?.drinkable === true;
}

/** Whether a block is what a seek looks for: a plant of the diet (SEEK_FOOD), or water. */
function wanted(sim: Simulation, def: CreatureDef, seek: number, state: number): boolean {
  return seek === SEEK_FOOD
    ? eats(sim, def, state)
    : sim.registry.blockDef(state).liquid?.drinkable === true;
}

/**
 * Scans the cells around the feet (`radius` across, SEEK_HEIGHT up and down) for the nearest one
 * a seek looks for, and sets the goal on it. Returns whether it found one.
 */
function nearestCell(
  sim: Simulation,
  c: CreatureState,
  def: CreatureDef,
  radius: number,
  seek: number,
): boolean {
  const bx = Math.floor(c.body.x);
  const by = feetCell(c.body.y);
  const bz = Math.floor(c.body.z);
  let best = radius * radius + 1;
  for (let dy = -SEEK_HEIGHT; dy <= SEEK_HEIGHT; dy++)
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        const d = dx * dx + dz * dz + dy * dy;
        if (d >= best || !wanted(sim, def, seek, sim.world.getBlock(bx + dx, by + dy, bz + dz)))
          continue;
        best = d;
        c.goalX = bx + dx + 0.5;
        c.goalY = by + dy;
        c.goalZ = bz + dz + 0.5;
      }
  return best <= radius * radius;
}

/** The nearest drop of meat the creature eats within `radius`: the goal set on it. */
function nearestMeat(
  sim: Simulation,
  c: CreatureState,
  meat: readonly string[],
  radius: number,
): boolean {
  sim.entitiesNear(c.body.x, c.body.z, radius, near);
  let best = radius * radius + 1;
  for (let i = 0; i < near.length; i++) {
    const drop = sim.entities.get(near[i]!);
    if (drop?.kind !== 'itemDrop' || !meat.includes(drop.item)) continue;
    const dx = drop.body.x - c.body.x;
    const dz = drop.body.z - c.body.z;
    if (dx * dx + dz * dz >= best) continue;
    best = dx * dx + dz * dz;
    c.goalX = drop.body.x;
    c.goalY = drop.body.y;
    c.goalZ = drop.body.z;
  }
  return best <= radius * radius;
}

/** Eats one piece of meat lying within REACH: true when there was one. */
function eatMeat(sim: Simulation, c: CreatureState, meat: readonly string[]): boolean {
  sim.entitiesNear(c.body.x, c.body.z, REACH, near);
  for (let i = 0; i < near.length; i++) {
    const drop = sim.entities.get(near[i]!);
    if (drop?.kind !== 'itemDrop' || !meat.includes(drop.item)) continue;
    drop.count--;
    if (drop.count <= 0) removeDrop(sim, drop.id);
    return true;
  }
  return false;
}
