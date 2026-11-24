import type { SimEvent } from '../sim/events.ts';
import type { SimView } from '../sim/host.ts';
import {
  columnKey,
  columnKeyX,
  columnKeyZ,
  SECTION_SIZE,
  SECTIONS_PER_COLUMN,
  type SectionCoords,
  sectionKey,
  sectionKeyParts,
} from '../world/coords.ts';
import {
  createPadded,
  fillPadded,
  type PaddedFill,
  type PaddedVoxels,
} from '../world/mesh/padded.ts';
import type { JobPriority, JobRunner, MeshResult } from '../world/protocol.ts';
import type { ChunkMeshes } from './ChunkMeshes.ts';

type PendingSection = Readonly<SectionCoords>;

/** Where meshes go: the chunk meshes (a fake in tests). */
export type MeshSink = Pick<ChunkMeshes, 'update' | 'remove' | 'outdated'>;

export interface MeshBudgets {
  /** Mesh jobs in flight at once. */
  readonly maxInFlight: number;
  /** Padded copies made (and jobs sent) per frame. */
  readonly dispatchPerFrame: number;
  /** Results uploaded per frame, and the byte cap for them. */
  readonly uploadsPerFrame: number;
  readonly uploadBytesPerFrame: number;
}

/** Coordinates decoded from a section key. */
const at: SectionCoords = { cx: 0, sy: 0, cz: 0 };

export interface MeshStats {
  readonly pending: number;
  /** Edited sections waiting for an urgent job. */
  readonly urgent: number;
  readonly inFlight: number;
  readonly ready: number;
  readonly uploaded: number;
  readonly stale: number;
  /** Sections of the open edit batch (shown together once all are meshed). */
  readonly batch: number;
}

/**
 * An edit batch still incomplete after this long shows what it has (and keeps waiting for the
 * rest), so edits that keep coming can never hold every mesh back.
 */
const BATCH_MAX_MS = 250;

const DISPATCHED = 0;
const EMPTY = 1;
const GONE = 2;

/**
 * Client-side meshing: turns "column meshable" events into mesh jobs (nearest first), sends padded
 * copies to the workers and uploads finished meshes under a per-frame budget. Results computed from
 * outdated data are dropped and the section is queued again.
 *
 * Edits (blocksChanged) take the urgent path: their sections jump the queue as urgent worker jobs,
 * and join the open edit batch, whose meshes stay unshown until every section of the batch is
 * meshed, then all swap in the same frame. So an edit on a section border never shows a hole for
 * a frame, and old meshes stay until the new ones are uploaded. `editToMeshMs` is the time from
 * the first edit of a batch to that swap.
 */
export class MeshScheduler {
  private readonly view: SimView;
  private readonly runner: JobRunner;
  private readonly chunks: MeshSink;
  private readonly fill: PaddedFill;
  private readonly pending = new Map<number, PendingSection>();
  private readonly urgent = new Map<number, PendingSection>();
  private readonly inFlight = new Map<number, number>();
  private readonly ready: MeshResult[] = [];
  private readonly freePadded: PaddedVoxels[] = [];
  /** Columns currently shown (meshable and within the render distance). */
  private readonly shown = new Set<number>();
  /** Sections of the open edit batch, and the finished meshes held for it (null: now empty). */
  private readonly batch = new Set<number>();
  private readonly held = new Map<number, MeshResult | null>();
  private batchStart = -1;
  /** Section version each displayed mesh was built from (empty sections included). */
  private readonly shownVersion = new Map<number, number>();
  private uploaded = 0;
  private stale = 0;
  /** Milliseconds from the first blocksChanged of the last batch to the upload of its meshes. */
  editToMeshMs = 0;
  /** Wall time of the last `update`'s uploads (ms; the frame's `upload` span). */
  uploadMs = 0;
  /** Meshes are built for the `xray` debug view. */
  private xray = false;

