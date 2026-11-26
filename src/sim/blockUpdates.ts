import { blockToColumn, cellKey, columnKey, WORLD_HEIGHT } from '../world/coords.ts';
import { BY_WORLD, removeWhole } from './blockRemoval.ts';
import { ripenCrop } from './crops.ts';
import type { SimEvent } from './events.ts';
import { checkSoil } from './farmland.ts';
import { checkDecay, decayDelay, decayTables } from './leafDecay.ts';
import { noteLiquids, updateLiquid } from './liquids.ts';
import { otherHalfY, supportHolds } from './placement.ts';
import type { Simulation } from './Simulation.ts';
import { simulated } from './stations.ts';

/*
 * Block updates (docs « Ordre d'un tick », step 10): checks scheduled on a cell for a tick, run in
 * the order they are due (then the order they were scheduled), at most BLOCK_UPDATES.perTick a
 * tick; the rest stay due and run first on the next ticks. Kinds:
 * - SUPPORT: a block whose support rule no longer holds pops off, harvested (placement.ts
 *   `supportHolds`); scheduled for the neighbours of a removed block, due at once;
 * - DECAY: a decaying block (leaves) that reaches no anchor falls apart (leafDecay.ts); scheduled
 *   with a delay when an anchor or a neighbouring decaying block goes;
 * - LIQUID: a flowing liquid takes its level and spreads (liquids.ts); scheduled for the liquids
 *   beside a changed cell, after the liquid's delay;
 * - GROW: a bare crop ripens (crops.ts); scheduled when it is planted or picked;
 * - SOIL: a farmland waters, dries or turns back into dirt (farmland.ts); scheduled when it is
 *   tilled, then again after each check.
 * An update runs only where the world is simulated (its column lit and near a player); elsewhere
 * it waits with its column and comes back when a player does. The queue is saved with the world.
 */

export const UPDATE_SUPPORT = 0;
export const UPDATE_DECAY = 1;
export const UPDATE_LIQUID = 2;
export const UPDATE_GROW = 3;
export const UPDATE_SOIL = 4;
export const UPDATE_KINDS = 5;

export const BLOCK_UPDATES = {
  /** Updates run per tick at most (docs: « au plus 256 »). */
  perTick: 256,
} as const;

/**
 * A min-heap of updates on parallel arrays (no allocation once grown), ordered by due tick, then
 * by the order they were scheduled; each cell and kind keeps its earliest due tick only (later
 * copies are skipped when popped).
 */
export class BlockUpdateQueue {
  private due = new Float64Array(64);
  private seq = new Float64Array(64);
  private cells = new Int32Array(64 * 4);
  private count = 0;
  private nextSeq = 0;
  /** Cell and kind → the due tick that counts (`cellKey × UPDATE_KINDS + kind`). */
  private readonly pending = new Map<number, number>();
  /** Updates due in columns not simulated, by column key: x, y, z, kind, due (flat). */
  private readonly waiting = new Map<number, number[]>();

  get size(): number {
    return this.pending.size;
  }

