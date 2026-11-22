import type { Registry } from '../content/registry.ts';
import { type Column, columnFromResult } from '../world/Column.ts';
import { columnKey, toColumn } from '../world/coords.ts';
import type { GenResult } from '../world/protocol.ts';
import { VoxelWorld } from '../world/VoxelWorld.ts';
import type { Command, StampedCommand } from './commands.ts';
import type { SimEvent } from './events.ts';
import type { ColumnSource } from './ports.ts';
import { MAX_STREAM_RADIUS, SPIRAL, streamRadii, withinRadius } from './streaming.ts';

export const TICKS_PER_SECOND = 30;
/** Generated columns integrated per tick in normal play (×LOADING_FACTOR while loading). */
export const INTEGRATE_PER_TICK = 2;
export const LOADING_FACTOR = 6;

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
}

export interface SimOptions {
  readonly seed: string;
  readonly registry: Registry;
  readonly source: ColumnSource;
  /** Generation requests in flight at once. */
  readonly maxInFlight: number;
}

/**
 * Authoritative game state. DOM-free and deterministic for a given order of deliveries; the client
 * only reads it (SimView) and sends commands. In v1 it runs on the main thread at 30 Hz.
 */
export class Simulation {
  readonly seed: string;
  readonly registry: Registry;
  readonly world: VoxelWorld;
  tick = 0;
  private readonly source: ColumnSource;
  private readonly maxInFlight: number;
  private readonly players = new Map<number, PlayerView>();
  private readonly commands: StampedCommand[] = [];
  private readonly arrivals: GenResult[] = [];
  private readonly requested = new Set<number>();
  private readonly states = new Map<number, number>();

  constructor(options: SimOptions) {
    this.seed = options.seed;
    this.registry = options.registry;
    this.source = options.source;
    this.maxInFlight = options.maxInFlight;
    this.world = new VoxelWorld(options.registry.air, options.registry.unknownBlock);
  }

  /** Queues a command (the host stamps the player and sequence number). */
  enqueue(command: StampedCommand): void {
    this.commands.push(command);
  }

  /** A generated column arrives from the column source (any order, any time). */
  deliver(result: GenResult): void {
    if (result.seed !== this.seed) return;
    this.arrivals.push(result);
  }

  /** A generation request failed: forget it so streaming asks again. */
  requestFailed(cx: number, cz: number): void {
    this.requested.delete(columnKey(cx, cz));
  }

  columnState(cx: number, cz: number): number {
    return this.states.get(columnKey(cx, cz)) ?? 0;
  }

  /** Columns waiting to be integrated and requests in flight (loading screens, tests). */
  backlog(): { arrivals: number; requested: number } {
    return { arrivals: this.arrivals.length, requested: this.requested.size };
  }

  /** One fixed tick (1/30 s). */
  step(out: SimEvent[]): void {
    this.tick++;
    this.applyCommands();
    this.integrate(INTEGRATE_PER_TICK, out);
    this.stream(out);
  }

  /** Integrates and requests outside play (loading screen, tests). */
  pump(columns: number, out: SimEvent[]): void {
    this.integrate(columns, out);
    this.stream(out);
  }

  private applyCommands(): void {
    for (const { playerId, command } of this.commands.splice(0)) this.apply(playerId, command);
  }

  private apply(playerId: number, command: Command): void {
    switch (command.type) {
      case 'client.view': {
        const radius = Math.max(1, Math.min(MAX_STREAM_RADIUS - 3, Math.floor(command.radius)));
        this.players.set(playerId, {
          cx: toColumn(Math.floor(command.x)),
          cz: toColumn(Math.floor(command.z)),
          radius,
        });
        break;
      }
    }
  }

  private wanted(cx: number, cz: number, extra: number): boolean {
    for (const view of this.players.values()) {
      const r = streamRadii(view.radius);
      if (withinRadius(cx - view.cx, cz - view.cz, extra === 0 ? r.generate : r.unload))
        return true;
    }
    return false;
  }

  private integrate(limit: number, out: SimEvent[]): void {
    let count = 0;
    while (count < limit && this.arrivals.length > 0) {
      const result = this.arrivals.shift()!;
      const key = columnKey(result.cx, result.cz);
      this.requested.delete(key);
      if (this.states.has(key) || !this.wanted(result.cx, result.cz, 1)) continue;
      const column = columnFromResult(result, this.registry.air);
      this.world.columns.set(key, column);
      this.states.set(key, COLUMN_GENERATED);
      this.refreshAround(column.cx, column.cz, out);
      count++;
    }
  }

  /** Re-evaluates the pipeline state of a column and its 8 neighbours. */
  private refreshAround(cx: number, cz: number, out: SimEvent[]): void {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) this.promoteLit(cx + dx, cz + dz);
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) this.promoteMeshable(cx + dx, cz + dz, out);
  }

  private promoteLit(cx: number, cz: number): void {
    const key = columnKey(cx, cz);
    if (this.states.get(key) !== COLUMN_GENERATED) return;
    const has = (x: number, z: number) => this.states.has(columnKey(x, z));
    if (has(cx + 1, cz) && has(cx - 1, cz) && has(cx, cz + 1) && has(cx, cz - 1))
      this.states.set(key, COLUMN_LIT);
  }

  private promoteMeshable(cx: number, cz: number, out: SimEvent[]): void {
    const key = columnKey(cx, cz);
    if (this.states.get(key) !== COLUMN_LIT) return;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((this.states.get(columnKey(cx + dx, cz + dz)) ?? 0) < COLUMN_LIT) return;
      }
    }
    this.states.set(key, COLUMN_MESHABLE);
    out.push({ type: 'columnMeshable', cx, cz });
  }

  private stream(out: SimEvent[]): void {
    // Unload what no player needs any more.
    for (const [key, column] of this.world.columns) {
      if (!this.wanted(column.cx, column.cz, 1)) this.unload(key, column, out);
    }
    // Request missing columns, nearest first.
    for (const view of this.players.values()) {
      const r = streamRadii(view.radius).generate;
      for (const [dx, dz] of SPIRAL) {
        if (this.requested.size >= this.maxInFlight) return;
        if (!withinRadius(dx, dz, r)) continue;
        const cx = view.cx + dx;
        const cz = view.cz + dz;
        const key = columnKey(cx, cz);
        if (this.states.has(key) || this.requested.has(key)) continue;
        this.requested.add(key);
        this.source.request(this.seed, cx, cz);
      }
    }
  }

  private unload(key: number, column: Column, out: SimEvent[]): void {
    this.world.columns.delete(key);
    this.states.delete(key);
    out.push({ type: 'columnUnloaded', cx: column.cx, cz: column.cz });
    // LIT neighbours lose a face neighbour; MESHABLE ones keep their meshes (built with all neighbours).
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nk = columnKey(column.cx + dx, column.cz + dz);
        if (this.states.get(nk) === COLUMN_LIT) this.states.set(nk, COLUMN_GENERATED);
      }
    }
  }
}
