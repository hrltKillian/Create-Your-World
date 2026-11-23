import { writeBlock } from '../../src/sim/edits.ts';
import type { Column } from '../../src/world/Column.ts';
import { SECTIONS_PER_COLUMN } from '../../src/world/coords.ts';
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
