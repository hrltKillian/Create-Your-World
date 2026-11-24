import { COLLISION_LIQUID, FLAG_SOLID, type RawTables } from '../../content/registry.ts';
import type { Column } from '../../world/Column.ts';
import { localIndex, SECTION_BITS, SECTION_MASK, WORLD_HEIGHT } from '../../world/coords.ts';
import { effectiveLight } from '../../world/light.ts';
import type { VoxelWorld } from '../../world/VoxelWorld.ts';

/*
 * A* on the block grid (docs « Créatures et combat », A*). A node is the cell a creature's feet
 * stand in: its `clearance` cells are free and the cell below is solid, or a liquid it floats on
 * (each such node costs `SWIM_COST` more, so paths keep to dry land when they can). Moves: 8 directions
 * without cutting corners (diagonals stay level), one block up (with head room to hop), or a drop
 * of at most 3 blocks. Unloaded columns count as solid, so paths never enter them; cells of
 * effective light ≥ `lightLimit` are forbidden (light-shy creatures).
 *
 * Fixed budgets and zero allocation per search: a typed binary heap and a table of 16 384 nodes
 * stamped by search (a node of an older search reads as absent), at most 600 nodes expanded. When
 * the budget runs out, or the goal cannot be reached, the path leads to the node nearest the goal
 * (best h). The search stays within ±64 blocks of the start, which keys a node in 22 bits.
 */

export const ASTAR = {
  maxExpansions: 600,
  tableSize: 16_384,
  /** Searches the AI may run per tick (ai/creatureStep.ts). */
  searchesPerTick: 2,
  maxDrop: 3,
  /** Half-size of the searched square around the start. */
  window: 64,
} as const;

/** What a search looks for; callers keep one and fill it (no allocation). */
export interface PathRequest {
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toY: number;
  toZ: number;
  /** Free cells a body needs above its feet. */
  clearance: number;
  /** Cells of this effective light or more are forbidden (16: none). */
  lightLimit: number;
  daylight: number;
}

/** Statistics of the last search (tests and benchmarks). */
export const lastSearch = { expanded: 0, nodes: 0, reached: false };

const SIZE = ASTAR.tableSize;
const MASK = SIZE - 1;
const W = ASTAR.window;
const SPAN = 2 * W;
/** Pushes a search can make: one per relaxed neighbour. */
const HEAP_SIZE = ASTAR.maxExpansions * 8 + 1;
const DIAGONAL = Math.SQRT2;
/** Extra cost of a hop onto a step, and per block dropped. */
const STEP_UP_COST = 0.5;
const DROP_COST = 0.25;
/** Extra cost of a node held up by a liquid (swimming). */
const SWIM_COST = 1;

const stamp = new Uint32Array(SIZE);
const keys = new Int32Array(SIZE);
const gCost = new Float64Array(SIZE);
const parent = new Int32Array(SIZE);
const closed = new Uint8Array(SIZE);
const heapSlot = new Int32Array(HEAP_SIZE);
const heapF = new Float64Array(HEAP_SIZE);
/** Slots from the path's end back to its start. */
const trail = new Int32Array(ASTAR.maxExpansions + 1);
let search = 0;
let heapCount = 0;
let nodes = 0;

// The search in progress (module state: one search at a time, no closure per search).
let world: VoxelWorld;
let tables: RawTables;
let req: Readonly<PathRequest>;
// Last column looked up: neighbouring cells mostly share it (a map lookup saved per cell).
let columnX = 0;
let columnZ = 0;
let column: Column | undefined;

/** The loaded column of a block position (undefined: unloaded). */
function columnAt(x: number, z: number): Column | undefined {
  const cx = x >> SECTION_BITS;
  const cz = z >> SECTION_BITS;
  if (cx !== columnX || cz !== columnZ) {
    columnX = cx;
    columnZ = cz;
    column = world.getColumn(cx, cz);
  }
  return column;
}

/** Solid, unloaded and below-world cells all block (as collision.ts `solidCell`). */
function solid(x: number, y: number, z: number): boolean {
  if (y < 0) return true;
  if (y >= WORLD_HEIGHT) return false;
  const c = columnAt(x, z);
  return (
    c === undefined ||
    (tables.flags[c.getBlock(x & SECTION_MASK, y, z & SECTION_MASK)]! & FLAG_SOLID) !== 0
  );
}

