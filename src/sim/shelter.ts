import { FLAG_SOLID, type RawTables } from '../content/registry.ts';
import type { ShelterBalance } from '../content/schema.ts';
import type { Column } from '../world/Column.ts';
import { toColumn } from '../world/coords.ts';
import { MAX_LIGHT, skyOf } from '../world/light.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import { type Body, eyeHeight } from './physics.ts';

/** How a player is sheltered (docs « Abri »): the air, sleep and toxicity depend on it. */
export type Shelter = 'exposed' | 'covered' | 'enclosed';
export const SHELTERS: readonly Shelter[] = ['exposed', 'covered', 'enclosed'];

/*
 * The flood keeps cell offsets from the head packed in 5 bits per axis (offset + 15, so a shelter
 * reaches at most 15 blocks: MAX_SHELTER_DISTANCE). `seen` holds the run number that last visited
 * each packed offset, so a run never clears it; the queue holds packed offsets. Module scratch:
 * once the queue is sized (first test), a test allocates nothing.
 */
const BIAS = 15;
const seen = new Uint32Array(1 << 15);
let queue = new Int32Array(0);
let run = 0;

/** The 6 neighbours, as packed offset steps and as (dx, dy, dz). */
const STEP_X = [1, -1, 0, 0, 0, 0] as const;
const STEP_Y = [0, 0, 1, -1, 0, 0] as const;
const STEP_Z = [0, 0, 0, 0, 1, -1] as const;

const pack = (dx: number, dy: number, dz: number) =>
  (dx + BIAS) | ((dy + BIAS) << 5) | ((dz + BIAS) << 10);

/*
 * A one-entry column cache for the flood: its cells lie within 15 blocks of the head, mostly in
 * one column, so the column is looked up again only when the flood crosses into another one (no
 * column key per voxel read). Reset by every test, so it never outlives a change of the world.
 */
let cachedCx = Number.NaN;
let cachedCz = Number.NaN;
let cached: Column | undefined;

function columnAt(world: VoxelWorld, x: number, z: number): Column | undefined {
  const cx = toColumn(x);
  const cz = toColumn(z);
  if (cx !== cachedCx || cz !== cachedCz) {
    cachedCx = cx;
    cachedCz = cz;
    cached = world.getColumn(cx, cz);
  }
  return cached;
}

/** Air a player can pass: no collision (liquids included). Unloaded columns are walls. */
function open(world: VoxelWorld, tables: RawTables, x: number, y: number, z: number): boolean {
  const state = world.blockIn(columnAt(world, x, z), x, y, z);
  return (tables.flags[state]! & FLAG_SOLID) === 0 && state !== world.outside;
}

/** Whether a cell sees the open sky (sky light 15). */
function skyAt(world: VoxelWorld, x: number, y: number, z: number): boolean {
  return skyOf(world.lightIn(columnAt(world, x, z), x, y, z)) === MAX_LIGHT;
}

/**
 * Whether the air around the head cell (x, y, z) is closed: a 6-connected flood through the cells
 * without collision (closed doors collide, open ones do not) that runs out of cells before it
 * reaches open sky (sky light 15), more than `maxCells` cells, or a cell farther than
 * `maxDistance` (Manhattan) from the head. Sky light needs no line of sight: a cell lit 15 sees
 * the sky straight up (glass filters it to 13 and below).
 */
export function enclosedAt(
  world: VoxelWorld,
  tables: RawTables,
  x: number,
  y: number,
  z: number,
  rules: ShelterBalance,
): boolean {
  cachedCx = Number.NaN;
  cached = undefined;
  if (skyAt(world, x, y, z)) return false;
  if (queue.length < rules.maxCells) queue = new Int32Array(rules.maxCells);
  run++;
  if (run === 0xffffffff) {
    seen.fill(0);
    run = 1;
  }
  const start = pack(0, 0, 0);
  seen[start] = run;
  queue[0] = start;
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const cell = queue[head++]!;
    const cx = (cell & 31) - BIAS;
    const cy = ((cell >> 5) & 31) - BIAS;
    const cz = ((cell >> 10) & 31) - BIAS;
    for (let d = 0; d < 6; d++) {
      const dx = cx + STEP_X[d]!;
      const dy = cy + STEP_Y[d]!;
      const dz = cz + STEP_Z[d]!;
      const wx = x + dx;
      const wy = y + dy;
      const wz = z + dz;
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > rules.maxDistance) {
        // Open air past the limits: too big to be a shelter.
        if (open(world, tables, wx, wy, wz)) return false;
        continue;
      }
      const next = pack(dx, dy, dz);
      if (seen[next] === run) continue;
      // Walls are marked too, so every cell is read once.
      seen[next] = run;
      if (!open(world, tables, wx, wy, wz)) continue;
      if (skyAt(world, wx, wy, wz) || tail >= rules.maxCells) return false;
      queue[tail++] = next;
    }
  }
  return true;
}

/** Whether a block stands anywhere above the head cell (the column's heightmap). */
export function coveredAt(world: VoxelWorld, x: number, y: number, z: number): boolean {
  // The heightmap is the y above the top block (−1 unloaded).
  return world.heightAt(x, z) > y + 1;
}

/** The shelter test of docs « Abri » from the head cell: enclosed, else covered, else exposed. */
export function shelterAt(
  world: VoxelWorld,
  tables: RawTables,
  x: number,
  y: number,
  z: number,
  rules: ShelterBalance,
): Shelter {
  if (enclosedAt(world, tables, x, y, z, rules)) return 'enclosed';
  return coveredAt(world, x, y, z) ? 'covered' : 'exposed';
}

/** The cell height of a body's head (its eyes): where the shelter is tested from. */
export function headY(body: Readonly<Body>): number {
  return Math.floor(body.y + eyeHeight(body));
}

/** The shelter test of docs « Abri » for a body, from its head cell. */
export function shelterOfBody(
  world: VoxelWorld,
  tables: RawTables,
  body: Readonly<Body>,
  rules: ShelterBalance,
): Shelter {
  return shelterAt(world, tables, Math.floor(body.x), headY(body), Math.floor(body.z), rules);
}
