import type { Registry } from '../../content/registry.ts';
import type { Column } from '../Column.ts';
import { columnIndex, localIndex, SECTION_BITS, SECTION_MASK, SECTION_SIZE } from '../coords.ts';
import { FLAT_SURFACE } from './flat.ts';

/** Block states of the arena test world (from the pack's `arena` description). */
export interface ResolvedArena {
  readonly wall: number;
  readonly roof: number;
  /** Closed door facing south (the cabin's door is in its south wall): lower and upper half. */
  readonly door: number;
  readonly doorTop: number;
  readonly window: number;
  readonly liquid: number;
  readonly shore: number;
  readonly gravel: number;
  readonly log: number;
  readonly leaves: number;
  readonly oreWall: readonly number[];
  /** Stations and furniture of the workshop row, facing south (towards the spawn). */
  readonly workshop: readonly number[];
  readonly air: number;
}

export function resolveArena(registry: Registry): ResolvedArena {
  const arena = registry.pack.arena;
  if (!arena) throw new Error('The content pack has no arena');
  const state = (key: `block:${string}`) => registry.defaultState(key);
  const door = registry.withState(state(arena.cabin.door), 'facing4', 's');
  return {
    wall: state(arena.cabin.wall),
    roof: state(arena.cabin.roof),
    door,
    doorTop: registry.withState(door, 'half', 'upper'),
    window: state(arena.cabin.window),
    liquid: state(arena.pond.liquid),
    shore: state(arena.pond.shore),
    gravel: state(arena.gravel),
    log: state(arena.tree.log),
    leaves: state(arena.tree.leaves),
    oreWall: arena.oreWall.map(state),
    workshop: arena.workshop.map((key) => registry.withState(state(key), 'facing4', 's')),
    air: registry.air,
  };
}

/** Ground level of the arena (the flat world's surface). */
const G = FLAT_SURFACE;
/** Cabin corners (inclusive), south of which the spawn stands. */
const CABIN = { x0: 3, x1: 7, z0: -9, z1: -5 } as const;
const POND = { x: -8, z: 3 } as const;
const TREE = { x: 9, z: 5, height: 5 } as const;
const ORE_WALL = { x: -7, z: -8 } as const;

/** The cabin's door (its lower half; the upper half is above it), in the south wall. */
export const ARENA_DOOR = { x: (CABIN.x0 + CABIN.x1) >> 1, y: G + 1, z: CABIN.z1 } as const;
/** The workshop row between the spawn and the cabin: one block every `step` cells eastwards. */
export const ARENA_WORKSHOP = { x: -3, y: G + 1, z: -3, step: 2 } as const;

/**
 * Writes the arena's features over a flat column (the spawn is at 0.5, 65, 0.5): a closed cabin
 * with a 2-block door and a window to the north-east, a pond to the west, a gravel patch, a tree,
 * a wall of 2-block pillars of the listed blocks to the north-west and the workshop row (stations
 * and a chest) just north of the spawn. Each column writes only its own voxels, so the result does
 * not depend on the order in which columns are generated.
 */
export function placeArena(column: Column, arena: ResolvedArena): void {
  const x0 = column.cx * SECTION_SIZE;
  const z0 = column.cz * SECTION_SIZE;
  const put = (x: number, y: number, z: number, state: number): void => {
    const lx = x - x0;
    const lz = z - z0;
    if (lx < 0 || lz < 0 || lx >= SECTION_SIZE || lz >= SECTION_SIZE) return;
    column.sections[y >> SECTION_BITS]!.setBlock(localIndex(lx, y & SECTION_MASK, lz), state);
    const cell = columnIndex(lx, lz);
    if (state !== arena.air && y + 1 > column.heightmap[cell]!) column.heightmap[cell] = y + 1;
  };

  // Cabin: 3 rows of walls under a roof, a 2-block door in the south wall, a window to the east.
  for (let x = CABIN.x0; x <= CABIN.x1; x++) {
    for (let z = CABIN.z0; z <= CABIN.z1; z++) {
      const edge = x === CABIN.x0 || x === CABIN.x1 || z === CABIN.z0 || z === CABIN.z1;
      for (let y = G + 1; y <= G + 3; y++) if (edge) put(x, y, z, arena.wall);
      put(x, G + 4, z, arena.roof);
    }
  }
  put(ARENA_DOOR.x, ARENA_DOOR.y, ARENA_DOOR.z, arena.door);
  put(ARENA_DOOR.x, ARENA_DOOR.y + 1, ARENA_DOOR.z, arena.doorTop);
  put(CABIN.x1, G + 2, (CABIN.z0 + CABIN.z1) >> 1, arena.window);

  // Pond: deeper in the middle, ringed with shore blocks.
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      const d2 = dx * dx + dz * dz;
      if (d2 <= 9) put(POND.x + dx, G, POND.z + dz, arena.liquid);
      else if (d2 <= 16) put(POND.x + dx, G, POND.z + dz, arena.shore);
      if (d2 <= 2) put(POND.x + dx, G - 1, POND.z + dz, arena.liquid);
    }
  }

  for (let x = -3; x <= -1; x++) for (let z = 6; z <= 8; z++) put(x, G, z, arena.gravel);

  // Tree: a trunk under a rounded crown.
  const top = G + TREE.height;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let y = top - 2; y <= top + 1; y++) {
        const corner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
        const crown = y === top + 1 && (Math.abs(dx) > 1 || Math.abs(dz) > 1);
        if (!corner && !crown) put(TREE.x + dx, y, TREE.z + dz, arena.leaves);
      }
    }
  }
  for (let y = G + 1; y <= top; y++) put(TREE.x, y, TREE.z, arena.log);

  arena.oreWall.forEach((state, i) => {
    put(ORE_WALL.x + i, G + 1, ORE_WALL.z, state);
    put(ORE_WALL.x + i, G + 2, ORE_WALL.z, state);
  });
  const row = ARENA_WORKSHOP;
  arena.workshop.forEach((state, i) => {
    put(row.x + i * row.step, row.y, row.z, state);
  });
  for (const section of column.sections) section.compact();
}
