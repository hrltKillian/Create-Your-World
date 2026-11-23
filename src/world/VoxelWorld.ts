import { Column } from './Column.ts';
import {
  columnIndex,
  columnKey,
  localIndex,
  SECTION_BITS,
  SECTION_MASK,
  SECTIONS_PER_COLUMN,
  toColumn,
  toLocal,
  WORLD_HEIGHT,
} from './coords.ts';
import { FULL_SKY } from './light.ts';
import type { Section } from './Section.ts';

/** Loaded columns with block and light access by world coordinates. */
export class VoxelWorld {
  readonly columns = new Map<number, Column>();
  readonly air: number;
  /** State returned below the world and inside unloaded columns (treated as solid by gameplay). */
  readonly outside: number;

  constructor(air: number, outside: number) {
    this.air = air;
    this.outside = outside;
  }

  getColumn(cx: number, cz: number): Column | undefined {
    return this.columns.get(columnKey(cx, cz));
  }

  /** Returns the column, creating an empty one if needed. */
  ensureColumn(cx: number, cz: number): Column {
    const key = columnKey(cx, cz);
    let column = this.columns.get(key);
    if (!column) {
      column = new Column(cx, cz, this.air);
      this.columns.set(key, column);
    }
    return column;
  }

  getBiomes(cx: number, cz: number): Uint8Array | undefined {
    return this.getColumn(cx, cz)?.biomes;
  }

  getSection(cx: number, sy: number, cz: number): Section | undefined {
    if (sy < 0 || sy >= SECTIONS_PER_COLUMN) return undefined;
    return this.getColumn(cx, cz)?.sections[sy];
  }

  getBlock(x: number, y: number, z: number): number {
    return this.blockIn(this.getColumn(toColumn(x), toColumn(z)), x, y, z);
  }

  /**
   * `getBlock` in a column already looked up (`getColumn(toColumn(x), toColumn(z))`, undefined
   * when unloaded): scans that read many cells of one column resolve it once, not per voxel.
   */
  blockIn(column: Column | undefined, x: number, y: number, z: number): number {
    if (y < 0) return this.outside;
    if (y >= WORLD_HEIGHT) return this.air;
    if (!column) return this.outside;
    const section = column.sections[y >> SECTION_BITS]!;
    return section.getBlock(localIndex(x & SECTION_MASK, y & SECTION_MASK, z & SECTION_MASK));
  }

  /** `getLight` in a column already looked up (see `blockIn`). */
  lightIn(column: Column | undefined, x: number, y: number, z: number): number {
    if (y >= WORLD_HEIGHT) return FULL_SKY;
    if (y < 0 || !column) return 0;
    return column.sections[y >> SECTION_BITS]!.getLight(
      localIndex(x & SECTION_MASK, y & SECTION_MASK, z & SECTION_MASK),
    );
  }

  /**
   * The heightmap at a block column (the y above its highest block), −1 when its column is not
   * loaded.
   */
  heightAt(x: number, z: number): number {
    const column = this.getColumn(toColumn(x), toColumn(z));
    return column ? column.heightmap[columnIndex(toLocal(x), toLocal(z))]! : -1;
  }

  /** The biome (index in the generation's biomes) at a block column, −1 when not loaded. */
  biomeAt(x: number, z: number): number {
    const column = this.getColumn(toColumn(x), toColumn(z));
    return column ? column.biomes[columnIndex(toLocal(x), toLocal(z))]! : -1;
  }

  /** Sets a block in a loaded (or newly created) column. Returns false outside the height range. */
  setBlock(x: number, y: number, z: number, state: number): boolean {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const column = this.ensureColumn(toColumn(x), toColumn(z));
    const section = column.sections[y >> SECTION_BITS]!;
    section.setBlock(localIndex(x & SECTION_MASK, y & SECTION_MASK, z & SECTION_MASK), state);
    return true;
  }

  /** Packed light (see light.ts). Above the world: full sky; unloaded: dark. */
  getLight(x: number, y: number, z: number): number {
    return this.lightIn(this.getColumn(toColumn(x), toColumn(z)), x, y, z);
  }

  setLight(x: number, y: number, z: number, value: number): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const column = this.getColumn(toColumn(x), toColumn(z));
    if (!column) return;
    column.sections[y >> SECTION_BITS]!.setLight(
      localIndex(x & SECTION_MASK, y & SECTION_MASK, z & SECTION_MASK),
      value,
    );
  }

  voxelBytes(): number {
    let total = 0;
    for (const column of this.columns.values()) total += column.byteSize();
    return total;
  }
}
