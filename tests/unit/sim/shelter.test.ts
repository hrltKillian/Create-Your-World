import { describe, expect, it } from 'vitest';
import { shelterAt } from '../../../src/sim/shelter.ts';
import { columnIndex, toLocal, WORLD_HEIGHT } from '../../../src/world/coords.ts';
import type { VoxelWorld } from '../../../src/world/VoxelWorld.ts';
import { litWorld, STONE } from '../../helpers/lightWorld.ts';
import { registry } from '../../helpers/registry.ts';
import { createTestSim } from '../../helpers/simHarness.ts';

/*
 * Shelter fixtures (docs « Abri », « M9 »): a 5×5 hut of planks on a stone floor, walls y 64–67,
 * roof at y 68, the head inside at (2, 65, 2), built over lit columns.
 */

const rules = registry.pack.balance.shelter;
const PLANKS = registry.defaultState('block:planks');
const GLASS = registry.defaultState('block:glass');
const AIR = registry.air;
const gate = (open: 0 | 1, half: 'lower' | 'upper') =>
  registry.stateId(`block:gate[facing4=n,open=${open},half=${half}]`);

interface Hut {
  walls?: boolean;
  roof?: number;
  /** Cells set after the hut, e.g. a hole or a door. */
  cells?: readonly (readonly [number, number, number, number])[];
}

/** Sets a block and keeps the heightmap above the top block (as generation and edits do). */
function put(world: VoxelWorld, x: number, y: number, z: number, state: number): void {
  world.setBlock(x, y, z, state);
  const heights = world.ensureColumn(x >> 5, z >> 5).heightmap;
  const cell = columnIndex(toLocal(x), toLocal(z));
  if (state !== AIR) {
    heights[cell] = Math.max(heights[cell]!, y + 1);
    return;
  }
  let top = WORLD_HEIGHT;
  while (top > 0 && world.getBlock(x, top - 1, z) === AIR) top--;
  heights[cell] = top;
}

function floor(world: VoxelWorld): void {
  for (let x = -32; x < 64; x++) for (let z = -32; z < 64; z++) put(world, x, 63, z, STONE);
}

/** The shelter at the head cell (2, 65, 2) of a hut. */
function shelterOf({ walls = true, roof = PLANKS, cells = [] }: Hut) {
  const { world } = litWorld(1, (w) => {
    floor(w);
    for (let x = 0; x <= 4; x++)
      for (let z = 0; z <= 4; z++) {
        if (roof !== AIR) put(w, x, 68, z, roof);
        const edge = x === 0 || x === 4 || z === 0 || z === 4;
        if (walls && edge) for (let y = 64; y <= 67; y++) put(w, x, y, z, PLANKS);
      }
    for (const [x, y, z, state] of cells) put(w, x, y, z, state);
  });
  return shelterAt(world, registry.tables, 2, 65, 2, rules);
}

describe('shelter test', () => {
  it('finds a closed hut enclosed, and an open field exposed', () => {
    expect(shelterOf({})).toBe('enclosed');
    expect(shelterOf({ walls: false, roof: AIR })).toBe('exposed');
  });

  it('finds a holed roof or an open window only covered (exposed under the hole)', () => {
    expect(shelterOf({ cells: [[3, 68, 3, AIR]] })).toBe('covered');
    expect(shelterOf({ cells: [[2, 68, 2, AIR]] })).toBe('exposed');
    expect(shelterOf({ cells: [[0, 66, 2, AIR]] })).toBe('covered');
  });

  it('finds a closed glass roof enclosed (glass dims the sky light)', () => {
    expect(shelterOf({ roof: GLASS })).toBe('enclosed');
  });

  it('finds a roof without walls covered', () => {
    expect(shelterOf({ walls: false })).toBe('covered');
  });

  it('counts a closed door as a wall, an open one as a way out', () => {
    const door = (open: 0 | 1) =>
      shelterOf({
        cells: [
          [2, 64, 0, gate(open, 'lower')],
          [2, 65, 0, gate(open, 'upper')],
        ],
      });
    expect(door(0)).toBe('enclosed');
    expect(door(1)).toBe('covered');
  });

  it('finds a closed hall too large to be a shelter: covered', () => {
    // 13×13 inside, 4 high: more cells and farther than the limits allow.
    const { world } = litWorld(1, (w) => {
      floor(w);
      for (let x = -7; x <= 7; x++)
        for (let z = -7; z <= 7; z++) {
          put(w, x, 68, z, PLANKS);
          if (Math.abs(x) === 7 || Math.abs(z) === 7)
            for (let y = 64; y <= 67; y++) put(w, x, y, z, PLANKS);
        }
    });
    expect(shelterAt(world, registry.tables, 0, 65, 0, rules)).toBe('covered');
  });
});

describe('shelter in the simulation', () => {
  it('is tested again the tick after a block changes nearby', () => {
    const s = createTestSim({ seed: 'shelter', worldType: 'flat', allowDebug: true });
    const player = s.sim.addPlayer(1, 2);
    s.step(30);
    const fill = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
      const box = { x0, y0, z0, x1, y1, z1 };
      s.host.send({ type: 'debug.fill', ...box, state: 'block:planks' });
    };
    // A hut around the spawn (0.5, 65, 0.5): walls from x, z = −2 to 2, roof at 68.
    fill(-2, 65, -2, 2, 68, 2);
    s.host.send({
      type: 'debug.fill',
      x0: -1,
      y0: 65,
      z0: -1,
      x1: 1,
      y1: 67,
      z1: 1,
      state: 'block:air',
    });
    s.step(40);
    expect(player.survival.shelter).toBe('enclosed');
    // Wait for a fresh sample, then hole the roof: the test runs again before the next one.
    while (player.survival.sampleTicks !== 30) s.step();
    s.host.send({
      type: 'debug.fill',
      x0: 0,
      y0: 68,
      z0: 0,
      x1: 0,
      y1: 68,
      z1: 0,
      state: 'block:air',
    });
    s.step(2);
    expect(player.survival.shelter).toBe('exposed');
  });
});
