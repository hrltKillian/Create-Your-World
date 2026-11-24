import type { RawTables } from '../../content/registry.ts';
import type { CreatureDef } from '../../content/schema.ts';
import { lookVector, type Vec3 } from '../../core/angles.ts';
import { centreY } from '../../core/creatures.ts';
import { createRayHit, RAY_OPAQUE, type RAY_SOLID, raycast } from '../../world/raycast.ts';
import type { VoxelWorld } from '../../world/VoxelWorld.ts';
import { type CreatureState, eyeY, isAlert } from '../creatures.ts';
import { eyeHeight } from '../physics.ts';
import type { PlayerState } from '../player.ts';
import type { Simulation } from '../Simulation.ts';
import { hasEffect } from '../survival.ts';

/*
 * Creature senses (docs « Créatures et combat »): hearing the player's noises, sight within a range
 * and a field of view with a DDA line of sight, and whether a player looks at the creature. Lines
 * of sight are tested every SENSE_TICKS ticks (staggered by id) and kept in the record. Zero
 * allocation.
 */

/** Radii of the player's noises, in blocks (`senses.hearing` scales them per creature). */
export const NOISE = { crouch: 2, walk: 6, mine: 10, fight: 12, sprint: 14 } as const;
/** A creature keeps track of a target within this many times its sight (and hunts it there). */
export const TRACK_FACTOR = 1.5;
/** Ticks between two sight tests of a creature. */
export const SENSE_TICKS = 10;
/** A player watches a creature within this angle of the view (the Prowler slows down). */
const WATCHED_COS = Math.cos((30 * Math.PI) / 180);
/** A player has a creature in view within this angle of the view (despawn). */
const IN_VIEW_COS = Math.cos((60 * Math.PI) / 180);
/** Longest line of sight tested, in blocks. */
const SIGHT_LIMIT = 64;

/** Radius of the noise a player makes this tick (0: still and silent). */
export function noiseOf(player: Readonly<PlayerState>): number {
  const b = player.body;
  if (player.survival.health <= 0) return 0;
  if (player.sprinting) return NOISE.sprint;
  if (player.fightTicks > 0) return NOISE.fight;
  if (player.interaction.mineStage >= 0) return NOISE.mine;
  if (Math.abs(b.vx) + Math.abs(b.vz) < 0.1) return 0;
  return b.crouching ? NOISE.crouch : NOISE.walk;
}

/** Whether a creature may go after a player: alive, in a loaded column, not Unnoticed. */
export function targetable(sim: Simulation, player: Readonly<PlayerState>): boolean {
  const s = player.survival;
  return s.health > 0 && sim.isActive(player) && !hasEffect(s, 'untargeted');
}

/** The player a creature is after, if still targetable. */
export function targetOf(sim: Simulation, c: Readonly<CreatureState>): PlayerState | undefined {
  if (c.target < 0) return undefined;
  const entity = sim.entities.get(c.target);
  return entity?.kind === 'player' && targetable(sim, entity) ? entity : undefined;
}

