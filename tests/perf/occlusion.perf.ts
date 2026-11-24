import { describe, expect, it } from 'vitest';
import { Occlusion } from '../../src/render/Occlusion.ts';
import { SECTIONS_PER_COLUMN, sectionKey } from '../../src/world/coords.ts';
import { ALL_CONNECTED } from '../../src/world/mesh/visibility.ts';

/**
 * The cave culling's walk runs at most once per frame, inside the « Rendu CPU ≤ 4 ms » budget:
 * a walk at the largest render distance (12) stays under a quarter of it (median, Node, M4).
 */
const WALK_MEDIAN_MS = 1;
const RD = 12;

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

/**
 * Masks of every section within reach: open (the worst case: everything is reached), or mixed
 * (7 in 10 open, 2 solid, 1 with random pairs).
 */
function masks(mixed: boolean): Map<number, number> {
  const out = new Map<number, number>();
  let seed = 12345;
  for (let cx = -RD - 1; cx <= RD + 1; cx++) {
    for (let cz = -RD - 1; cz <= RD + 1; cz++) {
      for (let sy = 0; sy < SECTIONS_PER_COLUMN; sy++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const kind = (seed >> 8) % 10;
        const mask = !mixed || kind < 7 ? ALL_CONNECTED : kind < 9 ? 0 : seed & ALL_CONNECTED;
        out.set(sectionKey(cx, sy, cz), mask);
      }
    }
  }
  return out;
}

describe('performance', () => {
  for (const mixed of [false, true]) {
    it(`walks the sections at RD ${RD} in ≤ ${WALK_MEDIAN_MS} ms (median, ${mixed ? 'mixed' : 'open'} masks)`, () => {
      const occlusion = new Occlusion();
      const grid = masks(mixed);
      const times: number[] = [];
      for (let i = 0; i < 60; i++) {
        // A new camera section every time: each update walks.
        const t0 = performance.now();
        occlusion.update(16 + (i % 2) * 32, 40, 16, RD, grid);
        if (i >= 10) times.push(performance.now() - t0);
      }
      console.info(
        `occlusion walk median ${median(times).toFixed(3)} ms, ${occlusion.stats().reached} reached`,
      );
      expect(median(times)).toBeLessThanOrEqual(WALK_MEDIAN_MS);
    });
  }
});
