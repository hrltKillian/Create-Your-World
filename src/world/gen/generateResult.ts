import { Column, sectionPayloads } from '../Column.ts';
import { SECTION_SIZE } from '../coords.ts';
import { columnLight } from '../light/columnLight.ts';
import type { GenResult, SavedSection } from '../protocol.ts';
import { type GenContext, generateColumn } from './generateColumn.ts';

/**
 * Generates a column with its local light and packs it as a generation result (`ms` is left for
 * the caller to time). Saved sections of an edited column replace the generated ones first, so the
 * light is computed on the final voxels (docs « Streaming »). The worker job and the inline source
 * both go through here.
 */
export function generateResult(
  ctx: GenContext,
  air: number,
  cx: number,
  cz: number,
  saved: readonly SavedSection[] = [],
): GenResult {
  const column = new Column(cx, cz, air);
  generateColumn(ctx, column);
  if (saved.length > 0) restoreSections(column, saved, air);
  columnLight(column, ctx.registry.tables);
  return {
    kind: 'gen',
    seed: ctx.seed,
    cx,
    cz,
    sections: sectionPayloads(column),
    heightmap: column.heightmap,
    biomes: column.biomes,
    persisted: column.persisted,
    ms: 0,
  };
}

/** Lays saved sections over a generated column (taking their arrays) and fixes its heightmap. */
function restoreSections(column: Column, saved: readonly SavedSection[], air: number): void {
  let top = 0;
  for (const s of saved) {
    const section = column.sections[s.sy]!;
    section.blocks = s.blocks;
    section.uniformBlock = s.uniformBlock;
    column.persisted |= 1 << s.sy;
    top = Math.max(top, (s.sy + 1) * SECTION_SIZE);
  }
  for (let cell = 0; cell < 1024; cell++) {
    // Above both the generated surface and the saved sections, the column is air.
    let y = Math.max(column.heightmap[cell]!, top) - 1;
    while (y >= 0 && column.getBlock(cell & 31, y, cell >> 5) === air) y--;
    column.heightmap[cell] = y + 1;
  }
}
