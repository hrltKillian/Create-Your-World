import { Rng, seedState } from '../../core/rng.ts';
import type { Column } from '../Column.ts';
import { columnIndex, localIndex, SECTION_SIZE } from '../coords.ts';
import type { Section } from '../Section.ts';
import { heightIndex } from './caves.ts';
import type { GenContext } from './generateColumn.ts';

/** A layer of an ore (`OreLayer`) resolved. */
export interface ResolvedLayer {
  readonly y0: number;
  readonly y1: number;
  readonly chance: number;
  readonly veins: number;
  readonly size0: number;
  readonly size1: number;
}

/** An ore of the pack with block states and biome indices resolved. */
export interface ResolvedOre {
  readonly block: number;
  /** 1 for each biome index where veins may start. */
  readonly biomes: Uint8Array;
  readonly layers: readonly ResolvedLayer[];
  readonly replaces: ReadonlySet<number>;
  readonly caveWall: boolean;
  readonly underLiquid: boolean;
}

/** Vein centres stay at least this far inside the section; veins reach one block further out. */
const INSET = 3;

/**
 * Ore veins (docs « Génération » step 6, plan v2 « M16 »). Each section has its own random
 * stream, so a section's ores depend on nothing else. For each layer of an ore that the section
 * reaches, `veins` attempts each draw a centre, a size and a roll: the vein starts when the roll is
 * under the layer's `chance` (the draws are the same either way). A vein walks up to `size` blocks
 * inside the 3×3×3 cube around its centre, so every ore block lies at least 2 blocks from the
 * section faces, never outside its layer's y range, and only blocks of `replaces` (touching a cave
 * for `caveWall` ores) turn to ore. `underLiquid` veins start only where the centre's column (its
 * surface in the padded `heights`) lies below the sea level.
 */
export function placeOres(ctx: GenContext, column: Column, heights: Int16Array): void {
  if (ctx.ores.length === 0) return;
  const air = ctx.registry.air;
  for (let sy = 0; sy < column.sections.length; sy++) {
    const section = column.sections[sy]!;
    if (section.isEmpty(air)) continue;
    const base = sy * SECTION_SIZE;
    const rng = new Rng(seedState(ctx.seed, `ores:${column.cx}:${sy}:${column.cz}`));
    for (const ore of ctx.ores) {
      for (const layer of ore.layers) {
        const lo = Math.max(layer.y0, base + INSET);
        const hi = Math.min(layer.y1, base + SECTION_SIZE - 1 - INSET);
        if (lo > hi) continue;
        for (let v = 0; v < layer.veins; v++) {
          const cx = rng.intRange(INSET, SECTION_SIZE - 1 - INSET);
          const cz = rng.intRange(INSET, SECTION_SIZE - 1 - INSET);
          const cy = rng.intRange(lo, hi) - base;
          const size = rng.intRange(layer.size0, layer.size1);
          if (rng.next() >= layer.chance) continue;
          if (ore.biomes[column.biomes[columnIndex(cx, cz)]!] === 0) continue;
          if (ore.underLiquid && heights[heightIndex(cx, cz)]! >= ctx.def.seaLevel) continue;
          walkVein(rng, section, ore, cx, cy, cz, size, layer.y0 - base, layer.y1 - base, air);
        }
      }
    }
  }
}

/** Walks a vein from its centre, turning host blocks within [ly0, ly1] (section y) to ore. */
function walkVein(
  rng: Rng,
  section: Section,
  ore: ResolvedOre,
  cx: number,
  cy: number,
  cz: number,
  size: number,
  ly0: number,
  ly1: number,
  air: number,
): void {
  let x = cx;
  let y = cy;
  let z = cz;
  for (let k = 0; k < size; k++) {
    const index = localIndex(x, y, z);
    const current = section.getBlock(index);
    if (
      y >= ly0 &&
      y <= ly1 &&
      ore.replaces.has(current) &&
      (!ore.caveWall || touchesAir(section, x, y, z, air))
    )
      section.setBlock(index, ore.block);
    // Step to a neighbour, bouncing back inside the cube around the centre.
    const axis = rng.int(3);
    const step = rng.next() < 0.5 ? -1 : 1;
    if (axis === 0) x = Math.abs(x + step - cx) > 1 ? x - step : x + step;
    else if (axis === 1) y = Math.abs(y + step - cy) > 1 ? y - step : y + step;
    else z = Math.abs(z + step - cz) > 1 ? z - step : z + step;
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
