/** World coordinates: +y up, north = −z. Sections are 32³, columns are 32×256×32 (8 sections). */

export const SECTION_BITS = 5;
export const SECTION_SIZE = 32;
export const SECTION_MASK = 31;
export const SECTION_VOLUME = SECTION_SIZE * SECTION_SIZE * SECTION_SIZE;
export const SECTIONS_PER_COLUMN = 8;
export const WORLD_HEIGHT = SECTION_SIZE * SECTIONS_PER_COLUMN;
/** Hard world border in blocks (|x|, |z| < BORDER). */
export const WORLD_BORDER = 1_000_000;

const KEY_OFFSET = 1 << 20;
const KEY_SPAN = 1 << 21;

/** Column coordinate of a block coordinate (floor division, works for negatives). */
export function toColumn(v: number): number {
  return v >> SECTION_BITS;
}

/** Column (or section) coordinate of a fractional block coordinate, such as a body position. */
export function blockToColumn(v: number): number {
  return toColumn(Math.floor(v));
}

/** Local coordinate inside a section/column (0–31). */
export function toLocal(v: number): number {
  return v & SECTION_MASK;
}

/** Index of a voxel inside a section: x | z << 5 | y << 10. */
export function localIndex(lx: number, ly: number, lz: number): number {
  return lx | (lz << 5) | (ly << 10);
}

/** Index of a cell in a column's 2D data (heightmap, biomes): x | z << 5. */
export function columnIndex(lx: number, lz: number): number {
  return lx | (lz << 5);
}

/** Safe-integer key of a column (unique for |cx|, |cz| < 2^20). */
export function columnKey(cx: number, cz: number): number {
  return (cx + KEY_OFFSET) * KEY_SPAN + (cz + KEY_OFFSET);
}

export function columnKeyX(key: number): number {
  return Math.floor(key / KEY_SPAN) - KEY_OFFSET;
}

export function columnKeyZ(key: number): number {
  return (key % KEY_SPAN) - KEY_OFFSET;
}

/** Safe-integer key of a section: column key × 8 + sy. */
export function sectionKey(cx: number, sy: number, cz: number): number {
  return columnKey(cx, cz) * SECTIONS_PER_COLUMN + sy;
}

export interface SectionCoords {
  cx: number;
  sy: number;
  cz: number;
}

/** Decodes a section key into `out` (no allocation) and returns it. */
export function sectionKeyParts(key: number, out: SectionCoords): SectionCoords {
  const column = Math.floor(key / SECTIONS_PER_COLUMN);
  out.cx = columnKeyX(column);
  out.sy = key - column * SECTIONS_PER_COLUMN;
  out.cz = columnKeyZ(column);
  return out;
}

export function insideBorder(x: number, z: number): boolean {
  return x > -WORLD_BORDER && x < WORLD_BORDER && z > -WORLD_BORDER && z < WORLD_BORDER;
}
