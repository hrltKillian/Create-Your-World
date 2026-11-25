import { describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { findBiome } from '../../../src/world/gen/find.ts';
import { createGenContext, type GenContext } from '../../../src/world/gen/generateColumn.ts';
import type { ResolvedOre } from '../../../src/world/gen/ores.ts';
import { findSpawn } from '../../../src/world/gen/spawn.ts';
import { biomeIndex, findColumn, generate } from '../../helpers/gen.ts';
import { registry } from '../../helpers/registry.ts';

/*
 * Ore layers (docs plan v2 « M16 », plan v3 « M24 »): the frequency of each layer is its table's,
 * the common ores lie in the stone of every biome and never in the dark stone, and every ore a
 * biome holds alone lies within 1 km of the spawn.
 */

const SEEDS = ['1', '2', '3', '7', '11', '42', '99', 'ore', 'planet', 'colony'];
/** Columns sampled per seed (enough host cells in the high layer, above most lowlands). */
const COLUMNS = 8;

describe('ore layers', () => {
  it('starts veins as often as each layer says (±20 %, 10 seeds)', () => {
    // One-block veins of a single test ore in every biome: each vein that starts on stone turns
    // exactly one cell, so the ore cells count the veins started.
    const stone = registry.defaultState('block:stone');
    const ore = registry.defaultState('block:emberstone');
    const layers = [
      { y0: 36, y1: 59, chance: 0.25, veins: 40, size0: 1, size1: 1 },
      { y0: 68, y1: 91, chance: 0.75, veins: 40, size0: 1, size1: 1 },
    ];
    const probe: ResolvedOre = {
      block: ore,
      biomes: new Uint8Array(16).fill(1),
      layers,
      replaces: new Set([stone]),
      caveWall: false,
      underLiquid: false,
    };
    const counts = [0, 0];
    const hosts = [0, 0];
    for (const seed of SEEDS) {
      const base = createGenContext(seed, registry);
      const ctx: GenContext = { ...base, ores: [probe] };
      const bare: GenContext = { ...base, ores: [] };
      for (let i = 0; i < COLUMNS; i++) {
        const [cx, cz] = [i * 13 - 20, i * 9 - 15];
        const column = generate(ctx, cx, cz);
        const without = generate(bare, cx, cz);
        layers.forEach((layer, l) => {
          // Sections whose inset range lies wholly inside the layer: 1 (y 35–60), 2 (y 67–92).
          const sy = l === 0 ? 1 : 2;
          for (let i = 0; i < 32768; i++) {
            const y = sy * 32 + (i >> 10);
            const x = i & 31;
            const z = (i >> 5) & 31;
            if (x < 3 || x > 28 || z < 3 || z > 28 || y < layer.y0 || y > layer.y1) continue;
            if (without.sections[sy]!.getBlock(i) === stone) hosts[l]!++;
            if (column.sections[sy]!.getBlock(i) === ore) counts[l]!++;
          }
        });
      }
    }
    const cells = 26 * 26 * 24;
    layers.forEach((layer, l) => {
      const sections = SEEDS.length * COLUMNS;
      const expected = sections * layer.veins * layer.chance * (hosts[l]! / (sections * cells));
      expect(counts[l]!, `layer ${l}`).toBeGreaterThan(expected * 0.8);
      expect(counts[l]!, `layer ${l}`).toBeLessThan(expected * 1.2);
    });
  });

  it('puts every ore one biome holds within 1 km of the spawn (20 seeds)', () => {
    const exclusive = (basePack.ores ?? []).filter((ore) => ore.biomes !== '*');
    expect(exclusive.length).toBeGreaterThanOrEqual(3);
    for (let s = 0; s < 20; s++) {
      const ctx = createGenContext(`spawn-${s}`, registry);
      const spawn = findSpawn(ctx);
      for (const ore of exclusive) {
        const found = (ore.biomes as readonly string[]).some(
          (biome) => findBiome(ctx, biome, spawn, 1000) !== null,
        );
        expect(found, `${ore.key} for seed spawn-${s}`).toBe(true);
      }
    }
  });

  it('puts every common ore in the stone of every biome, never in the dark stone', () => {
    const ctx = createGenContext('commons', registry);
    const deep = registry.defaultState(basePack.worldgen!.deepStone);
    const commons = ctx.ores.filter((ore) => ore.biomes.every((b) => b === 1) && !ore.caveWall);
    expect(commons.length).toBeGreaterThanOrEqual(2);
    for (const biome of ctx.biomes) {
      // A dry land column of the biome: its stone holds every common ore.
      const { cx, cz } = findColumn(
        ctx,
        (info) => info.biome === biomeIndex(ctx, biome.def.key) && info.height > ctx.def.seaLevel,
      );
      const counts = new Map<number, number>();
      const column = generate(ctx, cx, cz);
      for (let sy = 0; sy < 8; sy++)
        for (let i = 0; i < 32768; i++) {
          const state = column.sections[sy]!.getBlock(i);
          counts.set(state, (counts.get(state) ?? 0) + 1);
        }
      for (const ore of commons) {
        expect(
          counts.get(ore.block) ?? 0,
          `${registry.states[ore.block]!.key} in ${biome.def.key}`,
        ).toBeGreaterThan(0);
        expect(ore.replaces.has(deep)).toBe(false);
        for (const layer of ore.layers)
          expect(layer.y0).toBeGreaterThanOrEqual(ctx.def.deepStoneBelowY);
      }
    }
  });
});
