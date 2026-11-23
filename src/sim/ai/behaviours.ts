import type { CreatureDef, CreatureSound } from '../../content/schema.ts';
import { hash32, hashUnit } from '../../core/hash.ts';
import { effectiveLight } from '../../world/light.ts';
import { ticksOf } from '../clock.ts';
import {
  type CreatureMode,
  type CreatureState,
  isHostile,
  PATH_MAX,
  reachGap,
} from '../creatures.ts';
import type { SimEvent } from '../events.ts';
import type { PlayerState } from '../player.ts';
import type { Simulation } from '../Simulation.ts';
import { findPath, type PathRequest } from './pathfind.ts';
import { distanceTo, targetable, targetOf } from './senses.ts';

/*
 * What brains are made of (ai/brains.ts): modes and voices, path planning (at most 2 A* searches
 * a tick), grazing and prowling, flight, the chase and the wind-up of an attack. Zero allocation.
 */

/** What every brain shares in a tick. */
export interface AiTick {
  /** Sky light factor of the hour (effective light). */
  daylight: number;
  /** Dawn or day: light-shy burrowers under the sky leave. */
  daytime: boolean;
  /** A* searches left this tick. */
  searches: number;
}

export const BRAIN = {
  /** Ticks between two thoughts (10 Hz). */
  thinkTicks: 3,
  /** A grazer bolts from a player who comes this close (blocks). */
  flightDistance: 6,
  /** How far a fleeing creature runs before it looks again. */
  fleeDistance: 12,
  /** Ticks a grazer keeps watching a player it no longer notices. */
  watchTicks: 90,
  /** Rest between two walks, at least and at most. */
  restTicks: [60, 240] as const,
  /** A walk lasts at most this long, and leads at most this far. */
  wanderTicks: 300,
  wanderDistance: 8,
  /** Pause after a blow. */
  recoverTicks: 8,
  /** Plans again this often while chasing, or when the target moved more than 2 cells. */
  replanTicks: 20,
  /** A chase heads straight for a visible target this close (no path). */
  straightDistance: 6,
  /** A charge lasts this long when it hits nothing. */
  chargeTicks: 45,
  /** Sinking away at dawn. */
  burrowTicks: 30,
  /** Chance per thought of an idle voice. */
  idleVoice: 1 / 200,
  /** Hostiles prowl towards a player within this many blocks, within this angle (radians). */
  prowlRadius: 64,
  prowlSpread: Math.PI / 2,
} as const;

/** A path's light limit when the light does not matter (above the brightest light, 15). */
const NO_LIGHT_LIMIT = 16;

/** The request of the next search (no allocation). */
const request: PathRequest = {
  fromX: 0,
  fromY: 0,
  fromZ: 0,
  toX: 0,
  toY: 0,
  toZ: 0,
  clearance: 1,
  lightLimit: NO_LIGHT_LIMIT,
  daylight: 1,
};

export function setMode(c: CreatureState, mode: CreatureMode, ticks = 0): void {
  c.mode = mode;
  c.modeTicks = ticks;
}

/** Plays one of the creature's voices at its body. */
export function voice(
  c: Readonly<CreatureState>,
  def: CreatureDef,
  sound: CreatureSound,
  out: SimEvent[],
): void {
  const sfx = def.sounds[sound];
  if (sfx)
    out.push({ type: 'sound', sfx, x: c.body.x, y: c.body.y + def.hitbox[1] / 2, z: c.body.z });
}

/** Effective light of the cell a body's feet stand in. */
export function lightAt(
  sim: Simulation,
  at: { readonly x: number; readonly y: number; readonly z: number },
  daylight: number,
): number {
  const packed = sim.world.getLight(Math.floor(at.x), Math.floor(at.y + 0.01), Math.floor(at.z));
  return effectiveLight(packed, daylight);
}

