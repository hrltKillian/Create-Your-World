import { describe, expect, it } from 'vitest';
import { Column } from '../../../src/world/Column.ts';
import { columnIndex, columnKey, toLocal } from '../../../src/world/coords.ts';
import { FLAT_SURFACE } from '../../../src/world/gen/flat.ts';
import {
  columnHash,
  createGenContext,
  generateColumn,
} from '../../../src/world/gen/generateColumn.ts';
import { findSpawn } from '../../../src/world/gen/spawn.ts';
import { VoxelWorld } from '../../../src/world/VoxelWorld.ts';
import { registry } from '../../helpers/registry.ts';

function arenaWorld() {
  const ctx = createGenContext('arena', registry, 'arena');
  const world = new VoxelWorld(registry.air, registry.unknownBlock);
  for (let cx = -1; cx <= 0; cx++) {
    for (let cz = -1; cz <= 0; cz++) {
      const column = new Column(cx, cz, registry.air);
      generateColumn(ctx, column);
      world.columns.set(columnKey(cx, cz), column);
    }
  }
  const block = (x: number, y: number, z: number) => registry.states[world.getBlock(x, y, z)]!.key;
  return { ctx, world, block };
}

const G = FLAT_SURFACE;

describe('arena world', () => {
  it('builds a closed cabin with a 2-block gate (both halves) and a glass window', () => {
    const { block } = arenaWorld();
    for (let x = 3; x <= 7; x++) {
      for (let z = -9; z <= -5; z++) {
        expect(block(x, G + 4, z)).toBe('block:planks');
        const inside = x > 3 && x < 7 && z > -9 && z < -5;
        for (let y = G + 1; y <= G + 3; y++) {
          const expected =
            x === 5 && z === -5 && y <= G + 2
              ? `block:gate[facing4=s,open=0,half=${y === G + 1 ? 'lower' : 'upper'}]`
              : x === 7 && z === -7 && y === G + 2
                ? 'block:glass'
                : inside
                  ? 'block:air'
                  : 'block:planks';
          expect(block(x, y, z), `${x},${y},${z}`).toBe(expected);
        }
      }
    }
  });

  it('has a pond, gravel, a tree and a wall of every listed block', () => {
    const { block, world } = arenaWorld();
    expect(block(-8, G, 3)).toBe('block:fresh_water');
    expect(block(-8, G - 1, 3)).toBe('block:fresh_water');
    expect(block(-8, G, 7)).toBe('block:sand');
    expect(block(-2, G, 7)).toBe('block:gravel');
    for (let y = G + 1; y <= G + 5; y++) expect(block(9, y, 5)).toBe('block:broadleaf_log[axis=y]');
    expect(block(9, G + 6, 5)).toBe('block:foliage');
    const ores = registry.pack.arena!.oreWall;
    ores.forEach((key, i) => {
      expect(block(-7 + i, G + 1, -8)).toBe(key);
      expect(block(-7 + i, G + 2, -8)).toBe(key);
    });
    const column = world.getColumn(0, 0)!;
    expect(column.heightmap[columnIndex(toLocal(9), toLocal(5))]).toBe(G + 7);
  });

  it('lines up the workshop (stations and a chest, facing south) north of the spawn', () => {
    const { block } = arenaWorld();
    expect([-3, -2, -1, 0, 1, 2, 3].map((x) => block(x, G + 1, -3))).toEqual([
      'block:workbench',
      'block:air',
      'block:kiln[facing4=s,lit=0]',
      'block:air',
      'block:campfire[lit=0]',
      'block:air',
      'block:chest[facing4=s]',
    ]);
  });

  it('spawns in the open and keeps flat ground away from the features', () => {
    const { ctx, block } = arenaWorld();
    expect(findSpawn(ctx)).toEqual({ x: 0.5, y: G + 1, z: 0.5 });
    expect(block(0, G + 1, 0)).toBe('block:air');
    expect(block(0, G + 2, 0)).toBe('block:air');
    const flat = createGenContext('arena', registry, 'flat');
    const far = (c: typeof ctx) => {
      const column = new Column(4, -6, registry.air);
      generateColumn(c, column);
      return columnHash(c, column);
    };
    expect(far(ctx)).toBe(far(flat));
  });
});
