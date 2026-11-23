import type { RawTables } from '../../content/registry.ts';
import type { Column } from '../Column.ts';
import { ColumnSlots, SLOT_GRID, slotOf } from '../ColumnSlots.ts';
import { localIndex, SECTION_SIZE, toColumn, toLocal, WORLD_HEIGHT } from '../coords.ts';
import { BLOCK_SHIFT, blockOf, MAX_LIGHT, passLight, SKY_SHIFT, skyOf } from '../light.ts';
import type { Section } from '../Section.ts';
import { CELL_MASK, entryOf, LEVEL_SHIFT, LightQueue, slotOfEntry } from './LightQueue.ts';

/** Seam directions (bits of a column's seam mask): +x, −x, +z, −z; `d ^ 1` is the opposite. */
const SEAM_DX = [1, -1, 0, 0] as const;
const SEAM_DZ = [0, 0, 1, -1] as const;
/** Section-local index of the border cells on each side, and the step along the border. */
const SEAM_SIDE = [31, 0, 31 << 5, 0] as const;
const SEAM_STEP = [32, 32, 1, 1] as const;
const ALL_SEAMS = 15;

/** Box of changed cells in world block coordinates (empty while x1 < x0). */
export interface LightBox {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

/**
 * Light of the loaded columns (docs « Éclairage », sim side). Columns arrive with their own light
 * (columnLight) and sit in a 32×32 slot grid; queues hold encoded entries (LightQueue), so they
 * stay valid while the player moves.
 *
 * - Seams: when a column arrives, each border with a loaded face neighbour is compared and the
 *   cells that can light the other side feed the seam queues, drained under a node budget.
 * - Edits: `edited` takes the cell's light out; `flush` runs the removal pass (FIFO), then the
 *   re-add pass, to completion. Emitters and sky edges get their light back in the re-add pass.
 *
 * Every pass only raises a cell to what a neighbour justifies (or clears what may have come from
 * a removed cell), so the result is the unique fixed point whatever the order or the slicing.
 * The flood is the core of a hot loop: it walks a column by index arithmetic (cell ± 1, ± 32,
 * ± 1024) and resolves a neighbour column only when it crosses a border.
 */
export class LightEngine {
  private readonly filter: Uint8Array;
  private readonly emit: Uint8Array;
  private readonly slots = new ColumnSlots();
  /** Entries in flight per slot, across every queue. */
  private readonly pending = new Int32Array(SLOT_GRID * SLOT_GRID);
  /** Analysed seams of the column in each slot (bits by seam direction). */
  private readonly seams = new Uint8Array(SLOT_GRID * SLOT_GRID);
  private readonly removeSky: LightQueue;
  private readonly removeBlock: LightQueue;
  private readonly addSky: LightQueue;
  private readonly addBlock: LightQueue;
  private readonly seamSky: LightQueue;
  private readonly seamBlock: LightQueue;
  /** Light changed by the last `flush` (edits), for remeshing. */
  readonly changed: LightBox = { x0: 0, y0: 0, z0: 0, x1: -1, y1: -1, z1: -1 };
  private tracking = false;
  // The pass in progress: its channel, its queues and whether it removes light.
  private shift = SKY_SHIFT;
  private addQueue: LightQueue;
  private removeQueue: LightQueue;
  private removing = false;

  constructor(tables: RawTables) {
    this.filter = tables.lightFilter;
    this.emit = tables.emit;
    const queue = () => new LightQueue(this.pending);
    this.removeSky = queue();
    this.removeBlock = queue();
    this.addSky = queue();
    this.addBlock = queue();
    this.seamSky = queue();
    this.seamBlock = queue();
    this.addQueue = this.addSky;
    this.removeQueue = this.removeSky;
  }

  /** Whether the slot of column (cx, cz) is free (another column 32 columns away may hold it). */
  slotFree(cx: number, cz: number): boolean {
    return this.slots.at(slotOf(cx, cz)) === null;
  }

