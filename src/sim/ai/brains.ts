import type { CreatureBrain, CreatureDef } from '../../content/schema.ts';
import { feetCell } from '../../core/creatures.ts';
import { effectiveLight, skyOf } from '../../world/light.ts';
import { ticksOf } from '../clock.ts';
import { type CreatureState, isGone } from '../creatures.ts';
import type { SimEvent } from '../events.ts';
import type { Simulation } from '../Simulation.ts';
import {
  type AiTick,
  BRAIN,
  busy,
  fight,
  flee,
  graze,
  keepFleeing,
  lightAt,
  mayPlan,
  pathSpent,
  plan,
  search,
  setMode,
  voice,
  windUp,
} from './behaviours.ts';
import { distanceTo, NOISE, noiseOf, notices, targetOf } from './senses.ts';

/*
 * The five brains (docs « Créatures et combat », « Comportements »): state machines over the
 * creature's `mode`, parametrised by its data (speeds, senses, attack, traits). A brain thinks 10
 * times a second (ai/creatureStep.ts, staggered by id): it picks a mode, a goal and plans a path;
 * movement follows that every tick, and combat.ts lands the blows when a wind-up ends.
 *
 * - grazer: grazes, watches a player it notices, bolts when they come close, are loud or hurt it;
 * - defender: grazes, and charges whoever hurts it or its herd until they are out of sight;
 * - stalker: prowls, hunts a player it notices, shuns the light and burrows at dawn;
 * - swarmer: hunts in zigzags (movement);
 * - charger: grazes, and rams a player who comes within its territory.
 */

function grazer(sim: Simulation, c: CreatureState, def: CreatureDef, ai: AiTick, out: SimEvent[]) {
  const player = targetOf(sim, c);
  if (c.mode === 'flee') {
    // Out of breath, it stops and stays wary; else it runs while startled or the threat is near.
    if (c.tired) {
      setMode(c, 'watch', BRAIN.watchTicks);
      c.waryTicks = BRAIN.waryTicks;
      c.pathLength = 0;
      return;
    }
    const near = player && notices(c, def, player) && distanceTo(c, player) < BRAIN.fleeDistance;
    if (c.modeTicks > 0 || near) {
      keepFleeing(sim, c, def, ai);
      return;
    }
  }
  if (player && notices(c, def, player)) {
    const startled =
      distanceTo(c, player) <= BRAIN.flightDistance || noiseOf(player) >= NOISE.fight;
    if (startled && c.waryTicks === 0) {
      voice(c, def, 'alert', out);
      flee(c, player.body.x, player.body.z, fleeTicks(def));
      keepFleeing(sim, c, def, ai);
      return;
    }
    if (c.mode !== 'watch') voice(c, def, 'alert', out);
    setMode(c, 'watch', BRAIN.watchTicks);
    return;
  }
  if (c.mode === 'watch' && c.modeTicks > 0) return;
  graze(sim, c, def, ai, out);
}

/**
 * Calm until hurt (combat.ts `alarm` sets the chase): then fights its attacker while it notices
 * them, searches where it lost them, and gives up.
 */
function defender(
  sim: Simulation,
  c: CreatureState,
  def: CreatureDef,
  ai: AiTick,
  out: SimEvent[],
) {
  if (busy(c)) return;
  if (fighting(c) && pursue(sim, c, def, ai, out)) return;
  graze(sim, c, def, ai, out);
}

/**
 * A fight goes on: at the target it notices (sight or hearing), else where it lost it (`search`,
 * out of its senses or out of its range alike). Returns false once it gave up.
 */
function pursue(
  sim: Simulation,
  c: CreatureState,
  def: CreatureDef,
  ai: AiTick,
  out: SimEvent[],
): boolean {
  const player = targetOf(sim, c);
  if (player && notices(c, def, player)) {
    fight(sim, c, def, player, ai, out);
    return true;
  }
  return search(sim, c, def, ai);
}

/**
 * Hunts a target it notices; once out of its senses, searches where it lost it, then gives up;
 * prowls otherwise (and while calm after giving up).
 */
function hunt(sim: Simulation, c: CreatureState, def: CreatureDef, ai: AiTick, out: SimEvent[]) {
  if (c.calmTicks === 0) {
    if (fighting(c) && pursue(sim, c, def, ai, out)) return;
    const player = targetOf(sim, c);
    if (player && notices(c, def, player)) {
      voice(c, def, 'alert', out);
      c.chaseTicks = 0;
      fight(sim, c, def, player, ai, out);
      return;
    }
  }
  graze(sim, c, def, ai, out);
}

/** A grazer's flight when startled or hurt (its `fleeSec`, else 4 s). */
function fleeTicks(def: CreatureDef): number {
  return ticksOf(def.traits?.fleeSec ?? 4);
}

/** Chasing, winding up or recovering from a blow: on a target. */
function fighting(c: Readonly<CreatureState>): boolean {
  return c.mode === 'chase' || c.mode === 'recover' || c.mode === 'windup';
}

/** Seconds a light-shy creature runs for the dark before it looks again. */
const LIGHT_FLIGHT_SEC = 2;

