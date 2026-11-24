import type { Registry } from '../content/registry.ts';
import { cellKey } from '../world/coords.ts';
import type { GenContext } from '../world/gen/generateColumn.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import type { BlockEntity } from './blockEntities.ts';
import type { Command } from './commands.ts';
import { stationNear } from './craftQueue.ts';
import type { SimEvent } from './events.ts';
import type { PlayerState } from './player.ts';
import type { Entity, Simulation } from './Simulation.ts';
import type { SpawnLogEntry } from './spawning.ts';
import { stateHash } from './stateHash.ts';
import type { TimeState } from './time.ts';

/** Read-only view of the simulation for rendering, UI and audio. */
export interface SimView {
  readonly world: VoxelWorld;
  readonly registry: Registry;
  readonly seed: string;
  readonly spawn: { readonly x: number; readonly y: number; readonly z: number };
  /** Read-only generation context (analytic biome and height queries, golden hashes). */
  readonly gen: GenContext;
  readonly playerId: number;
  /** Every entity (players, item drops, creatures) by id, in a deterministic order. */
  readonly entities: ReadonlyMap<number, Readonly<Entity>>;
  /** The last hostile spawns, oldest first (automation and tests). */
  readonly spawnLog: readonly Readonly<SpawnLogEntry>[];
  tick(): number;
  /** The world clock (time of day, day count, frozen). */
  time(): Readonly<TimeState>;
  /** Canonical state hash (determinism checks and tests). */
  hash(): number;
  columnState(cx: number, cz: number): number;
  player(id?: number): Readonly<PlayerState> | undefined;
  /**
   * The chest or station at a block cell (live, read only): the one a player has open (`opened`)
   * always exists; a generated chest nobody opened has none yet.
   */
  blockEntity(x: number, y: number, z: number): Readonly<BlockEntity> | undefined;
  /** Whether a block of a station stands within reach of a player (Logbook « Requires: … »). */
  stationNear(station: string, id?: number): boolean;
}

/** Client ⇄ simulation contract. A future RemoteSimHost implements it over the network. */
export interface SimHost {
  readonly view: SimView;
  send(command: Command): void;
  /** Runs `ticks` steps and appends their events to `out` (no allocation per tick). */
  advance(ticks: number, out: SimEvent[]): void;
  /** Integrates more generated columns outside play (loading screen, tests). */
  pumpWorld(budget: { readonly columns: number }, out: SimEvent[]): void;
}

function makeView(sim: Simulation, playerId: number): SimView {
  return {
    world: sim.world,
    registry: sim.registry,
    seed: sim.seed,
    spawn: sim.spawn,
    gen: sim.ctx,
    playerId,
    entities: sim.entities,
    spawnLog: sim.spawnLog,
    tick: () => sim.tick,
    time: () => sim.time,
    hash: () => stateHash(sim),
    columnState: (cx, cz) => sim.columnState(cx, cz),
    player: (id = playerId) => sim.players.get(id),
    blockEntity: (x, y, z) => sim.blockEntities.get(cellKey(x, y, z)),
    stationNear: (station, id = playerId) => {
      const player = sim.players.get(id);
      return player !== undefined && stationNear(sim, player, station);
    },
  };
}

/** v1 host: the simulation runs in this page; the view exposes live objects without copies. */
export class LocalSimHost implements SimHost {
  readonly view: SimView;
  protected readonly sim: Simulation;
  protected readonly playerId: number;
  private seq = 0;

  constructor(sim: Simulation, playerId = 1) {
    this.sim = sim;
    this.playerId = playerId;
    this.view = makeView(sim, playerId);
  }

  send(command: Command): void {
    this.sim.enqueue({ playerId: this.playerId, seq: this.seq++, command });
  }

  advance(ticks: number, out: SimEvent[]): void {
    for (let i = 0; i < ticks; i++) this.sim.step(out);
  }

  pumpWorld(budget: { readonly columns: number }, out: SimEvent[]): void {
    this.sim.pump(budget.columns, out);
  }
}

/** JSON round trip: the copy of a value that a network would deliver. */
function relay<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Same as LocalSimHost, but every command and event goes through JSON, which proves the protocol
 * would survive a network (`?host=serialize` and tests).
 */
export class SerializingSimHost extends LocalSimHost {
  private readonly scratch: SimEvent[] = [];

  override send(command: Command): void {
    super.send(relay(command));
  }

  override advance(ticks: number, out: SimEvent[]): void {
    this.scratch.length = 0;
    super.advance(ticks, this.scratch);
    for (const event of relay(this.scratch)) out.push(event);
  }

  override pumpWorld(budget: { readonly columns: number }, out: SimEvent[]): void {
    this.scratch.length = 0;
    super.pumpWorld(budget, this.scratch);
    for (const event of relay(this.scratch)) out.push(event);
  }
}

/** The host a local client uses for a simulation (JSON round trips with `serialize`). */
export function createHost(sim: Simulation, playerId: number, serialize = false): LocalSimHost {
  return serialize ? new SerializingSimHost(sim, playerId) : new LocalSimHost(sim, playerId);
}
