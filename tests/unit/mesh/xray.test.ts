import { describe, expect, it } from 'vitest';
import { meshSection, type SectionMesh } from '../../../src/world/mesh/greedyMesher.ts';
import { createPadded, fillPadded } from '../../../src/world/mesh/padded.ts';
import { xrayTables } from '../../../src/world/mesh/xray.ts';
import { VoxelWorld } from '../../../src/world/VoxelWorld.ts';
import { registry } from '../../helpers/registry.ts';

const STONE = registry.defaultState('block:stone');
const ORE = registry.defaultState('block:copper_ore');
const BASE = 64; // world y of section sy = 2

/** Section (0, 2, 0) and its border filled with stone, an ore and a 2×2×2 cave inside. */
function mesh(xray: boolean): SectionMesh {
  const world = new VoxelWorld(registry.air, STONE);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) world.ensureColumn(cx, cz);
  for (let y = BASE - 1; y <= BASE + 32; y++)
    for (let x = -1; x <= 32; x++) for (let z = -1; z <= 32; z++) world.setBlock(x, y, z, STONE);
  world.setBlock(5, BASE + 5, 5, ORE);
  for (let y = 20; y < 22; y++)
    for (let x = 20; x < 22; x++)
      for (let z = 20; z < 22; z++) world.setBlock(x, BASE + y, z, registry.air);
  const padded = createPadded();
  fillPadded(
    world,
    0,
    2,
    0,
    { belowBlock: STONE, missingBlock: STONE, missingLight: 0, air: registry.air },
    padded,
  );
  return meshSection(padded, xray ? xrayTables(registry) : registry.tables, { greedy: false });
}

describe('xray view', () => {
  it('shows every face of buried ores and the cave walls as translucent ghosts', () => {
    const normal = mesh(false);
    // Only the cave's 24 wall faces show; the ore is hidden in the stone.
    expect(normal.passes.map((p) => p.quads)).toEqual([24, 0, 0]);
    const xray = mesh(true);
    expect(xray.passes.map((p) => p.quads)).toEqual([6, 0, 24]);
  });

  it('only changes the terrain blocks', () => {
    const tables = xrayTables(registry);
    const changed = new Set<string>();
    for (let id = 0; id < tables.stateCount; id++) {
      if (tables.pass[id] !== registry.tables.pass[id]) changed.add(registry.states[id]!.key);
    }
    expect(changed.has('block:stone')).toBe(true);
    expect(changed.has('block:grass')).toBe(true);
    expect(changed.has('block:copper_ore')).toBe(false);
    expect(changed.has('block:broadleaf_log[axis=y]')).toBe(false);
    expect(changed.has('block:fresh_water')).toBe(false);
  });
});
