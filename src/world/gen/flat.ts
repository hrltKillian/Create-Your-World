import type { Column } from '../Column.ts';
import { localIndex, SECTION_BITS, SECTION_MASK, SECTION_SIZE } from '../coords.ts';

/** Surface height of the flat test world: the top grass layer is at y 64. */
export const FLAT_SURFACE = 64;

/** Flat test world: bedrock, stone, 3 layers of filler and a surface layer, no features. */
export function generateFlatColumn(
  column: Column,
  blocks: {
    readonly bedrock: number;
    readonly stone: number;
    readonly filler: number;
    readonly surface: number;
  },
): void {
  for (let lz = 0; lz < SECTION_SIZE; lz++) {
    for (let lx = 0; lx < SECTION_SIZE; lx++) {
      for (let y = 0; y <= FLAT_SURFACE; y++) {
        const state =
          y === 0
            ? blocks.bedrock
            : y < FLAT_SURFACE - 3
              ? blocks.stone
              : y < FLAT_SURFACE
                ? blocks.filler
                : blocks.surface;
        column.sections[y >> SECTION_BITS]!.setBlock(localIndex(lx, y & SECTION_MASK, lz), state);
      }
      column.heightmap[lx | (lz << 5)] = FLAT_SURFACE + 1;
    }
  }
  for (const section of column.sections) section.compact();
}