  private readonly dispatchUrgent = (s: PendingSection, key: number): void => {
    // In flight: its result is outdated and dropped; the section goes again once it is back.
    if (this.inFlight.has(key)) return;
    this.urgent.delete(key);
    const status = this.dispatch(key, s, 'urgent');
    if (status === EMPTY && this.batch.has(key)) this.held.set(key, null);
    else if (status === GONE) this.leaveBatch(key);
  };

  /** Scan state of `nearest` (a bound callback, so the scan allocates nothing). */
  private nearX = 0;
  private nearY = 0;
  private nearZ = 0;
  private nearKey = -1;
  private nearD = 0;
  private readonly considerNearest = (s: PendingSection, key: number): void => {
    if (this.inFlight.has(key)) return;
    const dx = s.cx * 32 + 16 - this.nearX;
    const dy = s.sy * 32 + 16 - this.nearY;
    const dz = s.cz * 32 + 16 - this.nearZ;
    const d = dx * dx + dy * dy * 0.5 + dz * dz;
    if (d < this.nearD) {
      this.nearD = d;
      this.nearKey = key;
    }
  };

  private readonly showHeld = (result: MeshResult | null, key: number): void => {
    this.batch.delete(key);
    if (result) this.show(result);
    else {
      this.chunks.remove(key);
      const { cx, sy, cz } = sectionKeyParts(key, at);
      const section = this.view.world.getSection(cx, sy, cz);
      if (section) this.shownVersion.set(key, section.version);
    }
  };

  constructor(view: SimView, runner: JobRunner, chunks: MeshSink, fill: PaddedFill) {
    this.view = view;
    this.runner = runner;
    this.chunks = chunks;
    this.fill = fill;
  }

  onEvent(event: SimEvent): void {
    if (event.type === 'columnMeshable') {
      this.shown.add(columnKey(event.cx, event.cz));
      for (let sy = 0; sy < SECTIONS_PER_COLUMN; sy++) this.queue(event.cx, sy, event.cz);
    } else if (event.type === 'blocksChanged') {
      this.queueEdit(event.x0, event.y0, event.z0, event.x1, event.y1, event.z1);
    } else if (event.type === 'columnUnloaded' || event.type === 'columnHidden') {
      this.shown.delete(columnKey(event.cx, event.cz));
      for (let sy = 0; sy < SECTIONS_PER_COLUMN; sy++) {
        const key = sectionKey(event.cx, sy, event.cz);
        this.pending.delete(key);
        this.urgent.delete(key);
        this.leaveBatch(key);
        this.shownVersion.delete(key);
        this.chunks.remove(key);
      }
    }
  }

  /** Puts the shown sections touching a block box grown by one (neighbour faces, AO) in the batch. */
  private queueEdit(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const sy0 = Math.max(0, (y0 - 1) >> 5);
    const sy1 = Math.min(SECTIONS_PER_COLUMN - 1, (y1 + 1) >> 5);
    for (let cx = (x0 - 1) >> 5; cx <= (x1 + 1) >> 5; cx++) {
      for (let cz = (z0 - 1) >> 5; cz <= (z1 + 1) >> 5; cz++) {
        if (!this.shown.has(columnKey(cx, cz))) continue;
        for (let sy = sy0; sy <= sy1; sy++) this.edited(cx, sy, cz);
      }
    }
  }

  /** An edited section: urgent, in the open batch, and any mesh held for it is outdated. */
  private edited(cx: number, sy: number, cz: number): void {
    const key = sectionKey(cx, sy, cz);
    // Cave culling: a section whose mesh is pending counts as fully connected.
    this.chunks.outdated(key);
    this.pending.delete(key);
    this.urgent.set(key, { cx, sy, cz });
    this.batch.add(key);
    this.held.delete(key);
    if (this.batchStart < 0) this.batchStart = performance.now();
  }

  private leaveBatch(key: number): void {
    this.batch.delete(key);
    this.held.delete(key);
  }