/** Distance between a creature's feet and a player's feet. */
export function distanceTo(c: Readonly<CreatureState>, player: Readonly<PlayerState>): number {
  const dx = player.body.x - c.body.x;
  const dy = player.body.y - c.body.y;
  const dz = player.body.z - c.body.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** It sees the player (last sight test) or hears the noise the player makes now. */
export function notices(
  c: Readonly<CreatureState>,
  def: CreatureDef,
  player: Readonly<PlayerState>,
): boolean {
  return c.sees || distanceTo(c, player) <= noiseOf(player) * def.senses.hearing;
}

/** Scratch hit of lineOfSight. */
const sight = createRayHit();

/**
 * Whether nothing opaque lies between two points (two points of one cell included): the voxel walk
 * of world/raycast.ts along the segment, stopped by opaque blocks only (creatures see through
 * glass, plants and water). With `RAY_SOLID`, stopped by every block with collision instead (a
 * blow: glass, foliage and closed gates shield). Unloaded cells block.
 */
export function lineOfSight(
  world: VoxelWorld,
  tables: RawTables,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  mode: typeof RAY_OPAQUE | typeof RAY_SOLID = RAY_OPAQUE,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  // Two equal points: a ray of length 0 with no direction tests their cell alone.
  const k = length > 0 ? 1 / length : 0;
  raycast(world, tables, x0, y0, z0, dx * k, dy * k, dz * k, length, sight, mode);
  return !sight.hit;
}

const look: Vec3 = { x: 0, y: 0, z: -1 };

/** Cosine of the angle between a player's view and the direction from their eye to a point. */
function viewCos(player: Readonly<PlayerState>, x: number, y: number, z: number): number {
  const b = player.body;
  lookVector(player.yaw, player.pitch, look);
  const vx = x - b.x;
  const vy = y - (b.y + eyeHeight(b));
  const vz = z - b.z;
  const length = Math.sqrt(vx * vx + vy * vy + vz * vz);
  return length < 1e-6 ? 1 : (vx * look.x + vy * look.y + vz * look.z) / length;
}

/** Whether a point lies within a creature's field of view (on the ground plane). */
export function inFieldOfView(
  c: Readonly<CreatureState>,
  def: CreatureDef,
  x: number,
  z: number,
): boolean {
  if (def.senses.fovDeg >= 360) return true;
  const dx = x - c.body.x;
  const dz = z - c.body.z;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length < 1e-6) return true;
  // Facing vector of the yaw (lookVector at pitch 0).
  const facing = (-Math.sin(c.yaw) * dx - Math.cos(c.yaw) * dz) / length;
  return facing >= Math.cos((def.senses.fovDeg * Math.PI) / 360);
}

/**
 * The stealth rule (docs « Combat »: a stealthy blow deals ×1.5): the creature is not on its guard
 * and the player stands out of its field of view.
 */
export function unawareOf(
  c: Readonly<CreatureState>,
  def: CreatureDef,
  player: Readonly<PlayerState>,
): boolean {
  return !isAlert(c) && !inFieldOfView(c, def, player.body.x, player.body.z);
}

/** The nearest player within `range` (targetable ones only with `targets`), else undefined. */
function nearestPlayer(
  sim: Simulation,
  c: Readonly<CreatureState>,
  range: number,
  targets: boolean,
): PlayerState | undefined {
  let best: PlayerState | undefined;
  let bestD = range;
  for (const player of sim.players.values()) {
    if (targets && !targetable(sim, player)) continue;
    const d = distanceTo(c, player);
    if (d <= bestD) {
      best = player;
      bestD = d;
    }
  }
  return best;
}

/**
 * A sight test (every SENSE_TICKS): the creature keeps its target, else picks the nearest
 * targetable player within TRACK_FACTOR × its sight. One line of sight between its eye and the eye of that
 * player (else of the nearest one) is tested when the player may be seen or looks its way: it
 * `sees` its target (range and field of view), is `watched` (within 30° of the view) or in view
 * (within 60°: `unseen` starts again).
 */
export function refreshSenses(sim: Simulation, c: CreatureState, def: CreatureDef): void {
  const range = def.senses.sight * TRACK_FACTOR;
  let target = targetOf(sim, c);
  if (!target || distanceTo(c, target) > range) target = nearestPlayer(sim, c, range, true);
  c.target = target ? target.id : -1;
  c.sees = false;
  c.watched = false;
  c.unseen += SENSE_TICKS;
  const player = target ?? nearestPlayer(sim, c, SIGHT_LIMIT, false);
  if (!player) return;
  const b = player.body;
  const eye = b.y + eyeHeight(b);
  const cy = eyeY(c, def);
  const d = distanceTo(c, player);
  const canSee = player === target && d <= def.senses.sight && inFieldOfView(c, def, b.x, b.z);
  const cos = viewCos(player, c.body.x, centreY(c.body.y, def.hitbox[1]), c.body.z);
  if (!canSee && cos < IN_VIEW_COS) return;
  if (d > SIGHT_LIMIT) return;
  if (!lineOfSight(sim.world, sim.registry.tables, c.body.x, cy, c.body.z, b.x, eye, b.z)) return;
  c.sees = canSee;
  c.watched = cos >= WATCHED_COS;
  if (cos >= IN_VIEW_COS) c.unseen = 0;
}
