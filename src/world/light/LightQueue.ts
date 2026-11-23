import { SLOT_GRID } from '../ColumnSlots.ts';

/**
 * Light queue entries: `slot << 18 | cell`, where `cell = x | z << 5 | y << 10` is a column-local
 * index (y 0–255, so `cell >> 15` is the section and `cell & 0x7fff` the index inside it) and the
 * slot is the column's `ColumnSlots` slot. Removal entries carry the level the cell had in bits
 * 28–31 (decoded with `>>>`, since levels ≥ 8 set the sign bit).
 */
export const CELL_BITS = 18;
export const CELL_MASK = (1 << CELL_BITS) - 1;
export const SLOT_MASK = SLOT_GRID * SLOT_GRID - 1;
export const LEVEL_SHIFT = 28;

export function entryOf(slot: number, cell: number): number {
  return (slot << CELL_BITS) | cell;
}

export function slotOfEntry(entry: number): number {
  return (entry >>> CELL_BITS) & SLOT_MASK;
}

/**
 * FIFO ring of light entries on an `Int32Array` that doubles when full. Every push and shift
 * updates the shared per-slot counters of entries in flight, which tell when a column's light is
 * settled.
 */
export class LightQueue {
  private ring: Int32Array;
  private head = 0;
  size = 0;
  private readonly pending: Int32Array;

  constructor(pending: Int32Array, capacity = 4096) {
    this.pending = pending;
    this.ring = new Int32Array(capacity);
  }

  push(entry: number): void {
    if (this.size === this.ring.length) this.grow();
    this.ring[(this.head + this.size) & (this.ring.length - 1)] = entry;
    this.size++;
    const slot = slotOfEntry(entry);
    this.pending[slot] = this.pending[slot]! + 1;
  }

  /** Takes the oldest entry; the queue must not be empty. */
  shift(): number {
    const entry = this.ring[this.head]!;
    this.head = (this.head + 1) & (this.ring.length - 1);
    this.size--;
    const slot = slotOfEntry(entry);
    this.pending[slot] = this.pending[slot]! - 1;
    return entry;
  }

  /** Doubles the ring, keeping the entries in order (capacities stay powers of two). */
  private grow(): void {
    const old = this.ring;
    const next = new Int32Array(old.length * 2);
    for (let i = 0; i < this.size; i++) next[i] = old[(this.head + i) & (old.length - 1)]!;
    this.ring = next;
    this.head = 0;
  }
}
