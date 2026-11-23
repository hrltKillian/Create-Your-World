import { Column } from '../../src/world/Column.ts';
import { localIndex } from '../../src/world/coords.ts';
import type { GenContext } from '../../src/world/gen/generateColumn.ts';
import { generateColumn } from '../../src/world/gen/generateColumn.ts';
import { LatticeCache, type PointInfo, pointInfo } from '../../src/world/gen/sample.ts';
import { registry } from './registry.ts';

/** A freshly generated column. */
export function generate(ctx: GenContext, cx: number, cz: number): Column {
  const column = new Column(cx, cz, registry.air);
  generateColumn(ctx, column);
  return column;
}

/** Block state of a column at local coordinates. */
export function blockIn(column: Column, lx: number, y: number, lz: number): number {
  return column.sections[y >> 5]!.getBlock(localIndex(lx, y & 31, lz));
}

/** Index of a biome in `ctx.biomes`. */
export function biomeIndex(ctx: GenContext, key: string): number {
  const index = ctx.biomes.findIndex((b) => b.def.key === key);
  if (index < 0) throw new Error(`no biome ${key}`);
  return index;
}

/**
 * The first column (spiralling out from the origin, every `step` columns) whose centre block
 * satisfies `test` (analytic, nothing is generated).
 */
export function findColumn(
  ctx: GenContext,
  test: (info: PointInfo, cx: number, cz: number) => boolean,
  step = 3,
  maxRadius = 120,
): { cx: number; cz: number } {
  const cache = new LatticeCache();
  for (let r = 0; r <= maxRadius; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = dx * step;
        const cz = dz * step;
        if (test(pointInfo(ctx, cx * 32 + 16, cz * 32 + 16, cache), cx, cz)) return { cx, cz };
      }
    }
  }
  throw new Error('no matching column found');
}
