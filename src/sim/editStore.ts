import type { Column } from '../world/Column.ts';
import {
  columnKey,
  columnKeyX,
  columnKeyZ,
  insideBorder,
  SECTION_SIZE,
  SECTION_VOLUME,
  SECTIONS_PER_COLUMN,
} from '../world/coords.ts';
import type { SavedSection } from '../world/protocol.ts';

/** Saved sections of one column, as stored in a record. */
export interface SavedColumn {
  readonly cx: number;
  readonly cz: number;
  readonly sections: readonly SavedSection[];
}

/** Saved form of an edit store (structured-clone friendly: M7 writes it to IndexedDB). */
export interface EditStoreRecord {
  readonly columns: readonly SavedColumn[];
}

/**
 * Edited sections of the unloaded columns (docs « Streaming », « Sauvegarde »), owned by the
 * simulation: an unloading column leaves its persisted sections here, and its next generation
 * request carries copies of them, so generation lays them over the fresh terrain before it lights
 * the column. The entry goes once the column is loaded again, whose sections are then persisted.
 * In memory only until M7 saves it.
 */
export class EditStore {
  private readonly columns = new Map<number, readonly SavedSection[]>();

  get size(): number {
    return this.columns.size;
  }

  /** Keeps the persisted sections of an unloading column (takes its arrays: nothing writes them). */
  keep(key: number, column: Column): void {
    if (column.persisted === 0) return;
    const sections: SavedSection[] = [];
    for (let sy = 0; sy < SECTIONS_PER_COLUMN; sy++) {
      if ((column.persisted & (1 << sy)) === 0) continue;
      const section = column.sections[sy]!;
      sections.push({ sy, uniformBlock: section.uniformBlock, blocks: section.blocks });
    }
    this.columns.set(key, sections);
  }

  /** Sets the saved sections of a column (sorted by sy, owned by the store from now on). */
  put(key: number, sections: readonly SavedSection[]): void {
    this.columns.set(key, sections);
  }

  /** Copies of a column's saved sections for a generation request (which owns them), if any. */
  copies(key: number): SavedSection[] | undefined {
    return this.columns.get(key)?.map(copySection);
  }

  /** The column is loaded again: its own sections hold the edits from now on. */
  forget(key: number): void {
    this.columns.delete(key);
  }

  /** Saved sections of a column (read only). */
  get(key: number): readonly SavedSection[] | undefined {
    return this.columns.get(key);
  }

  /** Keys of the columns with saved sections, in insertion order. */
  keys(): Iterable<number> {
    return this.columns.keys();
  }
}

function copySection(s: SavedSection): SavedSection {
  return {
    sy: s.sy,
    uniformBlock: s.uniformBlock,
    blocks: s.blocks === null ? null : s.blocks.slice(),
  };
}

/** Copy for saving. */
export function serializeEditStore(store: EditStore): EditStoreRecord {
  const columns: SavedColumn[] = [];
  for (const key of store.keys())
    columns.push({ cx: columnKeyX(key), cz: columnKeyZ(key), sections: store.copies(key)! });
  return { columns };
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isWhole = (v: unknown, min: number, max: number): v is number =>
  isInt(v) && v >= min && v <= max;

/** Reads a saved store (empty by default); malformed columns and sections are dropped. */
export function deserializeEditStore(data: unknown): EditStore {
  const store = new EditStore();
  const columns = (data as Partial<EditStoreRecord> | null | undefined)?.columns;
  if (!Array.isArray(columns)) return store;
  for (const entry of columns as unknown[]) {
    const { cx, cz, sections } = (entry ?? {}) as Partial<SavedColumn>;
    if (!isInt(cx) || !isInt(cz) || !insideBorder(cx * SECTION_SIZE, cz * SECTION_SIZE)) continue;
    if (!Array.isArray(sections)) continue;
    const valid = readSections(sections as unknown[]);
    if (valid.length > 0) store.put(columnKey(cx, cz), valid);
  }
  return store;
}

/** Valid sections of a saved column (one per sy, sorted, arrays copied). */
function readSections(data: readonly unknown[]): SavedSection[] {
  const out: SavedSection[] = [];
  let seen = 0;
  for (const entry of data) {
    const { sy, uniformBlock, blocks } = (entry ?? {}) as Partial<SavedSection>;
    if (!isWhole(sy, 0, SECTIONS_PER_COLUMN - 1) || (seen & (1 << sy)) !== 0) continue;
    if (!isWhole(uniformBlock, 0, 0xffff)) continue;
    if (blocks !== null && !(blocks instanceof Uint16Array && blocks.length === SECTION_VOLUME))
      continue;
    seen |= 1 << sy;
    out.push(copySection({ sy, uniformBlock, blocks }));
  }
  return out.sort((a, b) => a.sy - b.sy);
}
