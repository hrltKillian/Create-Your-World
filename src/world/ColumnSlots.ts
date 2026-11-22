import type { Column } from './Column.ts';
import { columnKey } from './coords.ts';

/**
 * Loaded columns in a 32×32 ring grid indexed by (cx & 31, cz & 31). The loaded area is at most
 * 27 columns across, so two loaded columns never share a slot; the key is still checked on access.
 * Light queues store `slot << 18 | localIndex`, which stays valid while the player moves.
 */
export const SLOT_GRID = 32;

export function slotOf(cx: number, cz: number): number {
  return (cx & 31) | ((cz & 31) << 5);
}

export class ColumnSlots {
  private readonly columns: (Column | null)[] = new Array(SLOT_GRID * SLOT_GRID).fill(null);
  private readonly keys = new Float64Array(SLOT_GRID * SLOT_GRID).fill(Number.NaN);

  set(column: Column): void {
    const slot = slotOf(column.cx, column.cz);
    const key = columnKey(column.cx, column.cz);
    const current = this.keys[slot]!;
    if (!Number.isNaN(current) && current !== key) {
      throw new Error(`Slot ${slot} already holds another column`);
    }
    this.columns[slot] = column;
    this.keys[slot] = key;
  }

  remove(cx: number, cz: number): void {
    const slot = slotOf(cx, cz);
    if (this.keys[slot] === columnKey(cx, cz)) {
      this.columns[slot] = null;
      this.keys[slot] = Number.NaN;
    }
  }

  get(cx: number, cz: number): Column | null {
    const slot = slotOf(cx, cz);
    return this.keys[slot] === columnKey(cx, cz) ? this.columns[slot]! : null;
  }

  /** Column in a slot, whatever its coordinates (hot paths that already know the slot). */
  at(slot: number): Column | null {
    return this.columns[slot] ?? null;
  }
}
