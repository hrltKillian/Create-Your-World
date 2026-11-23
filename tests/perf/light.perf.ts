import { describe, expect, it } from 'vitest';
import { Column } from '../../src/world/Column.ts';
import { createGenContext, generateColumn } from '../../src/world/gen/generateColumn.ts';
import { columnLight } from '../../src/world/light/columnLight.ts';
import { LightEngine } from '../../src/world/light/LightEngine.ts';
import { registry } from '../helpers/registry.ts';

/**
 * Node threshold of docs/conception.md « Mesure de performance » (Apple M4, about 0.6× the M1
 * target): stitching one column border, comparison and flood, median after a warm-up.
 */
const SEAM_MEDIAN_MS = 0.5;

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

describe('light performance', () => {
  it(`stitches one border in ≤ ${SEAM_MEDIAN_MS} ms (median)`, () => {
    const ctx = createGenContext('perf-seam', registry);
    const lit = (cx: number, cz: number) => {
      const column = new Column(cx, cz, registry.air);
      generateColumn(ctx, column);
      columnLight(column, registry.tables);
      return column;
    };
    const light = new LightEngine(registry.tables);
    const times: number[] = [];
    for (let i = 0; i < 45; i++) {
      // Borders along x and along z in turn, on terrain spread over a few kilometres.
      const a = lit(i * 7, -i * 5);
      const b = i % 2 === 0 ? lit(a.cx + 1, a.cz) : lit(a.cx, a.cz + 1);
      light.addColumn(a);
      const t0 = performance.now();
      light.addColumn(b);
      light.stitch(Number.POSITIVE_INFINITY);
      if (i >= 5) times.push(performance.now() - t0);
      light.removeColumn(a.cx, a.cz);
      light.removeColumn(b.cx, b.cz);
    }
    console.info(`seam median ${median(times).toFixed(3)} ms`);
    expect(median(times)).toBeLessThanOrEqual(SEAM_MEDIAN_MS);
  });
});