  /** Queues a section for (re)meshing (a section of the open batch is re-meshed urgently). */
  queue(cx: number, sy: number, cz: number): void {
    const key = sectionKey(cx, sy, cz);
    if (this.batch.has(key)) this.edited(cx, sy, cz);
    else {
      this.chunks.outdated(key);
      this.pending.set(key, { cx, sy, cz });
    }
  }

  /**
   * Switches the `xray` debug view on or off: every shown section is meshed again (results of the
   * other mode still in flight are outdated by the queued job and dropped).
   */
  setXray(on: boolean): void {
    if (on === this.xray) return;
    this.xray = on;
    for (const key of this.shown) {
      const cx = columnKeyX(key);
      const cz = columnKeyZ(key);
      for (let sy = 0; sy < SECTIONS_PER_COLUMN; sy++) this.queue(cx, sy, cz);
    }
  }

  /** Dispatches jobs (edits first, then the nearest to the camera) and uploads finished meshes. */
  update(cameraX: number, cameraY: number, cameraZ: number, budgets: MeshBudgets): void {
    // Results first: an outdated one frees its section for the urgent job in this same frame.
    const t0 = performance.now();
    this.upload(budgets);
    this.uploadMs = performance.now() - t0;
    if (this.urgent.size > 0) this.urgent.forEach(this.dispatchUrgent);
    this.commitBatch();
    // Every popped section counts, empty ones included, so a frame never scans without bound.
    let popped = 0;
    while (
      popped < budgets.dispatchPerFrame &&
      this.inFlight.size < budgets.maxInFlight &&
      this.pending.size > 0
    ) {
      const key = this.nearest(cameraX, cameraY, cameraZ);
      if (key < 0) break;
      const section = this.pending.get(key)!;
      this.pending.delete(key);
      this.dispatch(key, section, 'normal');
      popped++;
    }
  }

  stats(): MeshStats {
    return {
      pending: this.pending.size,
      urgent: this.urgent.size,
      inFlight: this.inFlight.size,
      ready: this.ready.length,
      uploaded: this.uploaded,
      stale: this.stale,
      batch: this.batch.size,
    };
  }

  /**
   * Sections whose mesh on screen was built from older data than the section now holds (an edit
   * not yet swapped in). 0 once every edit is visible.
   */
  sectionVersionLag(): number {
    let lag = 0;
    for (const [key, version] of this.shownVersion) {
      const { cx, sy, cz } = sectionKeyParts(key, at);
      const section = this.view.world.getSection(cx, sy, cz);
      if (section && section.version !== version) lag++;
    }
    return lag;
  }

  /** True while a section is waiting, being meshed, waiting for upload or held for a batch. */
  busy(key: number): boolean {
    if (this.pending.has(key) || this.urgent.has(key) || this.inFlight.has(key)) return true;
    if (this.batch.has(key)) return true;
    return this.ready.some((r) => r.key === key);
  }

  /** True when nothing is waiting, in flight, ready to upload or held for a batch. */
  idle(): boolean {
    return (
      this.pending.size === 0 &&
      this.urgent.size === 0 &&
      this.inFlight.size === 0 &&
      this.ready.length === 0 &&
      this.batch.size === 0
    );
  }

  /** Key of the pending section nearest to the camera, not already in flight (−1 when none). */
  private nearest(x: number, y: number, z: number): number {
    this.nearX = x;
    this.nearY = y;
    this.nearZ = z;
    this.nearKey = -1;
    this.nearD = Number.POSITIVE_INFINITY;
    this.pending.forEach(this.considerNearest);
    return this.nearKey;
  }

