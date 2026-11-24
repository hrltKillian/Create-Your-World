import { describe, expect, it } from 'vitest';
import { ASTAR, findPath, lastSearch, type PathRequest } from '../../../src/sim/ai/pathfind.ts';
import { NIGHT_DAYLIGHT } from '../../../src/sim/time.ts';
import { effectiveLight } from '../../../src/world/light.ts';
import type { VoxelWorld } from '../../../src/world/VoxelWorld.ts';
import { flatWorld } from '../../helpers/flatWorld.ts';
import { litWorld, STONE } from '../../helpers/lightWorld.ts';
import { registry } from '../../helpers/registry.ts';

/*
 * A* of the creatures (docs « Créatures et combat », A*): walls, steps, drops, low passages,
 * partial paths, light-shy creatures and the node table, on a stone floor (feet at y 64).
 */

const TORCH = registry.defaultState('block:torch');

function query(from: [number, number, number], to: [number, number, number]): PathRequest {
  return {
    fromX: from[0],
    fromY: from[1],
    fromZ: from[2],
    toX: to[0],
    toY: to[1],
    toZ: to[2],
    clearance: 2,
    lightLimit: 16,
    daylight: 1,
  };
}

/** The cells of a path as [x, y, z] triples. */
function search(world: VoxelWorld, request: PathRequest): [number, number, number][] {
  const out: number[] = [];
  const n = findPath(world, registry.tables, request, out, ASTAR.maxExpansions);
  const cells: [number, number, number][] = [];
  for (let i = 0; i < n; i++) cells.push([out[i * 3]!, out[i * 3 + 1]!, out[i * 3 + 2]!]);
  return cells;
}

/** A wall of stone along x = `x`, z in [z0, z1], `height` blocks over the floor. */
function wall(world: VoxelWorld, x: number, z0: number, z1: number, height: number): void {
  for (let z = z0; z <= z1; z++)
    for (let y = 64; y < 64 + height; y++) world.setBlock(x, y, z, STONE);
}

/** Every step of a path moves one cell across (or diagonally), at most 1 up or 3 down. */
function expectWalkable(cells: [number, number, number][], from: [number, number, number]): void {
  let prev = from;
  for (const cell of cells) {
    expect(Math.max(Math.abs(cell[0] - prev[0]), Math.abs(cell[2] - prev[2]))).toBe(1);
    expect(cell[1] - prev[1]).toBeLessThanOrEqual(1);
    expect(prev[1] - cell[1]).toBeLessThanOrEqual(ASTAR.maxDrop);
    prev = cell;
  }
}