/**
 * Plans a path to a cell (one of this tick's A* searches): false when none is left, and the
 * creature keeps its old path until it thinks again. A light-shy creature's path avoids the light,
 * unless it is running out of it (`shunLight` false).
 */
export function plan(
  sim: Simulation,
  c: CreatureState,
  def: CreatureDef,
  x: number,
  y: number,
  z: number,
  ai: AiTick,
  shunLight = true,
): boolean {
  if (ai.searches <= 0) return false;
  ai.searches--;
  request.fromX = Math.floor(c.body.x);
  request.fromY = Math.floor(c.body.y + 0.01);
  request.fromZ = Math.floor(c.body.z);
  request.toX = Math.floor(x);
  request.toY = Math.floor(y + 0.01);
  request.toZ = Math.floor(z);
  request.clearance = Math.ceil(def.hitbox[1]);
  request.lightLimit = shunLight ? (def.traits?.lightAversion ?? NO_LIGHT_LIMIT) : NO_LIGHT_LIMIT;
  request.daylight = ai.daylight;
  c.pathLength = findPath(sim.world, sim.registry.tables, request, c.path, PATH_MAX);
  c.pathStep = 0;
  c.planTick = sim.tick;
  c.planX = request.toX;
  c.planZ = request.toZ;
  return true;
}

export function pathSpent(c: Readonly<CreatureState>): boolean {
  return c.pathStep >= c.pathLength;
}

/** A value in [0, 1) drawn for this creature at this tick (salted). */
function draw(sim: Simulation, c: Readonly<CreatureState>, salt: number): number {
  return hashUnit(hash32(sim.ctx.seedHash, c.id, sim.tick), salt);
}

/**
 * Direction (radians on the ground plane, as `atan2(dz, dx)`) of the nearest targetable player
 * within `BRAIN.prowlRadius`; NaN when there is none.
 */
function prowlAngle(sim: Simulation, c: Readonly<CreatureState>): number {
  let best = BRAIN.prowlRadius * BRAIN.prowlRadius;
  let angle = Number.NaN;
  for (const player of sim.players.values()) {
    const dx = player.body.x - c.body.x;
    const dz = player.body.z - c.body.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > best || !targetable(sim, player)) continue;
    best = d2;
    angle = Math.atan2(dz, dx);
  }
  return angle;
}

/**
 * Idle, then a walk to a spot within a few blocks, then idle again. Hostiles prowl: their walks
 * lead roughly towards the nearest player around.
 */
export function graze(
  sim: Simulation,
  c: CreatureState,
  def: CreatureDef,
  ai: AiTick,
  out: SimEvent[],
) {
  if (c.mode === 'wander' && c.modeTicks > 0 && !pathSpent(c)) return;
  if (c.mode !== 'idle') {
    const min = BRAIN.restTicks[0];
    setMode(c, 'idle', min + Math.floor(draw(sim, c, 1) * (BRAIN.restTicks[1] - min)));
    c.pathLength = 0;
    return;
  }
  if (draw(sim, c, 2) < BRAIN.idleVoice) voice(c, def, 'idle', out);
  if (c.modeTicks > 0) return;
  const towards = isHostile(def) ? prowlAngle(sim, c) : Number.NaN;
  const angle = Number.isNaN(towards)
    ? draw(sim, c, 3) * 2 * Math.PI
    : towards + (draw(sim, c, 3) - 0.5) * BRAIN.prowlSpread;
  const reach = 2 + draw(sim, c, 4) * (BRAIN.wanderDistance - 2);
  c.goalX = c.body.x + Math.cos(angle) * reach;
  c.goalY = c.body.y;
  c.goalZ = c.body.z + Math.sin(angle) * reach;
  if (plan(sim, c, def, c.goalX, c.goalY, c.goalZ, ai)) setMode(c, 'wander', BRAIN.wanderTicks);
}