  /** Takes a column with its local light and compares its borders with the loaded neighbours. */
  addColumn(column: Column): void {
    this.slots.set(column);
    const slot = slotOf(column.cx, column.cz);
    this.seams[slot] = 0;
    for (let d = 0; d < 4; d++) {
      const next = this.slots.get(column.cx + SEAM_DX[d]!, column.cz + SEAM_DZ[d]!);
      if (next === null) continue;
      this.compareSeam(column, next, d);
      this.seams[slot] = this.seams[slot]! | (1 << d);
      const nextSlot = slotOf(next.cx, next.cz);
      this.seams[nextSlot] = this.seams[nextSlot]! | (1 << (d ^ 1));
    }
  }

  /** Forgets a column; its neighbours' seams with it are no longer analysed. */
  removeColumn(cx: number, cz: number): void {
    if (this.slots.get(cx, cz) === null) return;
    for (let d = 0; d < 4; d++) {
      const next = this.slots.get(cx + SEAM_DX[d]!, cz + SEAM_DZ[d]!);
      if (next === null) continue;
      const nextSlot = slotOf(next.cx, next.cz);
      this.seams[nextSlot] = this.seams[nextSlot]! & ~(1 << (d ^ 1));
    }
    this.slots.remove(cx, cz);
    this.seams[slotOf(cx, cz)] = 0;
  }

  /** All 4 borders of the column were compared with loaded neighbours. */
  stitched(cx: number, cz: number): boolean {
    return this.slots.get(cx, cz) !== null && this.seams[slotOf(cx, cz)] === ALL_SEAMS;
  }

