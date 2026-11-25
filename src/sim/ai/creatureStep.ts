import type { CreatureDef } from '../../content/schema.ts';
import { yawOf } from '../../core/angles.ts';
import { TICK_SECONDS, ticksOf } from '../clock.ts';
import { isLiquid } from '../collision.ts';
import { hurtCreature } from '../combat.ts';
import { stepCreatureBody } from '../creatureBody.ts';
import { type CreatureState, creatureDef, dormant, isGone } from '../creatures.ts';
import type { SimEvent } from '../events.ts';
import type { Simulation } from '../Simulation.ts';
import { departs } from '../spawning.ts';
import { hourOf, phaseOf } from '../time.ts';
import { skyLight } from '../weather.ts';
import { type AiTick, BRAIN, headsStraight, setMode } from './behaviours.ts';
import { think } from './brains.ts';
import { ASTAR } from './pathfind.ts';
import { distanceTo, refreshSenses, SENSE_TICKS, targetOf } from './senses.ts';

/*
 * Tick steps 5 and 6 for creatures (docs « Ordre d'un tick »): timers and needs, a sight test
 * every 10 ticks, a thought every 3 (both staggered by id), then movement and physics. At most 2
 * A* searches run per tick. Creatures in unlit columns or far from every player stand still
 * (dormant); who leaves, and when, is `departs` (spawning.ts). Zero allocation.
 *
 * Fair movement (docs plan v2 « M17 »): a creature turns at its agility's rate and moves the way it
 * faces, slower the further it still has to turn (a feint or a sidestep beats a charge); it runs
 * only while it has stamina (then walks until half is back), slower when wounded; a hop onto a
 * step costs stamina and waits HOP_TICKS; a fall beyond the pack's safe height hurts it.
 */

/** Ticks between two hops, and the stamina (seconds of running) one costs. */
const HOP_TICKS = 15;
const HOP_STAMINA = 0.3;
/** Stamina comes back at this many seconds of running per second when not running. */
const STAMINA_REGEN = 0.5;
/** Speed factor of a creature at no health (full health: 1). */
const WOUNDED_SPEED = 0.6;
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
  // The sky's light under the weather's clouds (plan v3 « M34 »).
  ai.daylight = skyLight(sim);
  ai.daytime = phase === 'day' || phase === 'dawn';
  ai.searches = ASTAR.searchesPerTick;
  for (const c of sim.entities.values()) {
    if (c.kind !== 'creature') continue;
    const b = c.body;
    c.prevX = b.x;
    c.prevY = b.y;
    c.prevZ = b.z;
    c.prevYaw = c.yaw;
    const active = !dormant(sim, c);
    if (active) {
      if (c.modeTicks > 0) c.modeTicks--;
      if (c.cooldown > 0) c.cooldown--;
      if (c.invulnerable > 0) c.invulnerable--;
      if (c.calmTicks > 0) c.calmTicks--;
      if (c.waryTicks > 0) c.waryTicks--;
      if (c.hopTicks > 0) c.hopTicks--;
    }
    const def = creatureDef(sim, c);
    if (departs(sim, c, def, active) || !active) continue;
    if (!isGone(c)) stepNeeds(sim, c, def);
    const slot = sim.tick + c.id;
    if (slot % SENSE_TICKS === 0) refreshSenses(sim, c, def, out);
    if (slot % BRAIN.thinkTicks === 0) think(sim, c, def, ai, out);
    move(sim, c, def, out);
    sim.spatial.update(c.id, b.x, b.z);
  }
}

