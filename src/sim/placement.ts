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
import { isGone } from './creatures.ts';
import { bodyHeight, PHYSICS } from './physics.ts';
import type { PlayerState } from './player.ts';
import type { Entity } from './Simulation.ts';

/** A held secondary button places again every 6 ticks. */
export const PLACE_REPEAT_TICKS = 6;

/** Where a block goes and in which state. */
export interface Placement {
  x: number;
  y: number;
  z: number;
  state: number;
  /** State of the upper half of a tall block (door), in the cell above; −1 for one-cell blocks. */
  upper: number;
}

/** Reasons a placement is refused (sent back in `rejected`). */
export type PlaceRefusal = 'occupied' | 'support' | 'outside the world';

const EPSILON = 1e-4;

/**
 * Plans the placement of a block (`state`, its default state) against the aimed face: into the
 * aimed cell when it is replaceable (tall grass, water) and not already that block, else into the
 * cell in front of the face. The cell must be replaceable, inside the world and, for a solid
 * block, free of `entities` (bodyInCell); the block's support rule must hold; its orientation
 * follows the face (axis) or faces the player (facing). A tall block (door) also needs the cell
 * above, for its upper half (`out.upper`). Writes `out` and returns null, or returns the refusal.
 */
export function planPlacement(
  world: VoxelWorld,
  registry: Registry,
  entities: ReadonlyMap<number, Readonly<Entity>>,
  placer: PlayerState,
  hit: RayHit,
  state: number,
  out: Placement,
): PlaceRefusal | null {
  const tables = registry.tables;
  // A ray that starts inside a block has no face to place against.
  if (hit.nx === 0 && hit.ny === 0 && hit.nz === 0) return 'occupied';
  // Placing a block into the same block would use an item and change nothing.
  const intoHit =
    (tables.flags[hit.state]! & FLAG_REPLACEABLE) !== 0 &&
    tables.blockOf[hit.state] !== tables.blockOf[state];
  const x = intoHit ? hit.x : hit.x + hit.nx;
  const y = intoHit ? hit.y : hit.y + hit.ny;
  const z = intoHit ? hit.z : hit.z + hit.nz;
  if (y < 0 || y >= WORLD_HEIGHT || !insideBorder(x, z)) return 'outside the world';
  const rules = registry.blockDef(state).placement;
  const cells = rules?.tall ?? 1;
  if (!replaceableCell(world, tables, x, y, z)) return 'occupied';
  if (cells === 2 && !replaceableCell(world, tables, x, y + 1, z)) return 'occupied';
  let placed = state;
  // A block that hangs (torch): on the wall aimed at, or on the floor; never on a ceiling.
  if (registry.prop(state, 'attach') !== undefined) {
    if (!intoHit && hit.ny < 0) return 'support';
    const side = intoHit || hit.ny > 0 ? 'floor' : wallOf(hit.nx, hit.nz);
    placed = registry.withState(placed, 'attach', side);
  }
  if (registry.prop(placed, 'placed') !== undefined)
    placed = registry.withState(placed, 'placed', '1');
  if (!supportHolds(world, registry, x, y, z, placed)) return 'support';
  if (rules?.orient === 'axis')
    placed = registry.withState(placed, 'axis', hit.nx !== 0 ? 'x' : hit.nz !== 0 ? 'z' : 'y');
  else if (rules?.orient === 'facing')
    placed = registry.withState(placed, 'facing4', facingTowards(placer.yaw));
  if ((tables.flags[placed]! & FLAG_SOLID) !== 0 && bodyInCell(entities, registry, x, y, z, cells))
    return 'occupied';
  out.x = x;
  out.y = y;
  out.z = z;
  out.state = placed;
  out.upper = cells === 2 ? registry.withState(placed, 'half', 'upper') : -1;
  return null;
}

/**
 * The `attach` side of a block hung on the face whose normal is (nx, nz): the wall lies against
 * the normal (the +z face of a block is the north wall of the cell in front of it).
 */
function wallOf(nx: number, nz: number): string {
  if (nx !== 0) return nx > 0 ? 'w' : 'e';
  return nz > 0 ? 'n' : 's';
}

/** Cell offset of each wall side (n is −z), as x, z pairs. */
const WALL_OFFSET: Readonly<Record<string, readonly [number, number]>> = {
  n: [0, -1],
  e: [1, 0],
  s: [0, 1],
  w: [-1, 0],
};

/**
 * Whether what holds a block in a cell is there (`placement.support`): the solid block below, or
 * for a hung block (`attach`) its floor or its wall. Blocks without a support rule always hold.
 */
export function supportHolds(
  world: VoxelWorld,
  registry: Registry,
  x: number,
  y: number,
  z: number,
  state: number,
): boolean {
  const support = registry.blockDef(state).placement?.support;
  if (support === undefined) return true;
  const tables = registry.tables;
  const side = support === 'attach' ? registry.prop(state, 'attach') : 'floor';
  const offset = side === undefined || side === 'floor' ? undefined : WALL_OFFSET[side];
  if (!offset) return solidCell(world, tables, x, y - 1, z);
  return solidCell(world, tables, x + offset[0], y, z + offset[1]);
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

/**
 * Whether a body overlaps the block cell (and the `cells` − 1 above it): a player's collision box
 * or the hitbox of a creature that is not leaving (docs « Poser »: no entity in the cell). Item
 * drops do not count.
 */
export function bodyInCell(
  entities: ReadonlyMap<number, Readonly<Entity>>,
  registry: Registry,
  x: number,
  y: number,
  z: number,
  cells = 1,
): boolean {
  for (const e of entities.values()) {
    let half: number;
    let height: number;
    if (e.kind === 'player') {
      half = PHYSICS.width / 2;
      height = bodyHeight(e.body);
    } else if (e.kind === 'creature' && !isGone(e)) {
      const hitbox = registry.creature(e.creature)!.hitbox;
      half = hitbox[0] / 2;
      height = hitbox[1];
    } else continue;
    const b = e.body;
    if (
      b.x + half > x + EPSILON &&
      b.x - half < x + 1 - EPSILON &&
      b.y + height > y + EPSILON &&
      b.y < y + cells - EPSILON &&
      b.z + half > z + EPSILON &&
      b.z - half < z + 1 - EPSILON
    )
      return true;
  }
  return false;
}