/** The darkest of 8 spots around (6 blocks away, same height): where a light-shy creature runs. */
function fleeLight(sim: Simulation, c: CreatureState, def: CreatureDef, ai: AiTick): void {
  let bestX = c.body.x;
  let bestZ = c.body.z;
  let best = 16;
  const y = feetCell(c.body.y);
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    const x = c.body.x + Math.cos(angle) * 6;
    const z = c.body.z + Math.sin(angle) * 6;
    const light = effectiveLight(sim.world.getLight(Math.floor(x), y, Math.floor(z)), ai.daylight);
    if (light < best) {
      best = light;
      bestX = x;
      bestZ = z;
    }
  }
  setMode(c, 'flee', ticksOf(LIGHT_FLIGHT_SEC));
  c.goalX = bestX;
  c.goalY = c.body.y;
  c.goalZ = bestZ;
  // Every way out of the light crosses lit cells.
  plan(sim, c, def, bestX, c.body.y, bestZ, ai, false);
}

function stalker(sim: Simulation, c: CreatureState, def: CreatureDef, ai: AiTick, out: SimEvent[]) {
  const traits = def.traits;
  if (traits?.burrowAtDawn && ai.daytime && underSky(sim, c)) {
    setMode(c, 'burrow', BRAIN.burrowTicks);
    return;
  }
  if (busy(c)) return;
  const shy = traits?.lightAversion;
  if (shy !== undefined && lightAt(sim, c.body, ai.daylight) >= shy) {
    if (c.mode !== 'flee' || (pathSpent(c) && mayPlan(sim, c))) fleeLight(sim, c, def, ai);
    return;
  }
  if (c.mode === 'flee' && c.modeTicks > 0) return;
  hunt(sim, c, def, ai, out);
}

/** Some sky light reaches the creature's head: it is not in a cave. */
function underSky(sim: Simulation, c: Readonly<CreatureState>): boolean {
  const b = c.body;
  return skyOf(sim.world.getLight(Math.floor(b.x), Math.floor(b.y + 0.5), Math.floor(b.z))) > 0;
}

function swarmer(sim: Simulation, c: CreatureState, def: CreatureDef, ai: AiTick, out: SimEvent[]) {
  if (!busy(c)) hunt(sim, c, def, ai, out);
}

/** Grazes, and winds up a charge at a player noticed within its territory. */
function charger(sim: Simulation, c: CreatureState, def: CreatureDef, ai: AiTick, out: SimEvent[]) {
  if (busy(c)) return;
  const player = targetOf(sim, c);
  const territory = def.traits?.territoryRadius ?? 0;
  const ready = c.cooldown === 0 && c.calmTicks === 0;
  if (player && ready && distanceTo(c, player) <= territory && notices(c, def, player)) {
    windUp(c, def, out);
    return;
  }
  graze(sim, c, def, ai, out);
}

type Brain = (
  sim: Simulation,
  c: CreatureState,
  def: CreatureDef,
  ai: AiTick,
  out: SimEvent[],
) => void;

const BRAINS: Readonly<Record<CreatureBrain, Brain>> = {
  grazer,
  defender,
  stalker,
  swarmer,
  charger,
};

/** One thought of a creature's brain. */
export function think(
  sim: Simulation,
  c: CreatureState,
  def: CreatureDef,
  ai: AiTick,
  out: SimEvent[],
): void {
  if (!isGone(c)) BRAINS[def.brain](sim, c, def, ai, out);
}

/**
 * A creature hurt by an entity (combat.ts) reacts at once: a grazer flees; a defender turns on the
 * attacker, and so does its herd within `herdAlertRadius`; hunters hunt the attacker; a charger
 * winds up a charge when ready. Paths are planned at the next thought.
 */
export function alarm(
  sim: Simulation,
  c: CreatureState,
  def: CreatureDef,
  attacker: number,
  fromX: number,
  fromZ: number,
  out: SimEvent[],
): void {
  if (isGone(c)) return;
  if (sim.entities.get(attacker)?.kind === 'player') c.target = attacker;
  c.pathLength = 0;
  if (def.brain === 'grazer') {
    flee(c, fromX, fromZ, fleeTicks(def));
  } else if (def.brain === 'charger') {
    if (c.cooldown === 0 && c.mode !== 'windup' && c.mode !== 'charge') windUp(c, def, out);
  } else if (c.mode !== 'windup') {
    if (!fighting(c)) c.chaseTicks = 0;
    c.calmTicks = 0;
    setMode(c, 'chase');
  }
  if (def.brain === 'defender' && def.traits?.herdAlertRadius) rallyHerd(sim, c, def, out);
}

/** Scratch list of nearby entity ids (no allocation once warmed up). */
const near: number[] = [];

/** The calm members of a creature's herd within its alert radius turn on its target too. */
function rallyHerd(sim: Simulation, c: CreatureState, def: CreatureDef, out: SimEvent[]): void {
  const radius = def.traits?.herdAlertRadius ?? 0;
  sim.entitiesNear(c.body.x, c.body.z, radius, near);
  for (let i = 0; i < near.length; i++) {
    const other = sim.entities.get(near[i]!);
    if (other?.kind !== 'creature' || other === c || other.herd !== c.herd || isGone(other))
      continue;
    if (fighting(other)) continue;
    other.target = c.target;
    other.pathLength = 0;
    other.chaseTicks = 0;
    other.calmTicks = 0;
    setMode(other, 'chase');
    voice(other, def, 'alert', out);
  }
}