/** Hunger and thirst fall; a sated creature heals (`balance.creatures.needs`). */
function stepNeeds(sim: Simulation, c: CreatureState, def: CreatureDef): void {
  const needs = sim.registry.pack.balance.creatures.needs;
  const perTick = TICK_SECONDS / 60;
  c.hunger = Math.max(0, c.hunger - needs.hungerPerMin * perTick);
  c.thirst = Math.max(0, c.thirst - needs.thirstPerMin * perTick);
  if (c.hunger > needs.seekBelow && c.thirst > needs.seekBelow && c.health < def.health)
    c.health = Math.min(def.health, c.health + needs.regenPerMin * perTick);
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

/** Whether a mode runs (else it walks): a flight, a chase or a charge. */
function runs(c: Readonly<CreatureState>): boolean {
  return c.mode === 'flee' || c.mode === 'chase' || c.mode === 'charge';
}

/** The creature's running speed now: walking while tired, slower when wounded. */
function runSpeed(c: Readonly<CreatureState>, def: CreatureDef): number {
  const base = c.tired ? def.speed.walk : def.speed.run;
  return base * (WOUNDED_SPEED + ((1 - WOUNDED_SPEED) * c.health) / def.health);
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
      speed = runSpeed(c, def);
      break;
    case 'charge':
      headX = -Math.sin(c.yaw);
      headZ = -Math.cos(c.yaw);
      return runSpeed(c, def);
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

/** The angle from a creature's facing to a yaw, in (−π, π]. */
function turnLeft(c: Readonly<CreatureState>, yaw: number): number {
  const delta = yaw - c.yaw;
  return delta - Math.round(delta / (2 * Math.PI)) * 2 * Math.PI;
}

/** Turns the facing towards a yaw by at most its agility's turn of one tick. */
function turnTo(c: CreatureState, def: CreatureDef, yaw: number): void {
  const most = ((def.agility.turnDegPerSec * Math.PI) / 180) * TICK_SECONDS;
  c.yaw += Math.max(-most, Math.min(most, turnLeft(c, yaw)));
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

/**
 * Movement of one tick: steering and facing (it moves the way it faces), stamina, then the body,
 * a hop and a fall. A charge into a wall stuns the charger; a hurt creature does not steer while
 * the knockback carries it.
 */
function move(sim: Simulation, c: CreatureState, def: CreatureDef, out: SimEvent[]): void {
  const b = c.body;
  if (c.mode === 'burrow') {
    b.y -= BURROW_SINK;
    return;
  }
  let speed = isGone(c) ? 0 : heading(sim, c, def);
  if (speed > 0) {
    if (c.mode !== 'charge') {
      const yaw = yawOf(headX, headZ);
      turnTo(c, def, yaw);
      // Along its facing, as fast as the turn left allows (none while it faces away).
      speed *= Math.max(0, Math.cos(turnLeft(c, yaw)));
      headX = -Math.sin(c.yaw);
      headZ = -Math.cos(c.yaw);
    }
  } else {
    const target = targetOf(sim, c);
    if (target && (c.mode === 'watch' || c.mode === 'windup' || c.mode === 'chase'))
      turnTo(c, def, yawOf(target.body.x - b.x, target.body.z - b.z));
  }
  spendStamina(c, def, speed > 0 && runs(c));
  const steer = c.invulnerable === 0 && !isGone(c);
  const charging = c.mode === 'charge';
  // A charge ignores the others: no push, never the one `separate` left for another creature.
  if (charging) {
    push[0] = 0;
    push[1] = 0;
  } else {
    separate(sim, c, def);
  }
  const wantX = (speed > 0 ? headX * speed : 0) + push[0]!;
  const wantZ = (speed > 0 ? headZ * speed : 0) + push[1]!;
  const tables = sim.registry.tables;
  const grounded = b.onGround;
  const blocked = stepCreatureBody(
    sim.world,
    tables,
    b,
    def.hitbox[0],
    def.hitbox[1],
    wantX,
    wantZ,
    steer,
    speed > 0 && !charging && c.hopTicks === 0,
    def.agility,
  );
  if (grounded && !b.onGround && b.vy > 0) {
    c.hopTicks = HOP_TICKS;
    c.stamina = Math.max(0, c.stamina - HOP_STAMINA);
  }
  if (charging && blocked) {
    const stun = def.traits?.wallStunSec;
    setMode(c, stun ? 'stunned' : 'recover', stun ? ticksOf(stun) : BRAIN.recoverTicks);
  }
  land(sim, c, out);
}

/** Running spends stamina, anything else brings it back; empty, it is tired until half is back. */
function spendStamina(c: CreatureState, def: CreatureDef, running: boolean): void {
  const full = def.stamina.runSeconds;
  c.stamina = running
    ? Math.max(0, c.stamina - TICK_SECONDS)
    : Math.min(full, c.stamina + STAMINA_REGEN * TICK_SECONDS);
  if (c.stamina === 0) c.tired = true;
  else if (c.stamina >= full / 2) c.tired = false;
}

/** Keeps the top of a fall; landing beyond the pack's safe height hurts (a liquid breaks it). */
function land(sim: Simulation, c: CreatureState, out: SimEvent[]): void {
  const b = c.body;
  if (!b.onGround) {
    if (b.vy >= 0 || isLiquid(sim.world, sim.registry.tables, b.x, b.y + 0.2, b.z)) c.airTop = b.y;
    else c.airTop = Math.max(c.airTop, b.y);
    return;
  }
  const fall = sim.registry.pack.balance.creatures.fall;
  const beyond = c.airTop - b.y - fall.safeBlocks;
  c.airTop = b.y;
  if (beyond > 0) hurtCreature(sim, c, beyond * fall.damagePerBlock, b.x, b.z, 0, -1, out);
}
