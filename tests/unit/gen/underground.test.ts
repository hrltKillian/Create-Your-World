import { describe, expect, it } from 'vitest';
import { FLAG_LIQUID } from '../../../src/content/registry.ts';
import { columnKey } from '../../../src/world/coords.ts';
import { caveAt } from '../../../src/world/gen/caves.ts';
import { createGenContext, type GenContext } from '../../../src/world/gen/generateColumn.ts';
import { heightAt, LatticeCache, pointInfo } from '../../../src/world/gen/sample.ts';
import { VoxelWorld } from '../../../src/world/VoxelWorld.ts';
import { biomeIndex, blockIn, findColumn, generate } from '../../helpers/gen.ts';
import { registry } from '../../helpers/registry.ts';

const ctx = createGenContext('underground', registry);
const air = registry.air;
const carved = (state: number) => state === air || state === ctx.magma;

/** Columns spread over the map (far apart, so they sample different terrain). */
const SPREAD = Array.from({ length: 16 }, (_, i) => [
  (i % 4) * 37 - 60,
  Math.floor(i / 4) * 29 - 45,
]);

describe('caves', () => {
  it('carves exactly the cells caveAt reports', () => {
    const cache = new LatticeCache();
    let open = 0;
    for (const [cx, cz] of SPREAD.slice(0, 4)) {
      const column = generate(ctx, cx!, cz!);
      for (let i = 0; i < 48; i++) {
        const lx = (i * 7) & 31;
        const lz = (i * 13 + 5) & 31;
        const x = cx! * 32 + lx;
        const z = cz! * 32 + lz;
        const h = heightAt(ctx, cache, x, z);
        for (let y = 1; y <= h; y++) {
          const isCave = carved(blockIn(column, lx, y, lz));
          expect(caveAt(ctx, cache, x, y, z), `${x} ${y} ${z}`).toBe(isCave);
          if (isCave) open++;
        }
      }
    }
    expect(open).toBeGreaterThan(100);
  });

  it('carves caves under at least 40 % of the columns', () => {
    const cache = new LatticeCache();
    let withCave = 0;
    for (const [cx, cz] of SPREAD) {
      const column = generate(ctx, cx!, cz!);
      for (let cell = 0; cell < 1024; cell++) {
        const lx = cell & 31;
        const lz = cell >> 5;
        const h = heightAt(ctx, cache, cx! * 32 + lx, cz! * 32 + lz);
        for (let y = 1; y <= h; y++) {
          if (carved(blockIn(column, lx, y, lz))) {
            withCave++;
            break;
          }
        }
      }
    }
    expect(withCave / (SPREAD.length * 1024)).toBeGreaterThanOrEqual(0.4);
  });

  it('never carves under water nor next to it', () => {
    // A shore column (water and dry land), with its 8 neighbours loaded.
    const { cx, cz } = findColumn(
      ctx,
      (_info, x, z) => {
        const depths = [0, 31].flatMap((dx) =>
          [0, 31].map((dz) => pointInfo(ctx, x * 32 + dx, z * 32 + dz).height),
        );
        return (
          Math.min(...depths) < ctx.def.seaLevel - 3 && Math.max(...depths) > ctx.def.seaLevel + 3
        );
      },
      1,
    );
    const world = new VoxelWorld(air, registry.unknownBlock);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        world.columns.set(columnKey(cx + dx, cz + dz), generate(ctx, cx + dx, cz + dz));
    const flags = registry.tables.flags;
    let water = 0;
    for (let lz = 0; lz < 32; lz++) {
      for (let lx = 0; lx < 32; lx++) {
        const x = cx * 32 + lx;
        const z = cz * 32 + lz;
        for (let y = 1; y <= ctx.def.seaLevel; y++) {
          if ((flags[world.getBlock(x, y, z)]! & FLAG_LIQUID) === 0) continue;
          water++;
          for (const [nx, ny, nz] of [
            [x - 1, y, z],
            [x + 1, y, z],
            [x, y - 1, z],
            [x, y, z - 1],
            [x, y, z + 1],
          ] as const) {
            const next = world.getBlock(nx, ny, nz);
            expect(carved(next) && ny <= pointInfo(ctx, nx, nz).height, `${nx} ${ny} ${nz}`).toBe(
              false,
            );
          }
        }
        // Under water, the ground stays whole down to the worldrock.
        const h = pointInfo(ctx, x, z).height;
        if (h < ctx.def.seaLevel)
          for (let y = 1; y <= h; y++) expect(carved(world.getBlock(x, y, z))).toBe(false);
      }
    }
    expect(water).toBeGreaterThan(100);
  });

  it('fills the caves below y 10 with magma, which glows and burns', () => {
    let magma = 0;
    for (const [cx, cz] of SPREAD.slice(0, 6)) {
      const column = generate(ctx, cx!, cz!);
      for (let cell = 0; cell < 1024; cell++) {
        for (let y = 1; y < 32; y++) {
          const state = blockIn(column, cell & 31, y, cell >> 5);
          if (state === ctx.magma) {
            expect(y).toBeLessThan(ctx.def.magmaBelowY);
            magma++;
          }
          if (y < ctx.def.magmaBelowY) expect(state).not.toBe(air);
        }
      }
    }
    expect(magma).toBeGreaterThan(0);
    expect(registry.tables.emit[ctx.magma]).toBe(15);
    expect(registry.blockDef(ctx.magma).heat).toBeDefined();
  });
});

