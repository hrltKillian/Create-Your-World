import { Column, sectionPayloads } from '../Column.ts';
import { columnLight } from '../light/columnLight.ts';
import type { GenResult } from '../protocol.ts';
import { type GenContext, generateColumn } from './generateColumn.ts';

/**
 * Generates a column with its local light and packs it as a generation result (`ms` is left for
 * the caller to time). The worker job and the inline source both go through here.
 */
export function generateResult(ctx: GenContext, air: number, cx: number, cz: number): GenResult {
  const column = new Column(cx, cz, air);
  generateColumn(ctx, column);
  columnLight(column, ctx.registry.tables);
  return {
    kind: 'gen',
    seed: ctx.seed,
    cx,
    cz,
    sections: sectionPayloads(column),
    heightmap: column.heightmap,
    biomes: column.biomes,
    ms: 0,
  };
}
