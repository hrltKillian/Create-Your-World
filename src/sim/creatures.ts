import type { Registry } from '../content/registry.ts';
import type { CreatureDef } from '../content/schema.ts';
import { CREATURE_EYE_SHARE } from '../core/creatures.ts';
import { hashUnit } from '../core/hash.ts';
import { blockToColumn, columnKey } from '../world/coords.ts';
import { COLUMN_LIT } from './ColumnPipeline.ts';
import { bodyHeight, PHYSICS } from './physics.ts';
import type { PlayerState } from './player.ts';
import type { Entity, Simulation } from './Simulation.ts';

/*
 * Creatures (docs « Créatures et combat », « Entités »): plain JSON entity records in
 * `sim.entities`, the state of their brain included. Hostiles are never saved; the others are
 * saved with the column they stand in (saveRecords.ts), and leave the simulation with it while it
 * is unloaded (`sim.parked`). Their senses, brains and paths are in `ai/`, their body in
 * creatureBody.ts, their blows in combat.ts, their comings and goings in spawning.ts.
 */

/**
 * What a creature is doing. Timed modes count `modeTicks` down: `flee`, `watch` and `chase` (how
 * long it keeps at it unprovoked), `windup` (the telegraph of an attack), `charge`, `recover`,
 * `stunned`, `burrow` (sinking away at dawn) and `dying` (falling over; then it is gone).
 */
export const CREATURE_MODES = [
  'idle',
  'wander',
  'watch',
  'flee',
  'chase',
  'windup',
  'charge',
  'recover',
  'stunned',
  'burrow',
  'dying',
] as const;
export type CreatureMode = (typeof CREATURE_MODES)[number];

/** Most cells a creature keeps of a planned path (it plans again at least every 20 ticks). */
export const PATH_MAX = 32;
/**
 * Creatures farther than this from every player stand still, and hostiles there leave (docs
 * « Disparition »: beyond 96 blocks).
 */
export const ACTIVE_RADIUS = 96;
/** A new creature stands still this long: its senses look around before it decides anything. */
const SETTLE_TICKS = 15;

/** Position (centre of the bottom face) and velocity of a creature. */
export interface CreatureBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
}

export interface CreatureState {
  readonly kind: 'creature';
  readonly id: number;
  /** Key of its CreatureDef (a saved creature the pack lacks is never loaded). */
  readonly creature: string;
  body: CreatureBody;
  /** Position and facing at the previous tick (render interpolation). */
  prevX: number;
  prevY: number;
  prevZ: number;
  prevYaw: number;
  /** Facing, in radians (0 looks north, −z, like a player's yaw). */
  yaw: number;
  health: number;
  mode: CreatureMode;
  /** Ticks left in a timed mode. */
  modeTicks: number;
  /** Entity id of the player it watches, hunts or flees (−1: none). */
  target: number;
  /** Where it walks to (wander, flee). */
  goalX: number;
  goalY: number;
  goalZ: number;
  /** Planned cells (x, y, z after one another; `pathLength` cells) and the next one to reach. */
  path: number[];
  pathLength: number;
  pathStep: number;
  /** Tick of the last plan, and the target cell it was made for. */
  planTick: number;
  planX: number;
  planZ: number;
  /** Ticks before it may attack again. */
  cooldown: number;
  /** Ticks it cannot be hurt again (after a hit). */
  invulnerable: number;
  /** It sees its target: field of view and line of sight (tested every 10 ticks). */
  sees: boolean;
  /** Its target looks at it, within 30° and in sight (tested every 10 ticks). */
  watched: boolean;
  /** Ticks since a player last had it in view (despawn). */
  unseen: number;
  /** Members of a herd or a group share the id of its first member. */
  herd: number;
  /** Spawned in a cave (the cave caps). */
  cave: boolean;
}

/** The creature's definition (records only exist for creatures of the pack). */
export function creatureDef(sim: Simulation, c: Readonly<CreatureState>): CreatureDef {
  return sim.registry.creature(c.creature)!;
}

export function isHostile(def: CreatureDef): boolean {
  return def.category === 'hostile';
}

/** Leaving or gone: no longer a creature that acts, fights or counts. */
export function isGone(c: Readonly<CreatureState>): boolean {
  return c.mode === 'dying' || c.mode === 'burrow';
}

/** On its guard (the stealth rule): watching, fleeing or fighting. */
export function isAlert(c: Readonly<CreatureState>): boolean {
  return c.mode !== 'idle' && c.mode !== 'wander' && c.mode !== 'stunned' && !isGone(c);
}

/**
 * A new creature at a position (feet), facing a hashed direction, idle for SETTLE_TICKS; `herd` is
 * the id of its group's first member (itself when −1).
 */
export function spawnCreature(
  sim: Simulation,
  def: CreatureDef,
  x: number,
  y: number,
  z: number,
  herd = -1,
  cave = false,
): CreatureState {
  const id = sim.nextEntityId++;
  const yaw = (hashUnit(sim.ctx.seedHash, id, 0x5eed) * 2 - 1) * Math.PI;
  const c: CreatureState = {
    kind: 'creature',
    id,
    creature: def.key,
    body: { x, y, z, vx: 0, vy: 0, vz: 0, onGround: false },
    prevX: x,
    prevY: y,
    prevZ: z,
    prevYaw: yaw,
    yaw,
    health: def.health,
    mode: 'idle',
    modeTicks: SETTLE_TICKS,
    target: -1,
    goalX: x,
    goalY: y,
    goalZ: z,
    path: [],
    pathLength: 0,
    pathStep: 0,
    planTick: -1,
    planX: 0,
    planZ: 0,
    cooldown: 0,
    invulnerable: 0,
    sees: false,
    watched: false,
    unseen: 0,
    herd: herd < 0 ? id : herd,
    cave,
  };
  sim.entities.set(id, c);
  sim.spatial.update(id, x, z);
  return c;
}