/** Runs off, away from a point, for `ticks` (at least what is left of a flight under way). */
export function flee(c: CreatureState, fromX: number, fromZ: number, ticks: number): void {
  aimAway(c, fromX, fromZ);
  setMode(c, 'flee', Math.max(ticks, c.mode === 'flee' ? c.modeTicks : 0));
  c.pathLength = 0;
  c.planTick = -1;
}

/** Sets the goal a flight's length away from a point. */
function aimAway(c: CreatureState, fromX: number, fromZ: number): void {
  let dx = c.body.x - fromX;
  let dz = c.body.z - fromZ;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length < 1e-6) {
    // Right on it: straight back.
    dx = Math.sin(c.yaw);
    dz = Math.cos(c.yaw);
  } else {
    dx /= length;
    dz /= length;
  }
  c.goalX = c.body.x + dx * BRAIN.fleeDistance;
  c.goalY = c.body.y;
  c.goalZ = c.body.z + dz * BRAIN.fleeDistance;
}

/** Plans again at most every `replanTicks` (a cornered creature would search every thought). */
export function mayPlan(sim: Simulation, c: Readonly<CreatureState>): boolean {
  return c.planTick < 0 || sim.tick - c.planTick >= BRAIN.replanTicks;
}

/** While fleeing: plans the way to its goal, then further away from the threat once there. */
export function keepFleeing(sim: Simulation, c: CreatureState, def: CreatureDef, ai: AiTick): void {
  if (!pathSpent(c) || !mayPlan(sim, c)) return;
  const threat = targetOf(sim, c);
  if (threat && c.planTick >= 0) aimAway(c, threat.body.x, threat.body.z);
  plan(sim, c, def, c.goalX, c.goalY, c.goalZ, ai);
}

/**
 * Closes in on a target: a wind-up when in reach and ready, else the chase (a path planned again
 * every 20 ticks, or when the target moved more than 2 cells; none while it heads straight for a
 * visible target).
 */
export function fight(
  sim: Simulation,
  c: CreatureState,
  def: CreatureDef,
  target: PlayerState,
  ai: AiTick,
  out: SimEvent[],
): void {
  const attack = def.attack;
  if (attack && c.cooldown === 0 && reachGap(c, def, target) <= attack.reach) {
    windUp(c, def, out);
    return;
  }
  if (c.mode !== 'chase') setMode(c, 'chase');
  if (headsStraight(sim, c, def, target, ai.daylight)) return;
  const tx = Math.floor(target.body.x);
  const tz = Math.floor(target.body.z);
  const moved = Math.abs(tx - c.planX) > 2 || Math.abs(tz - c.planZ) > 2;
  if (moved || mayPlan(sim, c)) plan(sim, c, def, target.body.x, target.body.y, target.body.z, ai);
}

/**
 * The chase goes straight at a visible target within 6 blocks (unless it stands in a light the
 * creature shuns).
 */
export function headsStraight(
  sim: Simulation,
  c: Readonly<CreatureState>,
  def: CreatureDef,
  target: Readonly<PlayerState>,
  daylight: number,
): boolean {
  if (!c.sees || distanceTo(c, target) > BRAIN.straightDistance) return false;
  const shy = def.traits?.lightAversion;
  return shy === undefined || lightAt(sim, target.body, daylight) < shy;
}

/**
 * Modes the brain waits out: a wind-up until combat.ts lands its blow (the tick it ends), the
 * other timed ones until their time is up.
 */
export function busy(c: Readonly<CreatureState>): boolean {
  if (c.mode === 'windup') return true;
  return c.modeTicks > 0 && (c.mode === 'charge' || c.mode === 'recover' || c.mode === 'stunned');
}

/** Starts the telegraph of an attack (the charger's ends in a charge, the others' in a blow). */
export function windUp(c: CreatureState, def: CreatureDef, out: SimEvent[]): void {
  if (!def.attack) return;
  setMode(c, 'windup', ticksOf(def.attack.windup));
  c.pathLength = 0;
  voice(c, def, 'attack', out);
}
