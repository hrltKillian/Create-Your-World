import { Column } from './Column.ts';
import {
  columnKey,
  localIndex,
  SECTION_BITS,
  SECTION_MASK,
  SECTIONS_PER_COLUMN,
  toColumn,
  WORLD_HEIGHT,
} from './coords.ts';
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

  getSection(cx: number, sy: number, cz: number): Section | undefined {
    if (sy < 0 || sy >= SECTIONS_PER_COLUMN) return undefined;
    return this.getColumn(cx, cz)?.sections[sy];
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0) return this.outside;
    if (y >= WORLD_HEIGHT) return this.air;
    const column = this.getColumn(toColumn(x), toColumn(z));
    if (!column) return this.outside;
    const section = column.sections[y >> SECTION_BITS]!;
    return section.getBlock(localIndex(x & SECTION_MASK, y & SECTION_MASK, z & SECTION_MASK));
  }

  /** Sets a block in a loaded (or newly created) column. Returns false outside the height range. */
  setBlock(x: number, y: number, z: number, state: number): boolean {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const column = this.ensureColumn(toColumn(x), toColumn(z));
    const section = column.sections[y >> SECTION_BITS]!;
    section.setBlock(localIndex(x & SECTION_MASK, y & SECTION_MASK, z & SECTION_MASK), state);
    return true;
  }

  /** Packed light (sky << 4 | block). Above the world: full sky; unloaded: dark. */
  getLight(x: number, y: number, z: number): number {
    if (y >= WORLD_HEIGHT) return 0xf0;
    if (y < 0) return 0;
    const column = this.getColumn(toColumn(x), toColumn(z));
    if (!column) return 0;
    return column.sections[y >> SECTION_BITS]!.getLight(
      localIndex(x & SECTION_MASK, y & SECTION_MASK, z & SECTION_MASK),
    );
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
