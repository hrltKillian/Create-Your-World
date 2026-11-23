import { writeBlock } from '../../src/sim/edits.ts';
import type { Column } from '../../src/world/Column.ts';
import { SECTIONS_PER_COLUMN, WORLD_HEIGHT } from '../../src/world/coords.ts';
import { columnLight } from '../../src/world/light/columnLight.ts';
import { LightEngine } from '../../src/world/light/LightEngine.ts';
import { blockOf, skyOf } from '../../src/world/light.ts';
import type { VoxelWorld } from '../../src/world/VoxelWorld.ts';
import { emptyWorld } from './flatWorld.ts';
import { registry } from './registry.ts';

export const STONE = registry.defaultState('block:stone');

/** Fills sections [0, toSy) of every column with stone (y 0 to 32 × toSy − 1). */
export function stoneBelow(world: VoxelWorld, toSy: number): void {
  for (const column of world.columns.values())
    for (let sy = 0; sy < Math.min(toSy, SECTIONS_PER_COLUMN); sy++)
      column.sections[sy]!.fill(STONE);
}

/**
 * Columns [-r, r]² whose blocks `build` writes, each lit on its own (as the worker does), then
 * handed to a light engine and stitched to the end.
 */
export function litWorld(
  radius: number,
  build: (world: VoxelWorld) => void,
): { world: VoxelWorld; light: LightEngine } {
  const world = emptyWorld(radius);
  build(world);
  const light = new LightEngine(registry.tables);
  for (const column of world.columns.values()) addLit(light, column);
  light.stitch(Number.POSITIVE_INFINITY);
  return { world, light };
}

/** Lights a column on its own, then hands it to the engine (as a delivery does). */
export function addLit(light: LightEngine, column: Column): void {
  columnLight(column, registry.tables);
  light.addColumn(column);
}

/** A block edit as the simulation makes it, with its light resolved. */
export function edit(
  world: VoxelWorld,
  light: LightEngine,
  x: number,
  y: number,
  z: number,
  state: number,
): void {
  writeBlock(world, light, x, y, z, state);
  light.flush();
}

export const sky = (world: VoxelWorld, x: number, y: number, z: number) =>
  skyOf(world.getLight(x, y, z));
export const block = (world: VoxelWorld, x: number, y: number, z: number) =>
  blockOf(world.getLight(x, y, z));

/**
 * Reference light of a 64×256×64 box of loaded blocks (outside counts as opaque, above the world
 * is full sky): one flat-array flood with the rules written out again, independent of the engine.
 */
export function referenceLight(world: VoxelWorld, x0: number, z0: number): Uint8Array {
  const W = 64;
  const n = W * W * WORLD_HEIGHT;
  const filter = new Uint8Array(n);
  const levels = [new Uint8Array(n), new Uint8Array(n)]; // sky, block
  const queues: number[][] = [[], []];
  for (let y = 0; y < WORLD_HEIGHT; y++)
    for (let z = 0; z < W; z++)
      for (let x = 0; x < W; x++) {
        const i = x + z * W + y * W * W;
        const state = world.getBlock(x0 + x, y, z0 + z);
        filter[i] = registry.tables.lightFilter[state]!;
        const emit = registry.tables.emit[state]!;
        if (emit > 0) {
          levels[1]![i] = emit;
          queues[1]!.push(i);
        }
      }
  for (let z = 0; z < W; z++)
    for (let x = 0; x < W; x++)
      for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
        const i = x + z * W + y * W * W;
        // Full sky falls through filter-0 blocks; a filtering top block takes 15 − 1 − filter.
        const level = filter[i] === 0 ? 15 : y === WORLD_HEIGHT - 1 ? 14 - filter[i]! : 0;
        if (level > 0) {
          levels[0]![i] = level;
          queues[0]!.push(i);
        }
        if (filter[i] !== 0) break;
      }
  for (let channel = 0; channel < 2; channel++) {
    const level = levels[channel]!;
    const queue = queues[channel]!;
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]!;
      const x = i % W;
      const z = Math.floor(i / W) % W;
      const y = Math.floor(i / (W * W));
      const offer = (j: number, down: boolean) => {
        const next =
          channel === 0 && down && level[i] === 15 && filter[j] === 0
            ? 15
            : level[i]! - 1 - filter[j]!;
        if (next > level[j]!) {
          level[j] = next;
          queue.push(j);
        }
      };
      if (x > 0) offer(i - 1, false);
      if (x < W - 1) offer(i + 1, false);
      if (z > 0) offer(i - W, false);
      if (z < W - 1) offer(i + W, false);
      if (y > 0) offer(i - W * W, true);
      if (y < WORLD_HEIGHT - 1) offer(i + W * W, false);
    }
  }
  const packed = new Uint8Array(n);
  for (let i = 0; i < n; i++) packed[i] = (levels[0]![i]! << 4) | levels[1]![i]!;
  return packed;
}

/**
 * Cells (up to 5) of the box at (x0, z0) where `compare(world light, reference)` fails, as
 * readable strings; exact equality by default.
 */
export function mismatches(
  world: VoxelWorld,
  reference: Uint8Array,
  x0 = 0,
  z0 = 0,
  compare: (actual: number, expected: number) => boolean = (a, e) => a === e,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < reference.length && out.length < 5; i++) {
    const x = x0 + (i % 64);
    const z = z0 + (Math.floor(i / 64) % 64);
    const y = Math.floor(i / 4096);
    const actual = world.getLight(x, y, z);
    if (!compare(actual, reference[i]!)) out.push(`${x},${y},${z}: ${actual} vs ${reference[i]}`);
  }
  return out;
}

/** Cells (up to 5) of the box at (x0, z0) whose light differs from the reference flood. */
export function lightErrors(world: VoxelWorld, x0: number, z0: number): string[] {
  return mismatches(world, referenceLight(world, x0, z0), x0, z0);
}
