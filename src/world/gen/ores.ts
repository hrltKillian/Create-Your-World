import { Rng, seedState } from '../../core/rng.ts';
import type { Column } from '../Column.ts';
import { columnIndex, localIndex, SECTION_SIZE } from '../coords.ts';
import type { Section } from '../Section.ts';
import type { GenContext } from './generateColumn.ts';

/** An ore of the pack with block states and biome indices resolved. */
export interface ResolvedOre {
  readonly block: number;
  /** 1 for each biome index where veins may start. */
  readonly biomes: Uint8Array;
  readonly y0: number;
  readonly y1: number;
  readonly veins: number;
  readonly size0: number;
  readonly size1: number;
  readonly replaces: ReadonlySet<number>;
  readonly caveWall: boolean;
}

/** Vein centres stay at least this far inside the section; veins reach one block further out. */
const INSET = 3;

/**
 * Ore veins (docs « Génération » step 6). Each section has its own random stream, so a section's
 * ores depend on nothing else. A vein walks up to `size` blocks inside the 3×3×3 cube around its
 * centre, so every ore block lies at least 2 blocks from the section faces, and only blocks of
 * `replaces` (touching a cave for `caveWall` ores) turn to ore.
 */
export function placeOres(ctx: GenContext, column: Column): void {
  if (ctx.ores.length === 0) return;
  const air = ctx.registry.air;
  for (let sy = 0; sy < column.sections.length; sy++) {
    const section = column.sections[sy]!;
    if (section.isEmpty(air)) continue;
    const base = sy * SECTION_SIZE;
    const rng = new Rng(seedState(ctx.seed, `ores:${column.cx}:${sy}:${column.cz}`));
    for (const ore of ctx.ores) {
      const lo = Math.max(ore.y0, base + INSET);
      const hi = Math.min(ore.y1, base + SECTION_SIZE - 1 - INSET);
      if (lo > hi) continue;
      for (let v = 0; v < ore.veins; v++) {
        const cx = rng.intRange(INSET, SECTION_SIZE - 1 - INSET);
        const cz = rng.intRange(INSET, SECTION_SIZE - 1 - INSET);
        const cy = rng.intRange(lo, hi) - base;
        const size = rng.intRange(ore.size0, ore.size1);
        if (ore.biomes[column.biomes[columnIndex(cx, cz)]!] === 0) continue;
        let x = cx;
        let y = cy;
        let z = cz;
        for (let k = 0; k < size; k++) {
          const index = localIndex(x, y, z);
          const current = section.getBlock(index);
          if (ore.replaces.has(current) && (!ore.caveWall || touchesAir(section, x, y, z, air)))
            section.setBlock(index, ore.block);
          // Step to a neighbour, bouncing back inside the cube around the centre.
          const axis = rng.int(3);
          const step = rng.next() < 0.5 ? -1 : 1;
          if (axis === 0) x = Math.abs(x + step - cx) > 1 ? x - step : x + step;
          else if (axis === 1) y = Math.abs(y + step - cy) > 1 ? y - step : y + step;
          else z = Math.abs(z + step - cz) > 1 ? z - step : z + step;
        }
      }
    }
  }
}

/** Whether a face neighbour of a cell (at least one block inside the section) is air. */
function touchesAir(section: Section, x: number, y: number, z: number, air: number): boolean {
  return (
    section.getBlock(localIndex(x - 1, y, z)) === air ||
    section.getBlock(localIndex(x + 1, y, z)) === air ||
    section.getBlock(localIndex(x, y - 1, z)) === air ||
    section.getBlock(localIndex(x, y + 1, z)) === air ||
    section.getBlock(localIndex(x, y, z - 1)) === air ||
    section.getBlock(localIndex(x, y, z + 1)) === air
  );
}