  /** Schedules an update of a cell for a tick (kept when the cell already has an earlier one). */
  schedule(x: number, y: number, z: number, kind: number, due: number): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const key = cellKey(x, y, z) * UPDATE_KINDS + kind;
    const known = this.pending.get(key);
    if (known !== undefined && known <= due) return;
    this.pending.set(key, due);
    this.push(x, y, z, kind, due);
  }

  /**
   * Pops the next update due by `tick` into `out` (x, y, z, kind, due); false when none is due.
   * Copies superseded by an earlier schedule are skipped.
   */
  pop(tick: number, out: number[]): boolean {
    while (this.count > 0 && this.due[0]! <= tick) {
      const due = this.due[0]!;
      const x = this.cells[0]!;
      const y = this.cells[1]!;
      const z = this.cells[2]!;
      const kind = this.cells[3]!;
      this.removeTop();
      const key = cellKey(x, y, z) * UPDATE_KINDS + kind;
      if (this.pending.get(key) !== due) continue;
      this.pending.delete(key);
      out[0] = x;
      out[1] = y;
      out[2] = z;
      out[3] = kind;
      out[4] = due;
      return true;
    }
    return false;
  }

  /** Puts an update aside with its column until `wake` brings the column back. */
  wait(x: number, y: number, z: number, kind: number, due: number): void {
    const key = columnKey(blockToColumn(x), blockToColumn(z));
    let list = this.waiting.get(key);
    if (!list) {
      list = [];
      this.waiting.set(key, list);
    }
    list.push(x, y, z, kind, due);
  }

  /** Schedules again the waiting updates of the columns `active` says are simulated now. */
  wake(active: (columnKey: number) => boolean): void {
    if (this.waiting.size === 0) return;
    for (const [key, list] of this.waiting) {
      if (!active(key)) continue;
      this.waiting.delete(key);
      for (let i = 0; i < list.length; i += 5)
        this.schedule(list[i]!, list[i + 1]!, list[i + 2]!, list[i + 3]!, list[i + 4]!);
    }
  }

  /**
   * Every update, queued or waiting, as x, y, z, kind and ticks left after `tick` (flat, in a
   * canonical order): what a save keeps and what the state hash reads.
   */
  serialize(tick: number): number[] {
    const rows: number[][] = [];
    for (let i = 0; i < this.count; i++) {
      const x = this.cells[i * 4]!;
      const y = this.cells[i * 4 + 1]!;
      const z = this.cells[i * 4 + 2]!;
      const kind = this.cells[i * 4 + 3]!;
      const due = this.due[i]!;
      if (this.pending.get(cellKey(x, y, z) * UPDATE_KINDS + kind) === due)
        rows.push([x, y, z, kind, Math.max(0, due - tick)]);
    }
    for (const list of this.waiting.values())
      for (let i = 0; i < list.length; i += 5)
        rows.push([
          list[i]!,
          list[i + 1]!,
          list[i + 2]!,
          list[i + 3]!,
          Math.max(0, list[i + 4]! - tick),
        ]);
    rows.sort(
      (a, b) => a[4]! - b[4]! || a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]! || a[3]! - b[3]!,
    );
    return rows.flat();
  }

  /** Schedules the updates of `serialize` again, relative to `tick` (malformed rows skipped). */
  restore(data: readonly number[], tick: number): void {
    for (let i = 0; i + 4 < data.length; i += 5) {
      const [x, y, z, kind, left] = [
        data[i]!,
        data[i + 1]!,
        data[i + 2]!,
        data[i + 3]!,
        data[i + 4]!,
      ];
      const whole = [x, y, z, kind, left].every(Number.isSafeInteger);
      if (whole && kind >= 0 && kind < UPDATE_KINDS && left >= 0)
        this.schedule(x, y, z, kind, tick + left);
    }
  }

  private push(x: number, y: number, z: number, kind: number, due: number): void {
    if (this.count === this.due.length) this.grow();
    let i = this.count++;
    const seq = this.nextSeq++;
    // Sift up.
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(due, seq, parent)) break;
      this.copy(parent, i);
      i = parent;
    }
    this.set(i, x, y, z, kind, due, seq);
  }

  private removeTop(): void {
    const last = --this.count;
    if (last === 0) return;
    const x = this.cells[last * 4]!;
    const y = this.cells[last * 4 + 1]!;
    const z = this.cells[last * 4 + 2]!;
    const kind = this.cells[last * 4 + 3]!;
    const due = this.due[last]!;
    const seq = this.seq[last]!;
    // Sift the last entry down from the root.
    let i = 0;
    for (;;) {
      let child = i * 2 + 1;
      if (child >= last) break;
      if (child + 1 < last && this.beforeAt(child + 1, child)) child++;
      if (!this.before(this.due[child]!, this.seq[child]!, -1, due, seq)) break;
      this.copy(child, i);
      i = child;
    }
    this.set(i, x, y, z, kind, due, seq);
  }

  /** Whether (due, seq) comes before entry `j` (or before (due2, seq2) when j is −1). */
  private before(due: number, seq: number, j: number, due2?: number, seq2?: number): boolean {
    const d = j >= 0 ? this.due[j]! : due2!;
    const s = j >= 0 ? this.seq[j]! : seq2!;
    return due < d || (due === d && seq < s);
  }

  private beforeAt(i: number, j: number): boolean {
    return this.before(this.due[i]!, this.seq[i]!, j);
  }

  private copy(from: number, to: number): void {
    this.due[to] = this.due[from]!;
    this.seq[to] = this.seq[from]!;
    for (let k = 0; k < 4; k++) this.cells[to * 4 + k] = this.cells[from * 4 + k]!;
  }

  private set(i: number, x: number, y: number, z: number, kind: number, due: number, seq: number) {
    this.due[i] = due;
    this.seq[i] = seq;
    this.cells[i * 4] = x;
    this.cells[i * 4 + 1] = y;
    this.cells[i * 4 + 2] = z;
    this.cells[i * 4 + 3] = kind;
  }

  private grow(): void {
    const size = this.due.length * 2;
    const due = new Float64Array(size);
    due.set(this.due);
    const seq = new Float64Array(size);
    seq.set(this.seq);
    const cells = new Int32Array(size * 4);
    cells.set(this.cells);
    this.due = due;
    this.seq = seq;
    this.cells = cells;
  }
}