  /** All 8 neighbour columns must be loaded, or the padded border would be wrong. */
  private neighboursLoaded(cx: number, cz: number): boolean {
    const world = this.view.world;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) if (!world.getColumn(cx + dx, cz + dz)) return false;
    }
    return true;
  }

  /** Sends a mesh job; an empty section has nothing to mesh (shown at once outside a batch). */
  private dispatch(key: number, s: PendingSection, priority: JobPriority): number {
    const world = this.view.world;
    const section = world.getSection(s.cx, s.sy, s.cz);
    // Gone or no longer complete: the simulation emits columnMeshable again when it is.
    if (!section || !this.neighboursLoaded(s.cx, s.cz)) return GONE;
    if (section.isEmpty(this.fill.air)) {
      // No mesh and no mask: an empty section counts as fully connected (ALL_CONNECTED).
      if (!this.batch.has(key)) {
        this.chunks.remove(key);
        this.shownVersion.set(key, section.version);
      }
      return EMPTY;
    }
    const padded = this.freePadded.pop() ?? createPadded();
    fillPadded(world, s.cx, s.sy, s.cz, this.fill, padded);
    section.compact();
    const version = section.version;
    this.inFlight.set(key, version);
    this.runner
      .run(
        {
          kind: 'mesh',
          key,
          version,
          ids: padded.ids,
          light: padded.light,
          biomes: padded.biomes,
          xray: this.xray,
        },
        priority,
      )
      .then(
        (result) => this.ready.push(result),
        () => {
          // Worker restarted: try again later.
          this.inFlight.delete(key);
          this.queue(s.cx, s.sy, s.cz);
        },
      );
    return DISPATCHED;
  }

  /**
   * Takes the finished meshes: batch sections are held whatever the budget, others are uploaded
   * within it (the rest wait in `ready`, compacted in place).
   */
  private upload(budgets: MeshBudgets): void {
    let count = 0;
    let bytes = 0;
    let kept = 0;
    for (let i = 0; i < this.ready.length; i++) {
      const result = this.ready[i]!;
      const inBatch = this.batch.has(result.key);
      if (!inBatch && (count >= budgets.uploadsPerFrame || bytes >= budgets.uploadBytesPerFrame)) {
        this.ready[kept++] = result;
        continue;
      }
      if (!this.accept(result)) continue;
      if (this.batch.has(result.key)) this.held.set(result.key, result);
      else {
        this.show(result);
        count++;
        for (const pass of result.passes) bytes += pass.data.byteLength;
      }
    }
    this.ready.length = kept;
  }

  /** Whether a finished mesh is still current; outdated ones are dropped (and queued again). */
  private accept(result: MeshResult): boolean {
    const key = result.key;
    if (this.freePadded.length < 16) this.freePadded.push(result.padded);
    this.inFlight.delete(key);
    const { cx, sy, cz } = sectionKeyParts(key, at);
    const section = this.view.world.getSection(cx, sy, cz);
    // Unloaded or hidden meanwhile: columnMeshable queues it again if it comes back into view.
    if (!section || !this.shown.has(columnKey(cx, cz))) {
      this.leaveBatch(key);
      return false;
    }
    // A newer job is queued (the data changed after this copy was made).
    if (this.urgent.has(key) || this.pending.has(key)) {
      this.stale++;
      return false;
    }
    if (section.version !== result.version) {
      this.stale++;
      this.queue(cx, sy, cz);
      return false;
    }
    return true;
  }

  private show(result: MeshResult): void {
    const { cx, sy, cz } = sectionKeyParts(result.key, at);
    this.chunks.update(result.key, cx * SECTION_SIZE, sy * SECTION_SIZE, cz * SECTION_SIZE, result);
    this.shownVersion.set(result.key, result.version);
    this.uploaded++;
  }

  /** Swaps in every mesh of the open batch once all are held (or it is too old), in one frame. */
  private commitBatch(): void {
    if (this.batch.size === 0) {
      this.batchStart = -1;
      return;
    }
    const now = performance.now();
    if (this.held.size < this.batch.size && now - this.batchStart < BATCH_MAX_MS) return;
    this.held.forEach(this.showHeld);
    this.held.clear();
    this.editToMeshMs = now - this.batchStart;
    this.batchStart = this.batch.size > 0 ? now : -1;
  }
}
