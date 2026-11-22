import type { SimEvent } from '../sim/events.ts';
import type { SimView } from '../sim/host.ts';
import { columnKeyX, columnKeyZ, SECTIONS_PER_COLUMN, sectionKey } from '../world/coords.ts';
import {
  createPadded,
  fillPadded,
  type PaddedFill,
  type PaddedVoxels,
} from '../world/mesh/padded.ts';
import type { JobRunner, MeshResult } from '../world/protocol.ts';
import type { ChunkMeshes } from './ChunkMeshes.ts';

interface PendingSection {
  readonly cx: number;
  readonly sy: number;
  readonly cz: number;
}

export interface MeshBudgets {
  /** Mesh jobs in flight at once. */
  readonly maxInFlight: number;
  /** Padded copies made (and jobs sent) per frame. */
  readonly dispatchPerFrame: number;
  /** Results uploaded per frame, and the byte cap for them. */
  readonly uploadsPerFrame: number;
  readonly uploadBytesPerFrame: number;
}

export interface MeshStats {
  readonly pending: number;
  readonly inFlight: number;
  readonly ready: number;
  readonly uploaded: number;
  readonly stale: number;
}

/**
 * Client-side meshing: turns "column meshable" events into mesh jobs (nearest first), sends padded
 * copies to the workers and uploads finished meshes under a per-frame budget. Results computed from
 * an outdated section version are dropped and the section is queued again.
 */
export class MeshScheduler {
  private readonly view: SimView;
  private readonly runner: JobRunner;
  private readonly chunks: ChunkMeshes;
  private readonly fill: PaddedFill;
  private readonly pending = new Map<number, PendingSection>();
  private readonly inFlight = new Map<number, number>();
  private readonly ready: MeshResult[] = [];
  private readonly freePadded: PaddedVoxels[] = [];
  private uploaded = 0;
  private stale = 0;

  constructor(view: SimView, runner: JobRunner, chunks: ChunkMeshes, fill: PaddedFill) {
    this.view = view;
    this.runner = runner;
    this.chunks = chunks;
    this.fill = fill;
  }

  onEvent(event: SimEvent): void {
    if (event.type === 'columnMeshable') {
      for (let sy = 0; sy < SECTIONS_PER_COLUMN; sy++) this.queue(event.cx, sy, event.cz);
    } else if (event.type === 'columnUnloaded' || event.type === 'columnHidden') {
      for (let sy = 0; sy < SECTIONS_PER_COLUMN; sy++) {
        const key = sectionKey(event.cx, sy, event.cz);
        this.pending.delete(key);
        this.chunks.remove(key);
      }
    }
  }

  /** Queues a section for (re)meshing. */
  queue(cx: number, sy: number, cz: number): void {
    this.pending.set(sectionKey(cx, sy, cz), { cx, sy, cz });
  }

  /** Dispatches jobs (nearest to the camera first) and uploads finished meshes. */
  update(cameraX: number, cameraY: number, cameraZ: number, budgets: MeshBudgets): void {
    this.upload(budgets);
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
      this.dispatch(key, section);
      popped++;
    }
  }

  stats(): MeshStats {
    return {
      pending: this.pending.size,
      inFlight: this.inFlight.size,
      ready: this.ready.length,
      uploaded: this.uploaded,
      stale: this.stale,
    };
  }

  /** True while a section is waiting, being meshed or waiting for upload. */
  busy(key: number): boolean {
    if (this.pending.has(key) || this.inFlight.has(key)) return true;
    return this.ready.some((r) => r.key === key);
  }

  /** True when nothing is waiting, in flight or ready to upload. */
  idle(): boolean {
    return this.pending.size === 0 && this.inFlight.size === 0 && this.ready.length === 0;
  }

  /** Key of the pending section nearest to the camera (−1 when empty). */
  private nearest(x: number, y: number, z: number): number {
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    this.pending.forEach((s, key) => {
      const dx = s.cx * 32 + 16 - x;
      const dy = s.sy * 32 + 16 - y;
      const dz = s.cz * 32 + 16 - z;
      const d = dx * dx + dy * dy * 0.5 + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = key;
      }
    });
    return best;
  }

  /** All 8 neighbour columns must be loaded, or the padded border would be wrong. */
  private neighboursLoaded(cx: number, cz: number): boolean {
    const world = this.view.world;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) if (!world.getColumn(cx + dx, cz + dz)) return false;
    }
    return true;
  }

  private dispatch(key: number, s: PendingSection): boolean {
    const world = this.view.world;
    const section = world.getSection(s.cx, s.sy, s.cz);
    // Gone or no longer complete: the simulation emits columnMeshable again when it is.
    if (!section || !this.neighboursLoaded(s.cx, s.cz)) return false;
    if (section.isEmpty(this.fill.air)) {
      this.chunks.remove(key);
      return false;
    }
    const padded = this.freePadded.pop() ?? createPadded();
    fillPadded(world, s.cx, s.sy, s.cz, this.fill, padded);
    section.compact();
    const version = section.version;
    this.inFlight.set(key, version);
    this.runner
      .run(
        { kind: 'mesh', key, version, ids: padded.ids, light: padded.light, biomes: padded.biomes },
        'normal',
      )
      .then(
        (result) => this.ready.push(result),
        () => {
          // Worker restarted: try again later.
          this.inFlight.delete(key);
          this.queue(s.cx, s.sy, s.cz);
        },
      );
    return true;
  }

  private upload(budgets: MeshBudgets): void {
    let count = 0;
    let bytes = 0;
    while (
      this.ready.length > 0 &&
      count < budgets.uploadsPerFrame &&
      bytes < budgets.uploadBytesPerFrame
    ) {
      const result = this.ready.shift()!;
      if (this.freePadded.length < 16) this.freePadded.push(result.padded);
      const expected = this.inFlight.get(result.key);
      this.inFlight.delete(result.key);
      // Section key = column key × 8 + sy.
      const colKey = Math.floor(result.key / SECTIONS_PER_COLUMN);
      const sy = result.key - colKey * SECTIONS_PER_COLUMN;
      const ccx = columnKeyX(colKey);
      const ccz = columnKeyZ(colKey);
      const section = this.view.world.getSection(ccx, sy, ccz);
      if (!section) continue; // unloaded meanwhile
      if (expected === undefined || section.version !== result.version) {
        this.stale++;
        this.queue(ccx, sy, ccz);
        continue;
      }
      this.chunks.update(result.key, ccx * 32, sy * 32, ccz * 32, result);
      this.uploaded++;
      count++;
      for (const pass of result.passes) bytes += pass.data.byteLength;
    }
  }
}