/** The body fits with its feet in the cell. */
function clear(x: number, y: number, z: number): boolean {
  for (let k = 0; k < req.clearance; k++) if (solid(x, y + k, z)) return false;
  return true;
}

function lightOk(x: number, y: number, z: number): boolean {
  if (req.lightLimit > 15 || y >= WORLD_HEIGHT) return true;
  const c = columnAt(x, z);
  if (c === undefined) return false;
  const index = localIndex(x & SECTION_MASK, y & SECTION_MASK, z & SECTION_MASK);
  const packed = c.sections[y >> SECTION_BITS]!.getLight(index);
  return effectiveLight(packed, req.daylight) < req.lightLimit;
}

function liquid(x: number, y: number, z: number): boolean {
  if (y < 0 || y >= WORLD_HEIGHT) return false;
  const c = columnAt(x, z);
  return (
    c !== undefined &&
    tables.collision[c.getBlock(x & SECTION_MASK, y, z & SECTION_MASK)] === COLLISION_LIQUID
  );
}

/** Extra cost of a body held with its feet in the cell (0 on solid ground); −1: nothing holds it. */
function floorCost(x: number, y: number, z: number): number {
  if (solid(x, y - 1, z)) return 0;
  return liquid(x, y - 1, z) ? SWIM_COST : -1;
}

/** Extra cost of a body standing (or floating) with its feet in the cell; −1: it cannot. */
function standCost(x: number, y: number, z: number): number {
  return clear(x, y, z) && lightOk(x, y, z) ? floorCost(x, y, z) : -1;
}

function keyOf(x: number, y: number, z: number): number {
  return x - req.fromX + W + ((z - req.fromZ + W) << 7) + (y << 14);
}

/** Octile distance on the ground plus a little per block of height. */
function heuristic(x: number, y: number, z: number): number {
  const dx = Math.abs(req.toX - x);
  const dz = Math.abs(req.toZ - z);
  return Math.max(dx, dz) + (DIAGONAL - 1) * Math.min(dx, dz) + DROP_COST * Math.abs(req.toY - y);
}

/** The slot of a key, created (cost ∞) when absent; −1 when the table is full. */
function slotOf(key: number): number {
  let slot = Math.imul(key, 0x9e3779b1) >>> 18;
  for (let probe = 0; probe < SIZE; probe++, slot = (slot + 1) & MASK) {
    if (stamp[slot] !== search) {
      stamp[slot] = search;
      keys[slot] = key;
      gCost[slot] = Number.POSITIVE_INFINITY;
      closed[slot] = 0;
      nodes++;
      return slot;
    }
    if (keys[slot] === key) return slot;
  }
  return -1;
}

function push(slot: number, f: number): void {
  if (heapCount === HEAP_SIZE) return;
  let i = heapCount++;
  while (i > 0) {
    const up = (i - 1) >> 1;
    if (heapF[up]! <= f) break;
    heapSlot[i] = heapSlot[up]!;
    heapF[i] = heapF[up]!;
    i = up;
  }
  heapSlot[i] = slot;
  heapF[i] = f;
}

function pop(): number {
  const top = heapSlot[0]!;
  const lastSlot = heapSlot[--heapCount]!;
  const lastF = heapF[heapCount]!;
  let i = 0;
  for (;;) {
    let child = 2 * i + 1;
    if (child >= heapCount) break;
    if (child + 1 < heapCount && heapF[child + 1]! < heapF[child]!) child++;
    if (heapF[child]! >= lastF) break;
    heapSlot[i] = heapSlot[child]!;
    heapF[i] = heapF[child]!;
    i = child;
  }
  heapSlot[i] = lastSlot;
  heapF[i] = lastF;
  return top;
}

/** Offers a path to (x, y, z) of cost `g` through `from`. */
function relax(x: number, y: number, z: number, g: number, from: number): void {
  if (Math.abs(x - req.fromX) >= W || Math.abs(z - req.fromZ) >= W) return;
  const slot = slotOf(keyOf(x, y, z));
  if (slot < 0 || closed[slot] === 1 || g >= gCost[slot]!) return;
  gCost[slot] = g;
  parent[slot] = from;
  // A hair of extra h breaks ties towards the goal.
  push(slot, g + heuristic(x, y, z) * 1.001);
}

