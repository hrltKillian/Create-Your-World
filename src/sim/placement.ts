import {
  FLAG_REPLACEABLE,
  FLAG_SOLID,
  type RawTables,
  type Registry,
} from '../content/registry.ts';
import { insideBorder, WORLD_HEIGHT } from '../world/coords.ts';
import type { RayHit } from '../world/raycast.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import { solidCell } from './collision.ts';
import { bodyHeight, PHYSICS } from './physics.ts';
import type { PlayerState } from './player.ts';

/** A held secondary button places again every 6 ticks. */
export const PLACE_REPEAT_TICKS = 6;

/** Where a block goes and in which state. */
export interface Placement {
  x: number;
  y: number;
  z: number;
  state: number;
}

/** Reasons a placement is refused (sent back in `rejected`). */
export type PlaceRefusal = 'occupied' | 'support' | 'outside the world';

const EPSILON = 1e-4;

/**
 * Plans the placement of a block (`state`, its default state) against the aimed face: into the
 * aimed cell when it is replaceable (tall grass, water), else into the cell in front of the face.
 * The cell must be replaceable, inside the world and free of players; the block's support rule
 * must hold; its orientation follows the face (axis) or faces the player (facing). A tall block
 * (door) also needs the cell above, for its upper half; `out` holds its lower half. Writes `out`
 * and returns null, or returns the refusal.
 */
export function planPlacement(
  world: VoxelWorld,
  registry: Registry,
  players: Iterable<PlayerState>,
  placer: PlayerState,
  hit: RayHit,
  state: number,
  out: Placement,
): PlaceRefusal | null {
  const tables = registry.tables;
  // A ray that starts inside a block has no face to place against.
  if (hit.nx === 0 && hit.ny === 0 && hit.nz === 0) return 'occupied';
  const intoHit = (tables.flags[hit.state]! & FLAG_REPLACEABLE) !== 0;
  const x = intoHit ? hit.x : hit.x + hit.nx;
  const y = intoHit ? hit.y : hit.y + hit.ny;
  const z = intoHit ? hit.z : hit.z + hit.nz;
  if (y < 0 || y >= WORLD_HEIGHT || !insideBorder(x, z)) return 'outside the world';
  const rules = registry.blockDef(state).placement;
  const cells = rules?.tall ?? 1;
  if (!replaceableCell(world, tables, x, y, z)) return 'occupied';
  if (cells === 2 && !replaceableCell(world, tables, x, y + 1, z)) return 'occupied';
  if (rules?.support === 'below' && !solidCell(world, tables, x, y - 1, z)) return 'support';
  if (rules?.support === 'face' && !solidCell(world, tables, x - hit.nx, y - hit.ny, z - hit.nz))
    return 'support';
  let placed = state;
  if (rules?.orient === 'axis')
    placed = registry.withState(state, 'axis', hit.nx !== 0 ? 'x' : hit.nz !== 0 ? 'z' : 'y');
  else if (rules?.orient === 'facing')
    placed = registry.withState(state, 'facing4', facingTowards(placer.yaw));
  if ((tables.flags[placed]! & FLAG_SOLID) !== 0 && playerInCell(players, x, y, z, cells))
    return 'occupied';
  out.x = x;
  out.y = y;
  out.z = z;
  out.state = placed;
  return null;
}

/** Whether a block can go into the cell: inside the world height, loaded and replaceable. */
function replaceableCell(world: VoxelWorld, tables: RawTables, x: number, y: number, z: number) {
  if (y < 0 || y >= WORLD_HEIGHT) return false;
  const current = world.getBlock(x, y, z);
  return current !== world.outside && (tables.flags[current]! & FLAG_REPLACEABLE) !== 0;
}

/**
 * Tall blocks (`placement.tall`: 2, doors) stand on two cells, told apart by their `half` state
 * (lower, upper). Returns the y of the other half of the tall block at (x, y, z), or y itself when
 * the block there is not tall or its other half is missing (both halves toggle and break as one).
 */
export function otherHalfY(
  world: VoxelWorld,
  registry: Registry,
  x: number,
  y: number,
  z: number,
): number {
  const state = world.getBlock(x, y, z);
  if (registry.blockDef(state).placement?.tall !== 2) return y;
  const half = registry.prop(state, 'half');
  const other = half === 'upper' ? y - 1 : y + 1;
  if (other < 0 || other >= WORLD_HEIGHT) return y;
  const partner = world.getBlock(x, other, z);
  const sameBlock = registry.tables.blockOf[partner] === registry.tables.blockOf[state];
  return sameBlock && registry.prop(partner, 'half') !== half ? other : y;
}

/** The `facing4` value whose front looks back at a viewer with this yaw. */
export function facingTowards(yaw: number): string {
  const lx = -Math.sin(yaw);
  const lz = -Math.cos(yaw);
  if (Math.abs(lx) > Math.abs(lz)) return lx > 0 ? 'w' : 'e';
  return lz > 0 ? 'n' : 's';
}

/** Whether any player's collision box overlaps the block cell (and the `cells` − 1 above it). */
export function playerInCell(
  players: Iterable<PlayerState>,
  x: number,
  y: number,
  z: number,
  cells = 1,
): boolean {
  const half = PHYSICS.width / 2;
  for (const player of players) {
    const b = player.body;
    if (
      b.x + half > x + EPSILON &&
      b.x - half < x + 1 - EPSILON &&
      b.y + bodyHeight(b) > y + EPSILON &&
      b.y < y + cells - EPSILON &&
      b.z + half > z + EPSILON &&
      b.z - half < z + 1 - EPSILON
    )
      return true;
  }
  return false;
}
