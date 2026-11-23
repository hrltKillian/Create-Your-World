import type { CreatureDef } from '../../content/schema.ts';
import { ticksOf } from '../clock.ts';
import { stepCreatureBody } from '../creatureBody.ts';
import { type CreatureState, creatureDef, dormant, isGone, removeCreature } from '../creatures.ts';
import type { SimEvent } from '../events.ts';
import type { Simulation } from '../Simulation.ts';
import { daylightAt, hourOf, phaseOf } from '../time.ts';
import { type AiTick, BRAIN, headsStraight, setMode } from './behaviours.ts';
import { think } from './brains.ts';
import { ASTAR } from './pathfind.ts';
import { distanceTo, refreshSenses, SENSE_TICKS, targetOf } from './senses.ts';

/*
 * Tick steps 5 and 6 for creatures (docs « Ordre d'un tick »): timers, a sight test every 10
 * ticks, a thought every 3 (both staggered by id), then movement (steering along the path, or
 * straight at the target) and physics. At most 2 A* searches run per tick. Creatures in unlit
 * columns or far from every player stand still; the dying and burrowing ones leave when their time
 * is up. Zero allocation.
 */

/** Turn rate (radians per tick). */
const TURN_PER_TICK = 0.35;
/** A waypoint is reached within this horizontal distance of its cell's centre. */
const WAYPOINT_REACH = 0.35;
/** How far a burrowing creature sinks per tick. */
const BURROW_SINK = 0.04;
/** Zigzag of a swarmer's chase: phase speed (radians per tick) and sideways share. */
const ZIGZAG_RATE = 0.35;
const ZIGZAG_WIDTH = 0.8;
/** Speed (m/s) at which two fully overlapping creatures drift apart. */
const SEPARATION_SPEED = 2;

const ai: AiTick = { daylight: 1, daytime: true, searches: 0 };

export function stepCreatures(sim: Simulation, out: SimEvent[]): void {
  const hour = hourOf(sim.time.ticks);
  const phase = phaseOf(hour);
  ai.daylight = daylightAt(hour);
  ai.daytime = phase === 'day' || phase === 'dawn';
  ai.searches = ASTAR.searchesPerTick;
  for (const c of sim.entities.values()) {
    if (c.kind !== 'creature') continue;
    const b = c.body;
    c.prevX = b.x;
    c.prevY = b.y;
    c.prevZ = b.z;
    c.prevYaw = c.yaw;
    if (dormant(sim, c)) continue;
    if (c.modeTicks > 0) c.modeTicks--;
    if (c.cooldown > 0) c.cooldown--;
    if (c.invulnerable > 0) c.invulnerable--;
    if (isGone(c) && c.modeTicks === 0) {
      removeCreature(sim, c.id);
      continue;
    }
    const def = creatureDef(sim, c);
    const slot = sim.tick + c.id;
    if (slot % SENSE_TICKS === 0) refreshSenses(sim, c, def);
    if (slot % BRAIN.thinkTicks === 0) think(sim, c, def, ai, out);
    move(sim, c, def);
    sim.spatial.update(c.id, b.x, b.z);
  }
}

/** Wanted direction of this tick (unit), set by `headFor` and swung by `zigzag`. */
let headX = 0;
let headZ = 0;

/** Points the heading from the creature to a point; false when it stands on it. */
function headFor(c: Readonly<CreatureState>, x: number, z: number): boolean {
  const dx = x - c.body.x;
  const dz = z - c.body.z;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length < 1e-6) return false;
  headX = dx / length;
  headZ = dz / length;
  return true;
}

/** Heads for the next cell of the path, skipping those reached; false once it is spent. */
function followPath(c: CreatureState): boolean {
  while (c.pathStep < c.pathLength) {
    const x = c.path[c.pathStep * 3]! + 0.5;
    const z = c.path[c.pathStep * 3 + 2]! + 0.5;
    const dx = x - c.body.x;
    const dz = z - c.body.z;
    if (dx * dx + dz * dz > WAYPOINT_REACH * WAYPOINT_REACH) return headFor(c, x, z);
    c.pathStep++;
  }
  return false;
}