/** Level move, hop onto a step or drop of at most 3 blocks into the orthogonal neighbour. */
function expandStraight(
  x: number,
  y: number,
  z: number,
  nx: number,
  nz: number,
  g: number,
  from: number,
): void {
  if (clear(nx, y, nz)) {
    for (let d = 0; d <= ASTAR.maxDrop; d++) {
      if (d > 0 && solid(nx, y - d, nz)) return;
      const floor = floorCost(nx, y - d, nz);
      if (floor >= 0) {
        if (lightOk(nx, y - d, nz)) relax(nx, y - d, nz, g + 1 + DROP_COST * d + floor, from);
        return;
      }
    }
    return;
  }
  // A step: the neighbour's floor is one higher, with room to hop above the body here.
  if (!solid(nx, y, nz) || solid(x, y + req.clearance, z)) return;
  const stand = standCost(nx, y + 1, nz);
  if (stand >= 0) relax(nx, y + 1, nz, g + 1 + STEP_UP_COST + stand, from);
}

/**
 * Searches a path for `request` and writes its cells after the start (x, y, z after one another,
 * at most `maxCells` of them, from the start on) into `out`, reusing its slots. Returns the number
 * of cells written: 0 when the start is already the best node. `lastSearch` tells whether the goal
 * was reached.
 */
export function findPath(
  voxels: VoxelWorld,
  rawTables: RawTables,
  request: Readonly<PathRequest>,
  out: number[],
  maxCells: number,
): number {
  world = voxels;
  tables = rawTables;
  req = request;
  // Columns load and unload between searches: the cached one is looked up again.
  column = world.getColumn(columnX, columnZ);
  search = (search + 1) >>> 0;
  if (search === 0) {
    stamp.fill(0);
    search = 1;
  }
  heapCount = 0;
  nodes = 0;
  let expanded = 0;
  const start = slotOf(keyOf(req.fromX, req.fromY, req.fromZ));
  gCost[start] = 0;
  parent[start] = -1;
  push(start, heuristic(req.fromX, req.fromY, req.fromZ));
  let best = start;
  let bestH = heuristic(req.fromX, req.fromY, req.fromZ);
  let reached = false;
  while (heapCount > 0 && expanded < ASTAR.maxExpansions) {
    const slot = pop();
    if (closed[slot] === 1) continue;
    closed[slot] = 1;
    expanded++;
    const key = keys[slot]!;
    const x = (key & (SPAN - 1)) - W + req.fromX;
    const z = ((key >> 7) & (SPAN - 1)) - W + req.fromZ;
    const y = key >> 14;
    const g = gCost[slot]!;
    const h = heuristic(x, y, z);
    if (h < bestH) {
      best = slot;
      bestH = h;
    }
    if (x === req.toX && z === req.toZ && Math.abs(y - req.toY) <= 1) {
      best = slot;
      reached = true;
      break;
    }
    expandStraight(x, y, z, x + 1, z, g, slot);
    expandStraight(x, y, z, x - 1, z, g, slot);
    expandStraight(x, y, z, x, z + 1, g, slot);
    expandStraight(x, y, z, x, z - 1, g, slot);
    // Diagonals stay level and need both corner cells free: they never cut a corner.
    for (let dx = -1; dx <= 1; dx += 2) {
      for (let dz = -1; dz <= 1; dz += 2) {
        if (!clear(x + dx, y, z) || !clear(x, y, z + dz)) continue;
        const stand = standCost(x + dx, y, z + dz);
        if (stand >= 0) relax(x + dx, y, z + dz, g + DIAGONAL + stand, slot);
      }
    }
  }
  lastSearch.expanded = expanded;
  lastSearch.nodes = nodes;
  lastSearch.reached = reached;
  return writePath(best, out, maxCells);
}

/** Writes the cells from the start (excluded) to `end`, at most `maxCells`. */
function writePath(end: number, out: number[], maxCells: number): number {
  let length = 0;
  for (let slot = end; parent[slot]! >= 0 && length < trail.length; slot = parent[slot]!)
    trail[length++] = slot;
  const cells = Math.min(length, maxCells);
  for (let i = 0; i < cells; i++) {
    const key = keys[trail[length - 1 - i]!]!;
    out[i * 3] = (key & (SPAN - 1)) - W + req.fromX;
    out[i * 3 + 1] = key >> 14;
    out[i * 3 + 2] = ((key >> 7) & (SPAN - 1)) - W + req.fromZ;
  }
  return cells;
}