describe('A* pathfinding', () => {
  it('walks straight across open ground', () => {
    const cells = search(flatWorld(), query([0, 64, 0], [10, 64, 0]));
    expect(lastSearch.reached).toBe(true);
    expect(cells.at(-1)).toEqual([10, 64, 0]);
    expect(cells).toHaveLength(10);
  });

  it('goes around a wall through its gap, never through it nor cutting its corners', () => {
    const world = flatWorld();
    wall(world, 5, -10, 10, 3);
    world.setBlock(5, 64, 8, registry.air);
    world.setBlock(5, 65, 8, registry.air);
    const from: [number, number, number] = [0, 64, 0];
    const cells = search(world, query(from, [10, 64, 0]));
    expect(lastSearch.reached).toBe(true);
    expectWalkable(cells, from);
    expect(cells.some(([x, , z]) => x === 5 && z === 8)).toBe(true);
    for (const [x, , z] of cells) if (x === 5) expect(z).toBe(8);
    // Into and out of the gap straight, not diagonally past the wall's edge.
    const gap = cells.findIndex(([x]) => x === 5);
    expect(cells[gap - 1]).toEqual([4, 64, 8]);
    expect(cells[gap + 1]).toEqual([6, 64, 8]);
  });

  it('climbs a one-block step but not a two-block one', () => {
    const world = flatWorld();
    wall(world, 5, -40, 39, 1);
    for (let x = 6; x < 20; x++) for (let z = -40; z < 40; z++) world.setBlock(x, 64, z, STONE);
    const cells = search(world, query([0, 64, 0], [10, 65, 0]));
    expect(lastSearch.reached).toBe(true);
    expect(cells).toContainEqual([5, 65, 0]);
    expect(cells.at(-1)).toEqual([10, 65, 0]);
    wall(world, 5, -40, 39, 2);
    search(world, query([0, 64, 0], [10, 65, 0]));
    expect(lastSearch.reached).toBe(false);
  });

  it('needs head room above it to hop onto a step', () => {
    const world = flatWorld();
    wall(world, 5, -40, 39, 1);
    // A ceiling over the row before the step: walkable under it, but no hop from there.
    for (let z = -40; z < 40; z++) world.setBlock(4, 66, z, STONE);
    search(world, query([0, 64, 0], [8, 65, 0]));
    expect(lastSearch.reached).toBe(false);
  });

  it('drops down to 3 blocks, never 4', () => {
    const world = flatWorld();
    // A raised floor (feet at 67) ending at x = 5, ground (feet at 64) beyond.
    for (let x = -40; x <= 5; x++)
      for (let z = -40; z < 40; z++) for (let y = 64; y < 67; y++) world.setBlock(x, y, z, STONE);
    const from: [number, number, number] = [0, 67, 0];
    const cells = search(world, query(from, [10, 64, 0]));
    expect(lastSearch.reached).toBe(true);
    expectWalkable(cells, from);
    expect(cells).toContainEqual([6, 64, 0]);
    for (let x = -40; x <= 5; x++) for (let z = -40; z < 40; z++) world.setBlock(x, 67, z, STONE);
    search(world, query([0, 68, 0], [10, 64, 0]));
    expect(lastSearch.reached).toBe(false);
  });

  it('refuses a one-block-high passage to a two-block-tall body, not to a short one', () => {
    const world = flatWorld();
    wall(world, 5, -40, 39, 3);
    world.setBlock(5, 64, 0, registry.air);
    search(world, query([0, 64, 0], [10, 64, 0]));
    expect(lastSearch.reached).toBe(false);
    const cells = search(world, { ...query([0, 64, 0], [10, 64, 0]), clearance: 1 });
    expect(lastSearch.reached).toBe(true);
    expect(cells).toContainEqual([5, 64, 0]);
  });

  it('leads to the node nearest an unreachable goal, within the budget', () => {
    const world = flatWorld();
    // The goal stands inside a closed stone box.
    for (let x = 8; x <= 12; x++)
      for (let z = -2; z <= 2; z++)
        for (let y = 64; y <= 67; y++)
          if (x === 8 || x === 12 || z === -2 || z === 2 || y === 67)
            world.setBlock(x, y, z, STONE);
    const cells = search(world, query([0, 64, 0], [10, 64, 0]));
    expect(lastSearch.reached).toBe(false);
    expect(lastSearch.expanded).toBeLessThanOrEqual(ASTAR.maxExpansions);
    // Right against the box's wall, facing the goal.
    expect(cells.at(-1)).toEqual([7, 64, 0]);
  });

  it('keeps a light-shy creature out of the light of a torch', () => {
    const { world } = litWorld(1, (w) => {
      for (let x = -32; x < 64; x++) for (let z = -32; z < 64; z++) w.setBlock(x, 63, z, STONE);
      w.setBlock(10, 64, 0, TORCH);
    });
    const from: [number, number, number] = [0, 64, 0];
    const lit = (x: number, y: number, z: number) =>
      effectiveLight(world.getLight(x, y, z), NIGHT_DAYLIGHT);
    expect(lit(9, 64, 0)).toBeGreaterThanOrEqual(10);
    const straight = search(world, query(from, [20, 64, 0]));
    expect(straight.some(([x, y, z]) => lit(x, y, z) >= 10)).toBe(true);
    const request = { ...query(from, [20, 64, 0]), lightLimit: 10, daylight: NIGHT_DAYLIGHT };
    const cells = search(world, request);
    expect(lastSearch.reached).toBe(true);
    expectWalkable(cells, from);
    for (const [x, y, z] of cells) expect(lit(x, y, z)).toBeLessThan(10);
  });

  it('never fills its node table, even when the whole budget is spent', () => {
    const world = flatWorld();
    // An unreachable goal far away: every node budget is spent on open ground.
    search(world, query([0, 64, 0], [60, 90, 60]));
    expect(lastSearch.reached).toBe(false);
    expect(lastSearch.expanded).toBe(ASTAR.maxExpansions);
    expect(lastSearch.nodes).toBeLessThanOrEqual(ASTAR.maxExpansions * 8 + 1);
    expect(lastSearch.nodes).toBeLessThan(ASTAR.tableSize);
  });

  it('never enters an unloaded column', () => {
    const world = flatWorld();
    for (let x = 80; x < 96; x++) for (let z = -5; z <= 5; z++) world.setBlock(x, 63, z, STONE);
    // flatWorld loads columns −2…2: x 96 lies beyond them.
    const cells = search(world, query([90, 64, 0], [100, 64, 0]));
    expect(lastSearch.reached).toBe(false);
    for (const [x] of cells) expect(x).toBeLessThan(96);
  });

  it('swims out of water too deep to stand in, to the bank, rather than to its bed', () => {
    // A pool 9 deep over the stone floor's level: feet float in its top layer (y 63).
    const world = flatWorld();
    const water = registry.defaultState('block:fresh_water');
    for (let x = -10; x <= 10; x++)
      for (let z = -10; z <= 10; z++) for (let y = 55; y <= 63; y++) world.setBlock(x, y, z, water);
    const from: [number, number, number] = [0, 63, 0];
    const cells = search(world, query(from, [20, 64, 0]));
    expect(lastSearch.reached).toBe(true);
    expectWalkable(cells, from);
    expect(cells.at(-1)).toEqual([20, 64, 0]);
  });
});
