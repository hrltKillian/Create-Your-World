import { type Column, columnFromResult } from '../world/Column.ts';
import { blockToColumn, columnKey, columnKeyX, columnKeyZ } from '../world/coords.ts';
import type { LightEngine } from '../world/light/LightEngine.ts';
import type { GenResult } from '../world/protocol.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import type { EditStore } from './editStore.ts';
import type { SimEvent } from './events.ts';
import type { ColumnSource, WorldSpec } from './ports.ts';
import { MAX_STREAM_RADIUS, SPIRAL, streamRadii } from './streaming.ts';

/** Pipeline state of a loaded column: arrived with its local light. */
export const COLUMN_GENERATED = 1;
/**
 * Its 4 face neighbours are loaded and its 4 light seams stitched, and no light entry waits in it
 * or in its 8 neighbours.
 */
export const COLUMN_LIT = 2;
/** Its 8 neighbours are LIT: its sections can be meshed. */
export const COLUMN_MESHABLE = 3;

/** No column is integrated while more light seam entries than this wait. */
const SEAM_BACKLOG_LIMIT = 65_536;
/**
 * Largest render distance: the loaded area (RD + 3.5 around a view) stays under 32 columns
 * across, so two loaded columns never share a light slot (ColumnSlots).
 */
const MAX_VIEW_RADIUS = MAX_STREAM_RADIUS - 4;

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
 * arrivals (handed to the light engine), the GENERATED → LIT → MESHABLE states, mesh show/hide by
 * render distance and unloading. An unloading column leaves its edited sections in the edit store,
 * and its next request carries them. Deterministic for a given order of deliveries (maps and sets
 * iterate in insertion order).
 */
export class ColumnPipeline {
  private readonly world: VoxelWorld;
  private readonly air: number;
  private readonly light: LightEngine;
  private readonly edits: EditStore;
  private readonly source: ColumnSource;
  private readonly spec: WorldSpec;
  private readonly maxInFlight: number;
  private readonly views = new Map<number, PlayerView>();
  /** Clients streaming from a free camera instead of their body. */
  private readonly detached = new Set<number>();
  private readonly arrivals: GenResult[] = [];
  private readonly requested = new Set<number>();
  private readonly states = new Map<number, number>();
  /** Keys of the GENERATED columns, checked for LIT after each light step. */
  private readonly unlit = new Set<number>();
  /** MESHABLE columns the client was told to show (inside some player's render distance). */
  private readonly shown = new Set<number>();

  /** Events of the `promote` call in progress (read by the `promoteLit` callback). */
  private events: SimEvent[] = [];
  private readonly promoteLit = (key: number): void => {
    const cx = columnKeyX(key);
    const cz = columnKeyZ(key);
    if (!this.light.stitched(cx, cz) || !this.light.settled(cx, cz)) return;
    this.states.set(key, COLUMN_LIT);
    this.unlit.delete(key);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) this.promoteMeshable(cx + dx, cz + dz, this.events);
  };

  constructor(
    world: VoxelWorld,
    air: number,
    light: LightEngine,
    edits: EditStore,
    source: ColumnSource,
    spec: WorldSpec,
    maxInFlight: number,
  ) {
    this.world = world;
    this.air = air;
    this.light = light;
    this.edits = edits;
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
    const r = Math.max(1, Math.min(MAX_VIEW_RADIUS, Math.floor(radius)));
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

  /**
   * Integrates up to `limit` arrivals still needed by some view, none while the light seam
   * backlog is over its limit. Each one's borders are compared with its loaded neighbours.
   */
  integrate(limit: number): void {
    let count = 0;
    while (
      count < limit &&
      this.arrivals.length > 0 &&
      this.light.seamBacklog() <= SEAM_BACKLOG_LIMIT
    ) {
      const result = this.arrivals.shift()!;
      const key = columnKey(result.cx, result.cz);
      this.requested.delete(key);
      if (this.states.has(key) || !this.anyViewWithin(result.cx, result.cz, 'unload2')) continue;
      // A column 32 columns away still holds the light slot (a view that jumped): asked again later.
      if (!this.light.slotFree(result.cx, result.cz)) continue;
      const column = columnFromResult(result, this.air);
      this.world.columns.set(key, column);
      // The result was generated over the saved sections (none can change while it is requested).
      this.edits.forget(key);
      this.states.set(key, COLUMN_GENERATED);
      this.unlit.add(key);
      this.light.addColumn(column);
      count++;
    }
  }

  /** After a light step: GENERATED columns whose light is ready become LIT, then MESHABLE around. */
  promote(out: SimEvent[]): void {
    this.events = out;
    this.unlit.forEach(this.promoteLit);
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
        this.source.request(this.spec, cx, cz, this.edits.copies(key));
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
    this.edits.keep(key, column);
    this.world.columns.delete(key);
    this.states.delete(key);
    this.unlit.delete(key);
    this.shown.delete(key);
    this.light.removeColumn(column.cx, column.cz);
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
        // Only face neighbours lose LIT (their seam with this column is gone).
        if ((dx === 0 || dz === 0) && this.states.get(nk) === COLUMN_LIT) {
          this.states.set(nk, COLUMN_GENERATED);
          this.unlit.add(nk);
        }
      }
    }
  }
}