describe('ores', () => {
  /** A column of each biome that has ores, and the same columns generated without ores. */
  function oreDiffs(gen: GenContext, columns: readonly { cx: number; cz: number }[]) {
    const bare: GenContext = { ...gen, ores: [] };
    return columns.map(({ cx, cz }) => ({
      column: generate(gen, cx, cz),
      bare: generate(bare, cx, cz),
    }));
  }

  it('replaces only host blocks, at least 2 blocks inside the section, near allowed biomes', () => {
    const lowMarsh = biomeIndex(ctx, 'biome:fungal_marsh');
    const columns = [
      ...['biome:meadow', 'biome:tundra', 'biome:ochre_desert', 'biome:highlands'].map((key) =>
        findColumn(ctx, (info) => info.biome === biomeIndex(ctx, key)),
      ),
      // Bog iron forms in the silt of marsh ponds (y 54–62).
      findColumn(ctx, (info) => info.biome === lowMarsh && info.height < ctx.def.seaLevel - 2, 1),
    ];
    const counts = new Map<number, number>();
    for (const { column, bare } of oreDiffs(ctx, columns)) {
      for (let sy = 0; sy < 8; sy++) {
        for (let i = 0; i < 32768; i++) {
          const state = column.sections[sy]!.getBlock(i);
          const before = bare.sections[sy]!.getBlock(i);
          if (state === before) continue;
          const ore = ctx.ores.find((o) => o.block === state);
          expect(ore, registry.states[state]!.key).toBeDefined();
          expect(ore!.replaces.has(before)).toBe(true);
          const lx = i & 31;
          const lz = (i >> 5) & 31;
          const ly = i >> 10;
          for (const v of [lx, ly, lz]) {
            expect(v).toBeGreaterThanOrEqual(2);
            expect(v).toBeLessThanOrEqual(29);
          }
          const y = sy * 32 + ly;
          expect(y).toBeGreaterThanOrEqual(ore!.y0 - 1);
          expect(y).toBeLessThanOrEqual(ore!.y1 + 1);
          // The vein centre is within one block: its column (or a neighbour) has an allowed biome.
          let near = false;
          for (let dz = -1; dz <= 1; dz++)
            for (let dx = -1; dx <= 1; dx++)
              if (ore!.biomes[column.biomes[(lx + dx) | ((lz + dz) << 5)]!] === 1) near = true;
          expect(near).toBe(true);
          if (ore!.caveWall) {
            const touches = [
              [lx - 1, y, lz],
              [lx + 1, y, lz],
              [lx, y - 1, lz],
              [lx, y + 1, lz],
              [lx, y, lz - 1],
              [lx, y, lz + 1],
            ].some(([x, yy, z]) => blockIn(column, x!, yy!, z!) === air);
            expect(touches).toBe(true);
          }
          counts.set(state, (counts.get(state) ?? 0) + 1);
        }
      }
    }
    // Every ore of the table shows up in its biome.
    for (const ore of ctx.ores)
      expect(counts.get(ore.block) ?? 0, registry.states[ore.block]!.key).toBeGreaterThan(0);
  });
});
