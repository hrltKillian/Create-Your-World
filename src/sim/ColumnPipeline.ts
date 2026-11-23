import { type Column, columnFromResult } from '../world/Column.ts';
import { blockToColumn, columnKey } from '../world/coords.ts';
import type { GenResult } from '../world/protocol.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import type { SimEvent } from './events.ts';
import type { ColumnSource, WorldSpec } from './ports.ts';
import { MAX_STREAM_RADIUS, SPIRAL, streamRadii } from './streaming.ts';

/** Pipeline state of a loaded column. */
export const COLUMN_GENERATED = 1;
/** Its 4 face neighbours are loaded (later: light seams stitched). */
export const COLUMN_LIT = 2;
/** Its 8 neighbours are LIT: its sections can be meshed. */
export const COLUMN_MESHABLE = 3;

interface PlayerView {
  cx: number;
  cz: number;
  radius: number;
  /** Squared radii, cached when the view changes. */
  generate2: number;
  unload2: number;
  /** Meshes are shown within RD and hidden beyond RD + 1 (hysteresis). */
  show2: number;
  hide2: number;
}

/** The squared view radii tested against loaded columns. */
type ViewRadius = 'unload2' | 'show2' | 'hide2';

/**
 * Column streaming for every player view: requests to the column source, integration of the
 * arrivals, the GENERATED → LIT → MESHABLE states, mesh show/hide by render distance and unloading.
 * Deterministic for a given order of deliveries (maps and sets iterate in insertion order).
 */
export class ColumnPipeline {
  private readonly world: VoxelWorld;
  private readonly air: number;
  private readonly source: ColumnSource;
  private readonly spec: WorldSpec;
  private readonly maxInFlight: number;
  private readonly views = new Map<number, PlayerView>();
  /** Clients streaming from a free camera instead of their body. */
  private readonly detached = new Set<number>();
  private readonly arrivals: GenResult[] = [];
  private readonly requested = new Set<number>();
  private readonly states = new Map<number, number>();
  /** MESHABLE columns the client was told to show (inside some player's render distance). */
  private readonly shown = new Set<number>();

  constructor(
    world: VoxelWorld,
    air: number,
    source: ColumnSource,
    spec: WorldSpec,
    maxInFlight: number,
  ) {
    this.world = world;
    this.air = air;
    this.source = source;
    this.spec = spec;
    this.maxInFlight = maxInFlight;
  }

  /** A generated column arrives (any order, any time); results of another seed are dropped. */
  deliver(result: GenResult): void {
    if (result.seed !== this.spec.seed) return;
    this.arrivals.push(result);
  }

  /** A generation request failed: forget it so streaming asks again. */
  requestFailed(cx: number, cz: number): void {
    this.requested.delete(columnKey(cx, cz));
  }

  state(cx: number, cz: number): number {
    return this.states.get(columnKey(cx, cz)) ?? 0;
  }

  backlog(): { arrivals: number; requested: number } {
    return { arrivals: this.arrivals.length, requested: this.requested.size };
  }

  /** Streams around block position (x, z) for a player, within `radius` columns. */
  setView(playerId: number, x: number, z: number, radius: number): void {
    const r = Math.max(1, Math.min(MAX_STREAM_RADIUS - 3, Math.floor(radius)));
    const radii = streamRadii(r);
    const view = this.views.get(playerId);
    const cx = blockToColumn(x);
    const cz = blockToColumn(z);
    if (view && view.cx === cx && view.cz === cz && view.radius === r) return;
    this.views.set(playerId, {
      cx,
      cz,
      radius: r,
      generate2: radii.generate * radii.generate,
      unload2: radii.unload * radii.unload,
      show2: radii.mesh * radii.mesh,
      hide2: (radii.mesh + 1) * (radii.mesh + 1),
    });
  }

  /** A detached view (free camera) no longer follows the player's body. */
  setDetached(playerId: number, detached: boolean): void {
    if (detached) this.detached.add(playerId);
    else this.detached.delete(playerId);
  }

  /** Moves the view to the player's body, unless it is detached. */
  followBody(playerId: number, x: number, z: number, radius: number): void {
    if (!this.detached.has(playerId)) this.setView(playerId, x, z, radius);
  }

  /** Integrates up to `limit` arrivals still needed by some view. */
  integrate(limit: number, out: SimEvent[]): void {
    let count = 0;
    while (count < limit && this.arrivals.length > 0) {
      const result = this.arrivals.shift()!;
      const key = columnKey(result.cx, result.cz);
      this.requested.delete(key);
      if (this.states.has(key) || !this.anyViewWithin(result.cx, result.cz, 'unload2')) continue;
      const column = columnFromResult(result, this.air);
      this.world.columns.set(key, column);
      this.states.set(key, COLUMN_GENERATED);
      this.refreshAround(column.cx, column.cz, out);
      count++;
    }
  }

