import { columnIndex, SECTION_SIZE, SECTIONS_PER_COLUMN, toLocal } from '../coords.ts';
import { FULL_SKY } from '../light.ts';
import type { Section } from '../Section.ts';

/** Padded copy: the section plus a one-voxel border from its 26 neighbours (34³ cells). */
export const PADDED = SECTION_SIZE + 2;
export const PADDED_AREA = PADDED * PADDED;
export const PADDED_VOLUME = PADDED * PADDED * PADDED;

/** Index in a padded array; x, y, z range over −1…32. */
export function paddedIndex(x: number, y: number, z: number): number {
  return x + 1 + (z + 1) * PADDED + (y + 1) * PADDED_AREA;
}

export interface SectionSource {
  getSection(cx: number, sy: number, cz: number): Section | undefined;
  /** Biome ids of a column (index `columnIndex(x, z)`), if loaded. */
  getBiomes?(cx: number, cz: number): Uint8Array | undefined;
}

export interface PaddedFill {
  /** Block below the world (y < 0). */
  readonly belowBlock: number;
  /** Block and light used for neighbours that are not loaded. */
  readonly missingBlock: number;
  readonly missingLight: number;
  readonly air: number;
}

export interface PaddedVoxels {
  readonly ids: Uint16Array;
  readonly light: Uint8Array;
  /** Biome per padded (x, z): index (x + 1) + (z + 1) * 34. */
  readonly biomes: Uint8Array;
}

export function createPadded(): PaddedVoxels {
  return {
    ids: new Uint16Array(PADDED_VOLUME),
    light: new Uint8Array(PADDED_VOLUME),
    biomes: new Uint8Array(PADDED_AREA),
  };
}

const neighbours: (Section | undefined | null)[] = new Array(27);

/** Copies section (cx, sy, cz) and its border into `out`. */
export function fillPadded(
  source: SectionSource,
  cx: number,
  sy: number,
  cz: number,
  fill: PaddedFill,
  out: PaddedVoxels,
): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const y = sy + dy;
        const slot = dx + 1 + (dz + 1) * 3 + (dy + 1) * 9;
        // null = outside the world vertically (handled separately), undefined = not loaded.
        neighbours[slot] =
          y < 0 || y >= SECTIONS_PER_COLUMN ? null : source.getSection(cx + dx, y, cz + dz);
      }
    }
  }
  const { ids, light, biomes } = out;
  for (let z = -1; z <= SECTION_SIZE; z++) {
    const dz = z < 0 ? -1 : z >= SECTION_SIZE ? 1 : 0;
    for (let x = -1; x <= SECTION_SIZE; x++) {
      const dx = x < 0 ? -1 : x >= SECTION_SIZE ? 1 : 0;
      const columnBiomes = source.getBiomes?.(cx + dx, cz + dz);
      biomes[x + 1 + (z + 1) * PADDED] = columnBiomes
        ? columnBiomes[columnIndex(toLocal(x), toLocal(z))]!
        : 0;
    }
  }
  for (let y = -1; y <= SECTION_SIZE; y++) {
    const dy = y < 0 ? -1 : y >= SECTION_SIZE ? 1 : 0;
    const ly = y & 31;
    const worldY = sy * SECTION_SIZE + y;
    for (let z = -1; z <= SECTION_SIZE; z++) {
      const dz = z < 0 ? -1 : z >= SECTION_SIZE ? 1 : 0;
      const lz = z & 31;
      let p = paddedIndex(-1, y, z);
      for (let x = -1; x <= SECTION_SIZE; x++, p++) {
        const dx = x < 0 ? -1 : x >= SECTION_SIZE ? 1 : 0;
        const section = neighbours[dx + 1 + (dz + 1) * 3 + (dy + 1) * 9];
        if (section === null) {
          if (worldY < 0) {
            ids[p] = fill.belowBlock;
            light[p] = 0;
          } else {
            ids[p] = fill.air;
            light[p] = FULL_SKY;
          }
        } else if (section === undefined) {
          ids[p] = fill.missingBlock;
          light[p] = fill.missingLight;
        } else {
          const index = (x & 31) | (lz << 5) | (ly << 10);
          ids[p] = section.getBlock(index);
          light[p] = section.getLight(index);
        }
      }
    }
  }
}