  /** No light entry is waiting in the column or in its 8 neighbours. */
  settled(cx: number, cz: number): boolean {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++)
        if (this.pending[slotOf(cx + dx, cz + dz)] !== 0) return false;
    }
    return true;
  }

  /** Entries waiting in the seam queues. */
  seamBacklog(): number {
    return this.seamSky.size + this.seamBlock.size;
  }

  /** A voxel of a loaded column changed: its light is taken out now and spread again by `flush`. */
  edited(x: number, y: number, z: number): void {
    const column = this.slots.get(toColumn(x), toColumn(z));
    if (column === null || y < 0 || y >= WORLD_HEIGHT) return;
    const cell = localIndex(toLocal(x), y, toLocal(z));
    const section = column.sections[cell >> 15]!;
    const local = cell & 0x7fff;
    const packed = section.getLight(local);
    section.setLight(local, 0);
    const entry = entryOf(slotOf(column.cx, column.cz), cell);
    // Removing from level 0 still visits the neighbours: they light the cell back if it lets light in.
    this.removeSky.push((skyOf(packed) << LEVEL_SHIFT) | entry);
    this.removeBlock.push((blockOf(packed) << LEVEL_SHIFT) | entry);
    // The new state may emit.
    this.addBlock.push(entry);
  }

  /** Queues a cell of a loaded column to spread its light (columnLight's sky edges and emitters). */
  seed(column: Column, cell: number, shift: number): void {
    const entry = entryOf(slotOf(column.cx, column.cz), cell);
    (shift === SKY_SHIFT ? this.addSky : this.addBlock).push(entry);
  }

  /** Resolves the edits to completion (removal, then re-add); true when light changed (`changed`). */
  flush(): boolean {
    const box = this.changed;
    box.x0 = Number.POSITIVE_INFINITY;
    box.y0 = Number.POSITIVE_INFINITY;
    box.z0 = Number.POSITIVE_INFINITY;
    box.x1 = Number.NEGATIVE_INFINITY;
    box.y1 = Number.NEGATIVE_INFINITY;
    box.z1 = Number.NEGATIVE_INFINITY;
    this.tracking = true;
    this.unflood(this.removeSky, this.addSky, SKY_SHIFT);
    this.unflood(this.removeBlock, this.addBlock, BLOCK_SHIFT);
    this.flood(this.addSky, SKY_SHIFT, Number.POSITIVE_INFINITY);
    this.flood(this.addBlock, BLOCK_SHIFT, Number.POSITIVE_INFINITY);
    this.tracking = false;
    return box.x1 >= box.x0;
  }

  /** Spreads seam light for at most `budget` nodes; returns the nodes processed. */
  stitch(budget: number): number {
    const sky = this.flood(this.seamSky, SKY_SHIFT, budget);
    return sky + this.flood(this.seamBlock, BLOCK_SHIFT, budget - sky);
  }

  /** Compares the border of `a` facing direction `d` with `b`, its neighbour that way. */
  private compareSeam(a: Column, b: Column, d: number): void {
    const slotA = slotOf(a.cx, a.cz);
    const slotB = slotOf(b.cx, b.cz);
    const sideA = SEAM_SIDE[d]!;
    const sideB = SEAM_SIDE[d ^ 1]!;
    const step = SEAM_STEP[d]!;
    for (let sy = 0; sy < a.sections.length; sy++) {
      const sa = a.sections[sy]!;
      const sb = b.sections[sy]!;
      // Equal light on both sides everywhere: nothing can flow.
      if (sa.light === null && sb.light === null && sa.uniformLight === sb.uniformLight) continue;
      for (let ly = 0; ly < SECTION_SIZE; ly++) {
        for (let k = 0; k < SECTION_SIZE; k++) {
          const along = (ly << 10) + k * step;
          const ia = along + sideA;
          const ib = along + sideB;
          const la = sa.getLight(ia);
          const lb = sb.getLight(ib);
          if (la === lb) continue;
          const cellA = (sy << 15) | ia;
          const cellB = (sy << 15) | ib;
          this.comparePair(sa, ia, la, slotA, cellA, sb, ib, lb, slotB, cellB, SKY_SHIFT);
          this.comparePair(sa, ia, la, slotA, cellA, sb, ib, lb, slotB, cellB, BLOCK_SHIFT);
        }
      }
    }
  }

  /** Queues the side of a border pair that can light the other one (gap above 1 + filter). */
  private comparePair(
    sa: Section,
    ia: number,
    la: number,
    slotA: number,
    cellA: number,
    sb: Section,
    ib: number,
    lb: number,
    slotB: number,
    cellB: number,
    shift: number,
  ): void {
    const levelA = (la >> shift) & 15;
    const levelB = (lb >> shift) & 15;
    const queue = shift === SKY_SHIFT ? this.seamSky : this.seamBlock;
    if (levelA > levelB + 1) {
      if (passLight(levelA, this.filter[sb.getBlock(ib)]!, false) > levelB)
        queue.push(entryOf(slotA, cellA));
    } else if (levelB > levelA + 1) {
      if (passLight(levelB, this.filter[sa.getBlock(ia)]!, false) > levelA)
        queue.push(entryOf(slotB, cellB));
    }
  }

  /** Add pass: each entry spreads its current level to its neighbours, within `budget` entries. */
  private flood(queue: LightQueue, shift: number, budget: number): number {
    this.shift = shift;
    this.addQueue = queue;
    this.removing = false;
    let done = 0;
    while (done < budget && queue.size > 0) {
      const entry = queue.shift();
      done++;
      const column = this.slots.at(slotOfEntry(entry));
      if (column === null) continue;
      const cell = entry & CELL_MASK;
      const section = column.sections[cell >> 15]!;
      const local = cell & 0x7fff;
      const packed = section.getLight(local);
      let level = (packed >> shift) & 15;
      if (shift === BLOCK_SHIFT) {
        // An emitter darkened by a removal (or just placed) gets its own level back.
        const emit = this.emit[section.getBlock(local)]!;
        if (emit > level) {
          level = emit;
          this.write(column, section, local, cell, (packed & 0xf0) | emit);
        }
      }
      if (level > 1) this.neighbours(column, cell, level);
    }
    return done;
  }

  /** Removal pass, to completion: clears what each removed level may have lit. */
  private unflood(remove: LightQueue, add: LightQueue, shift: number): void {
    this.shift = shift;
    this.addQueue = add;
    this.removeQueue = remove;
    this.removing = true;
    while (remove.size > 0) {
      const entry = remove.shift();
      const column = this.slots.at(slotOfEntry(entry));
      if (column !== null) this.neighbours(column, entry & CELL_MASK, entry >>> LEVEL_SHIFT);
    }
  }

  /** Visits the 6 neighbours of a cell; only the x and z borders need another column. */
  private neighbours(column: Column, cell: number, level: number): void {
    const x = cell & 31;
    const z = (cell >> 5) & 31;
    const y = cell >> 10;
    if (x < 31) this.visit(column, cell + 1, level, false);
    else this.visitNext(column, 1, 0, cell - 31, level);
    if (x > 0) this.visit(column, cell - 1, level, false);
    else this.visitNext(column, -1, 0, cell + 31, level);
    if (z < 31) this.visit(column, cell + 32, level, false);
    else this.visitNext(column, 0, 1, cell - (31 << 5), level);
    if (z > 0) this.visit(column, cell - 32, level, false);
    else this.visitNext(column, 0, -1, cell + (31 << 5), level);
    if (y < WORLD_HEIGHT - 1) this.visit(column, cell + 1024, level, false);
    if (y > 0) this.visit(column, cell - 1024, level, true);
  }

  /** A neighbour in the next column; an unloaded one counts as opaque. */
  private visitNext(column: Column, dx: number, dz: number, cell: number, level: number): void {
    const next = this.slots.get(column.cx + dx, column.cz + dz);
    if (next !== null) this.visit(next, cell, level, false);
  }

  private visit(column: Column, cell: number, level: number, down: boolean): void {
    const section = column.sections[cell >> 15]!;
    const local = cell & 0x7fff;
    const packed = section.getLight(local);
    const shift = this.shift;
    const current = (packed >> shift) & 15;
    const skyDown = down && shift === SKY_SHIFT;
    if (!this.removing) {
      // Add: raise the neighbour to what this level gives it through its filter.
      const next = passLight(level, this.filter[section.getBlock(local)]!, skyDown);
      if (next <= current) return;
      this.write(column, section, local, cell, (packed & ~(15 << shift)) | (next << shift));
      this.addQueue.push(entryOf(slotOf(column.cx, column.cz), cell));
      return;
    }
    // Remove: a dimmer neighbour (or full sky right below full sky) may have been lit by the
    // removed level, so it is cleared too; a brighter one has its own source and lights the gap.
    if (current === 0) return;
    const entry = entryOf(slotOf(column.cx, column.cz), cell);
    if (current < level || (skyDown && level === MAX_LIGHT && current === MAX_LIGHT)) {
      this.write(column, section, local, cell, packed & ~(15 << shift));
      this.removeQueue.push((current << LEVEL_SHIFT) | entry);
      if (shift === BLOCK_SHIFT && this.emit[section.getBlock(local)]! > 0)
        this.addQueue.push(entry);
    } else {
      this.addQueue.push(entry);
    }
  }

  private write(
    column: Column,
    section: Section,
    local: number,
    cell: number,
    value: number,
  ): void {
    section.setLight(local, value);
    if (this.tracking) this.track(column, cell);
  }

  private track(column: Column, cell: number): void {
    const box = this.changed;
    const x = column.cx * SECTION_SIZE + (cell & 31);
    const y = cell >> 10;
    const z = column.cz * SECTION_SIZE + ((cell >> 5) & 31);
    if (x < box.x0) box.x0 = x;
    if (x > box.x1) box.x1 = x;
    if (y < box.y0) box.y0 = y;
    if (y > box.y1) box.y1 = y;
    if (z < box.z0) box.z0 = z;
    if (z > box.z1) box.z1 = z;
  }
}