/** Offsets of the 6 neighbours, as x, y, z triples. */
const SIDES = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];

/**
 * A block was removed from a cell (`state`: what it held): its neighbours check their support at
 * once; when it anchored decaying blocks or decayed itself, the decaying blocks around check
 * theirs after a delay.
 */
export function noteRemoved(sim: Simulation, x: number, y: number, z: number, state: number): void {
  noteChanged(sim, x, y, z);
  const decay = decayTables(sim.registry);
  const block = sim.registry.tables.blockOf[state]!;
  if (decay.anchor[block]) {
    const r = decay.maxRadius;
    for (let dy = -r; dy <= r; dy++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) scheduleDecay(sim, x + dx, y + dy, z + dz);
  } else if (decay.decays[block]) {
    for (let i = 0; i < 18; i += 3)
      scheduleDecay(sim, x + SIDES[i]!, y + SIDES[i + 1]!, z + SIDES[i + 2]!);
  }
}

/**
 * A cell changed (removed, placed, a gate toggled): its neighbours check their support at once, and
 * the liquids in and around it flow after their delay.
 */
export function noteChanged(sim: Simulation, x: number, y: number, z: number): void {
  const queue = sim.blockUpdates;
  for (let i = 0; i < 18; i += 3)
    queue.schedule(x + SIDES[i]!, y + SIDES[i + 1]!, z + SIDES[i + 2]!, UPDATE_SUPPORT, sim.tick);
  noteLiquids(sim, x, y, z);
}

/** Schedules the decay check of a cell holding a decaying block, after its pseudo-random delay. */
function scheduleDecay(sim: Simulation, x: number, y: number, z: number): void {
  if (y < 0 || y >= WORLD_HEIGHT) return;
  const state = sim.world.getBlock(x, y, z);
  if (!decayTables(sim.registry).decays[sim.registry.tables.blockOf[state]!]) return;
  sim.blockUpdates.schedule(x, y, z, UPDATE_DECAY, sim.tick + decayDelay(sim, x, y, z, state));
}

/** Scratch of a popped update: x, y, z, kind, due. */
const popped = [0, 0, 0, 0, 0];

/** Tick step 10: runs the updates due, at most BLOCK_UPDATES.perTick. */
export function stepBlockUpdates(sim: Simulation, out: SimEvent[]): void {
  const queue = sim.blockUpdates;
  queue.wake((key) => columnSimulated(sim, key));
  for (let done = 0; done < BLOCK_UPDATES.perTick && queue.pop(sim.tick, popped); ) {
    const [x, y, z, kind, due] = popped as [number, number, number, number, number];
    if (!columnSimulated(sim, columnKey(blockToColumn(x), blockToColumn(z)))) {
      queue.wait(x, y, z, kind, due);
      continue;
    }
    done++;
    if (kind === UPDATE_SUPPORT) checkSupport(sim, x, y, z, out);
    else if (kind === UPDATE_LIQUID) updateLiquid(sim, x, y, z, out);
    else if (kind === UPDATE_GROW) ripenCrop(sim, x, y, z, out);
    else if (kind === UPDATE_SOIL) checkSoil(sim, x, y, z, out);
    else if (checkDecay(sim, x, y, z)) removeWhole(sim, BY_WORLD, x, y, z, true, out);
  }
}

/**
 * A block whose support no longer holds pops off, with its drops. A tall block (door) stands on
 * its lower half: the upper half holds while the lower one is there.
 */
function checkSupport(sim: Simulation, x: number, y: number, z: number, out: SimEvent[]): void {
  const world = sim.world;
  if (world.getBlock(x, y, z) === sim.registry.air) return;
  const bottom = Math.min(y, otherHalfY(world, sim.registry, x, y, z));
  if (!supportHolds(world, sim.registry, x, bottom, z, world.getBlock(x, bottom, z)))
    removeWhole(sim, BY_WORLD, x, y, z, true, out);
}

/** Whether a column (by key) is loaded, lit and within the simulation radius of a player. */
function columnSimulated(sim: Simulation, key: number): boolean {
  const column = sim.world.columns.get(key);
  return column !== undefined && simulated(sim, column.cx, column.cz);
}