export function removeCreature(sim: Simulation, id: number): void {
  sim.entities.delete(id);
  sim.spatial.remove(id);
}

/** A creature of an unloaded column leaves the simulation with it, kept in `sim.parked`. */
export function parkCreature(sim: Simulation, c: CreatureState): void {
  const key = columnKey(blockToColumn(c.body.x), blockToColumn(c.body.z));
  const parked = sim.parked.get(key);
  if (parked) parked.push(c);
  else sim.parked.set(key, [c]);
  removeCreature(sim, c.id);
}

/**
 * The creatures parked with a column come back when it loads again. The entities stay in id order,
 * the order a restored world adds them in, so that a world plays on alike after a reload.
 */
export function unparkCreatures(sim: Simulation, cx: number, cz: number): void {
  const key = columnKey(cx, cz);
  const parked = sim.parked.get(key);
  if (!parked) return;
  sim.parked.delete(key);
  const entities = [...sim.entities.values(), ...parked].sort((a, b) => a.id - b.id);
  sim.entities.clear();
  for (const entity of entities) sim.entities.set(entity.id, entity);
  for (const c of parked) sim.spatial.update(c.id, c.body.x, c.body.z);
}

/** Height of a creature's eyes (sight lines and blows start there). */
export function eyeY(c: Readonly<CreatureState>, def: CreatureDef): number {
  return c.body.y + def.hitbox[1] * CREATURE_EYE_SHARE;
}

/** Squared horizontal distance to the nearest player (Infinity without players). */
export function nearestPlayer2(sim: Simulation, x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const player of sim.players.values()) {
    const dx = player.body.x - x;
    const dz = player.body.z - z;
    best = Math.min(best, dx * dx + dz * dz);
  }
  return best;
}

/**
 * A creature stands still while its column is not lit (no falling into the void) or no player is
 * within ACTIVE_RADIUS.
 */
export function dormant(sim: Simulation, c: Readonly<CreatureState>): boolean {
  const b = c.body;
  if (sim.columnState(blockToColumn(b.x), blockToColumn(b.z)) < COLUMN_LIT) return true;
  return nearestPlayer2(sim, b.x, b.z) > ACTIVE_RADIUS * ACTIVE_RADIUS;
}

/**
 * Gap between a creature's hitbox and a player's body (edge to edge): the horizontal gap between
 * their footprints (taken as circles) and the vertical gap between their extents, combined.
 */
export function reachGap(
  c: Readonly<CreatureState>,
  def: CreatureDef,
  player: PlayerState,
): number {
  const a = c.body;
  const b = player.body;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const across = Math.max(0, Math.sqrt(dx * dx + dz * dz) - (def.hitbox[0] + PHYSICS.width) / 2);
  const up = Math.max(0, b.y - (a.y + def.hitbox[1]), a.y - (b.y + bodyHeight(b)));
  return Math.sqrt(across * across + up * up);
}

/** Living creatures (none dying or burrowing away): `__game.entities.census()`, headless runs. */
export interface CreatureCensus {
  readonly total: number;
  /** Hostile ones on the surface and in caves (the spawn caps). */
  readonly surfaceHostiles: number;
  readonly caveHostiles: number;
  /** Count per creature key, every creature of the pack listed in its order. */
  readonly byCreature: Readonly<Record<string, number>>;
}

/** Counts the living creatures among entity records (automation and tests, not the tick). */
export function creatureCensus(
  entities: ReadonlyMap<number, Readonly<Entity>>,
  registry: Registry,
): CreatureCensus {
  const byCreature: Record<string, number> = {};
  for (const def of registry.pack.creatures ?? []) byCreature[def.key] = 0;
  let total = 0;
  let surfaceHostiles = 0;
  let caveHostiles = 0;
  for (const c of entities.values()) {
    if (c.kind !== 'creature' || isGone(c)) continue;
    total++;
    byCreature[c.creature] = (byCreature[c.creature] ?? 0) + 1;
    const def = registry.creature(c.creature);
    if (!def || !isHostile(def)) continue;
    if (c.cave) caveHostiles++;
    else surfaceHostiles++;
  }
  return { total, surfaceHostiles, caveHostiles, byCreature };
}

/** Scratch list of nearby entity ids (no allocation once warmed up). */
const near: number[] = [];

/**
 * Whether a hostile creature (not leaving) is within `radius` blocks of a point: the sleep rule
 * (docs « Sommeil »).
 */
export function hostileNear(
  sim: Simulation,
  x: number,
  y: number,
  z: number,
  radius: number,
): boolean {
  sim.spatial.query(x, z, radius, near);
  for (let i = 0; i < near.length; i++) {
    const c = sim.entities.get(near[i]!);
    if (c?.kind !== 'creature' || isGone(c) || !isHostile(creatureDef(sim, c))) continue;
    const dx = c.body.x - x;
    const dy = c.body.y - y;
    const dz = c.body.z - z;
    if (dx * dx + dy * dy + dz * dz <= radius * radius) return true;
  }
  return false;
}
