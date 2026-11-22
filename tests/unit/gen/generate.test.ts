import { describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { buildRegistry } from '../../../src/content/registry.ts';
import { Column } from '../../../src/world/Column.ts';
import { localIndex } from '../../../src/world/coords.ts';
import {
  columnHash,
  createGenContext,
  findSpawn,
  GEN_VERSION,
  generateColumn,
  LatticeCache,
  pointInfo,
} from '../../../src/world/gen/generateColumn.ts';

const registry = buildRegistry(basePack);

function generate(
  seed: string,
  cx: number,
  cz: number,
  ctx = createGenContext(seed, registry),
): Column {
  const column = new Column(cx, cz, registry.air);
  generateColumn(ctx, column);
  return column;
}

describe('world generation', () => {
  it(`matches golden column hashes (GEN_VERSION ${GEN_VERSION})`, () => {
    const ctx = createGenContext('1337', registry);
    const hashes = Object.fromEntries(
      (
        [
          [0, 0],
          [5, -3],
          [-12, 7],
          [40, 40],
        ] as const
      ).map(([cx, cz]) => [
        `${cx},${cz}`,
        columnHash(ctx, generate('1337', cx, cz, ctx)).toString(16),
      ]),
    );
    expect({ GEN_VERSION, hashes }).toMatchSnapshot();
  });

  it('does not depend on generation order or on a shared context', () => {
    const shared = createGenContext('order', registry);
    const a1 = columnHash(shared, generate('order', 0, 0, shared));
    const b1 = columnHash(shared, generate('order', 1, 0, shared));
    const fresh = createGenContext('order', registry);
    const b2 = columnHash(fresh, generate('order', 1, 0, fresh));
    const a2 = columnHash(fresh, generate('order', 0, 0, fresh));
    expect([a2, b2]).toEqual([a1, b1]);
  });

  it('gives the same biome and surface for point queries and whole columns', () => {
    const ctx = createGenContext('points', registry);
    for (const [cx, cz] of [
      [0, 0],
      [-7, 3],
      [20, -15],
    ] as const) {
      const column = generate('points', cx, cz, ctx);
      const cache = new LatticeCache();
      for (let i = 0; i < 64; i++) {
        const lx = (i * 13) & 31;
        const lz = (i * 7 + 3) & 31;
        const info = pointInfo(ctx, cx * 32 + lx, cz * 32 + lz, cache);
        expect(column.biomes[lx | (lz << 5)]).toBe(info.biome);
        const biome = ctx.biomes[info.biome]!;
        const expected = info.height < ctx.def.seaLevel ? biome.seabed : biome.surface;
        const section = column.sections[info.height >> 5]!;
        expect(section.getBlock(localIndex(lx, info.height & 31, lz))).toBe(expected);
      }
    }
  });

  it('puts every biome on the map in reasonable shares (analytic census)', () => {
    const ctx = createGenContext('census', registry);
    const counts = new Array<number>(ctx.biomes.length).fill(0);
    const cache = new LatticeCache();
    for (let gz = 0; gz < 64; gz++) {
      for (let gx = 0; gx < 64; gx++)
        counts[pointInfo(ctx, (gx - 32) * 64 + 5, (gz - 32) * 64 + 11, cache).biome]!++;
    }
    const share = Object.fromEntries(ctx.biomes.map((b, i) => [b.def.key, counts[i]! / 4096]));
    for (const [key, value] of Object.entries(share))
      expect(value, key).toBeGreaterThanOrEqual(0.03);
    expect(share['biome:fungal_marsh']).toBeGreaterThanOrEqual(0.05);
    expect(share['biome:fungal_marsh']).toBeLessThanOrEqual(0.2);
  });

  it('places the provisional spawn on dry land in a spawn biome', () => {
    for (const seed of ['1', '2', '3', '4', '5']) {
      const ctx = createGenContext(seed, registry);
      const spawn = findSpawn(ctx);
      const info = pointInfo(ctx, Math.floor(spawn.x), Math.floor(spawn.z));
      expect(info.height).toBeGreaterThan(ctx.def.seaLevel);
      expect(ctx.spawnBiomes.has(info.biome)).toBe(true);
      expect(spawn.y).toBe(info.height + 1);
    }
  });

  it('builds heightmaps that sit on top of the highest block', () => {
    const column = generate('heights', 2, 2);
    for (const cell of [0, 77, 500, 1023]) {
      const lx = cell & 31;
      const lz = cell >> 5;
      const top = column.heightmap[cell]! - 1;
      expect(column.sections[top >> 5]!.getBlock(localIndex(lx, top & 31, lz))).not.toBe(
        registry.air,
      );
      const above = top + 1;
      expect(column.sections[above >> 5]!.getBlock(localIndex(lx, above & 31, lz))).toBe(
        registry.air,
      );
    }
  });
});
