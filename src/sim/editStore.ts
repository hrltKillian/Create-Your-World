import { type Column, persistedSections } from '../world/Column.ts';
import type { SavedSection } from '../world/protocol.ts';

/**
 * Edited sections of the unloaded columns (docs « Streaming », « Sauvegarde »), owned by the
 * simulation: an unloading column leaves its persisted sections here, and its next generation
 * request carries copies of them, so generation lays them over the fresh terrain before it lights
 * the column. The entry goes once the column is loaded again, whose sections are then persisted.
 * Saves write these sections in their column records (persistence.ts), and loading a world puts
 * the saved ones back here.
 */
export class EditStore {
  private readonly columns = new Map<number, readonly SavedSection[]>();

  get size(): number {
    return this.columns.size;
  }

  /** Keeps the persisted sections of an unloading column (takes its arrays: nothing writes them). */
  keep(key: number, column: Column): void {
    if (column.persisted !== 0) this.columns.set(key, persistedSections(column));
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