  /** Unloads, shows or hides loaded columns, then requests missing ones, nearest first. */
  stream(out: SimEvent[]): void {
    // Unload what no player needs any more; show or hide meshable columns by render distance.
    for (const [key, column] of this.world.columns) {
      if (!this.anyViewWithin(column.cx, column.cz, 'unload2')) {
        this.unload(key, column, out);
        continue;
      }
      if (this.states.get(key) !== COLUMN_MESHABLE) continue;
      if (this.shown.has(key)) {
        if (!this.anyViewWithin(column.cx, column.cz, 'hide2'))
          this.hide(key, column.cx, column.cz, out);
      } else if (this.anyViewWithin(column.cx, column.cz, 'show2')) {
        this.show(key, column.cx, column.cz, out);
      }
    }
    // Request missing columns, nearest first.
    for (const view of this.views.values()) {
      for (const [dx, dz] of SPIRAL) {
        if (this.requested.size >= this.maxInFlight) return;
        if (dx * dx + dz * dz > view.generate2) continue;
        const cx = view.cx + dx;
        const cz = view.cz + dz;
        const key = columnKey(cx, cz);
        if (this.states.has(key) || this.requested.has(key)) continue;
        this.requested.add(key);
        this.source.request(this.spec, cx, cz);
      }
    }
  }

  /** Whether column (cx, cz) lies within the given radius of at least one view. */
  private anyViewWithin(cx: number, cz: number, radius: ViewRadius): boolean {
    for (const view of this.views.values()) {
      const dx = cx - view.cx;
      const dz = cz - view.cz;
      if (dx * dx + dz * dz <= view[radius]) return true;
    }
    return false;
  }

  /** Re-evaluates the pipeline state of a column and its neighbours. */
  private refreshAround(cx: number, cz: number, out: SimEvent[]): void {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) this.promoteLit(cx + dx, cz + dz);
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) this.promoteMeshable(cx + dx, cz + dz, out);
  }

  /** LIT = the 4 face neighbours are loaded (light seams can be stitched from M5 on). */
  private promoteLit(cx: number, cz: number): void {
    const key = columnKey(cx, cz);
    if (this.states.get(key) !== COLUMN_GENERATED) return;
    const has = (x: number, z: number) => this.states.has(columnKey(x, z));
    if (has(cx + 1, cz) && has(cx - 1, cz) && has(cx, cz + 1) && has(cx, cz - 1))
      this.states.set(key, COLUMN_LIT);
  }

  /** MESHABLE = all 8 neighbours are LIT; the column is shown if it is inside a render distance. */
  private promoteMeshable(cx: number, cz: number, out: SimEvent[]): void {
    const key = columnKey(cx, cz);
    if (this.states.get(key) !== COLUMN_LIT) return;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((this.states.get(columnKey(cx + dx, cz + dz)) ?? 0) < COLUMN_LIT) return;
      }
    }
    this.states.set(key, COLUMN_MESHABLE);
    if (this.anyViewWithin(cx, cz, 'show2')) this.show(key, cx, cz, out);
  }

  private show(key: number, cx: number, cz: number, out: SimEvent[]): void {
    if (this.shown.has(key)) return;
    this.shown.add(key);
    out.push({ type: 'columnMeshable', cx, cz });
  }

  private hide(key: number, cx: number, cz: number, out: SimEvent[]): void {
    if (!this.shown.delete(key)) return;
    out.push({ type: 'columnHidden', cx, cz });
  }

  private unload(key: number, column: Column, out: SimEvent[]): void {
    this.world.columns.delete(key);
    this.states.delete(key);
    this.shown.delete(key);
    out.push({ type: 'columnUnloaded', cx: column.cx, cz: column.cz });
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = column.cx + dx;
        const nz = column.cz + dz;
        const nk = columnKey(nx, nz);
        // Any neighbour lost a complete neighbourhood: it must be meshed again when it returns.
        if (this.states.get(nk) === COLUMN_MESHABLE) {
          this.states.set(nk, COLUMN_LIT);
          this.hide(nk, nx, nz, out);
        }
        // Only face neighbours lose LIT (it depends on the 4 face neighbours alone).
        if ((dx === 0 || dz === 0) && this.states.get(nk) === COLUMN_LIT)
          this.states.set(nk, COLUMN_GENERATED);
      }
    }
  }
}