/** Where the creature goes this tick: sets the heading, returns the speed (0: it stands). */
function heading(sim: Simulation, c: CreatureState, def: CreatureDef): number {
  const target = targetOf(sim, c);
  let speed: number;
  switch (c.mode) {
    case 'wander':
      speed = def.speed.walk;
      break;
    case 'flee':
    case 'chase':
      speed = def.speed.run;
      break;
    case 'charge':
      headX = -Math.sin(c.yaw);
      headZ = -Math.cos(c.yaw);
      return def.speed.run;
    default:
      return 0;
  }
  if (c.mode === 'chase' && target && headsStraight(sim, c, def, target, ai.daylight)) {
    if (!headFor(c, target.body.x, target.body.z)) return 0;
    if (def.brain === 'swarmer' && distanceTo(c, target) > 2) zigzag(sim, c);
  } else if (!followPath(c)) {
    return 0;
  }
  const slowed = c.watched ? (def.traits?.watchedSpeedMul ?? 1) : 1;
  return speed * slowed;
}

/** Swings the heading from side to side (the swarmer's approach). */
function zigzag(sim: Simulation, c: Readonly<CreatureState>): void {
  const side = Math.sin((sim.tick + c.id * 13) * ZIGZAG_RATE) * ZIGZAG_WIDTH;
  const x = headX - headZ * side;
  const z = headZ + headX * side;
  const length = Math.sqrt(x * x + z * z);
  headX = x / length;
  headZ = z / length;
}

/** Turns the facing towards a yaw by at most TURN_PER_TICK. */
function turnTo(c: CreatureState, yaw: number): void {
  let delta = yaw - c.yaw;
  delta -= Math.round(delta / (2 * Math.PI)) * 2 * Math.PI;
  c.yaw += Math.max(-TURN_PER_TICK, Math.min(TURN_PER_TICK, delta));
  c.yaw -= Math.round(c.yaw / (2 * Math.PI)) * 2 * Math.PI;
}

/**
 * Scratch list of nearby entity ids, and the push (x, z) `separate` sums: a typed scratch, since
 * V8 boxes a module-level number anew at every `+=` (no allocation).
 */
const near: number[] = [];
const push = new Float64Array(2);

/**
 * Creatures do not collide with each other: overlapping ones drift apart, faster the deeper they
 * overlap (up to SEPARATION_SPEED), so a pack does not stand in one spot.
 */
function separate(sim: Simulation, c: Readonly<CreatureState>, def: CreatureDef): void {
  push[0] = 0;
  push[1] = 0;
  const b = c.body;
  sim.spatial.query(b.x, b.z, def.hitbox[0], near);
  for (let i = 0; i < near.length; i++) {
    const other = sim.entities.get(near[i]!);
    if (other?.kind !== 'creature' || other === c || isGone(other)) continue;
    const dx = b.x - other.body.x;
    const dz = b.z - other.body.z;
    const apart = (def.hitbox[0] + creatureDef(sim, other).hitbox[0]) / 2;
    const d2 = dx * dx + dz * dz;
    if (d2 >= apart * apart || d2 < 1e-12) continue;
    const d = Math.sqrt(d2);
    const depth = (apart - d) / apart;
    push[0] += (dx / d) * depth * SEPARATION_SPEED;
    push[1] += (dz / d) * depth * SEPARATION_SPEED;
  }
}

/** Yaw of a direction (lookVector's convention: 0 looks towards −z). */
function yawOf(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/**
 * Movement of one tick: steering and facing, then the body. A charge into a wall stuns the
 * charger; a hurt creature does not steer while the knockback carries it.
 */
function move(sim: Simulation, c: CreatureState, def: CreatureDef): void {
  const b = c.body;
  if (c.mode === 'burrow') {
    b.y -= BURROW_SINK;
    return;
  }
  const speed = isGone(c) ? 0 : heading(sim, c, def);
  if (speed > 0) {
    if (c.mode !== 'charge') turnTo(c, yawOf(headX, headZ));
  } else {
    const target = targetOf(sim, c);
    if (target && (c.mode === 'watch' || c.mode === 'windup' || c.mode === 'chase'))
      turnTo(c, yawOf(target.body.x - b.x, target.body.z - b.z));
  }
  const steer = c.invulnerable === 0 && !isGone(c);
  const charging = c.mode === 'charge';
  if (!charging) separate(sim, c, def);
  const wantX = (speed > 0 ? headX * speed : 0) + push[0]!;
  const wantZ = (speed > 0 ? headZ * speed : 0) + push[1]!;
  const tables = sim.registry.tables;
  const blocked = stepCreatureBody(
    sim.world,
    tables,
    b,
    def.hitbox[0],
    def.hitbox[1],
    wantX,
    wantZ,
    steer,
    speed > 0 && !charging,
  );
  if (charging && blocked) {
    const stun = def.traits?.wallStunSec;
    setMode(c, stun ? 'stunned' : 'recover', stun ? ticksOf(stun) : BRAIN.recoverTicks);
  }
}
