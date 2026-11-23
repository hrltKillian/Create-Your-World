import type { Registry } from '../content/registry.ts';
import { blockToColumn } from '../world/coords.ts';
import { createGenContext, type GenContext, type WorldType } from '../world/gen/generateColumn.ts';
import { findSpawn } from '../world/gen/spawn.ts';
import { LightEngine } from '../world/light/LightEngine.ts';
import type { GenResult } from '../world/protocol.ts';
import { VoxelWorld } from '../world/VoxelWorld.ts';
import type { BlockEntity } from './blockEntities.ts';
import { applyBlockEntityCommand, checkOpened } from './blockEntityCommands.ts';
import { COLUMN_LIT, ColumnPipeline } from './ColumnPipeline.ts';
import { TICK_SECONDS } from './clock.ts';
import { reject, validInput, validView } from './commandRules.ts';
import { type Command, NEUTRAL_INPUT, type StampedCommand } from './commands.ts';
import { applyCraftCommand, stepCrafting } from './craftQueue.ts';
import { applyDebugCommand } from './debugCommands.ts';
import { EditStore } from './editStore.ts';
import { stepLight } from './edits.ts';
import type { SimEvent } from './events.ts';
import { stepInteraction } from './interaction.ts';
import { applyInventoryCommand } from './inventoryCommands.ts';
import { type ItemDropState, stepItemDrops } from './itemDrops.ts';
import { resetBody } from './physics.ts';
import { createPlayer, type PlayerState, stepPlayer } from './player.ts';
import type { ColumnSink, ColumnSource } from './ports.ts';
import { SpatialHash } from './spatialHash.ts';
import { stepStations } from './stations.ts';
import { createTime, stepTime, type TimeState } from './time.ts';

/** Generated columns integrated per tick in normal play (×LOADING_FACTOR while loading). */
export const INTEGRATE_PER_TICK = 2;
export const LOADING_FACTOR = 6;
/** Light seam nodes processed per tick (×LOADING_FACTOR while loading); edits always complete. */
export const SEAM_NODES_PER_TICK = 8192;

export interface SimOptions {
  readonly seed: string;
  readonly worldType?: WorldType;
  readonly registry: Registry;
  readonly source: ColumnSource;
  /** Generation requests in flight at once. */
  readonly maxInFlight: number;
  /** Accept debug.* commands (dev builds and tests). */
  readonly allowDebug?: boolean;
  /** Spawn point of a saved world (otherwise searched for: findSpawn). */
  readonly spawn?: { readonly x: number; readonly y: number; readonly z: number };
}

/** Every entity record of the world (creatures join the union in M10). */
export type Entity = PlayerState | ItemDropState;

/**
 * Authoritative game state. DOM-free and deterministic for a given order of deliveries; the client
 * only reads it (SimView) and sends commands. In v1 it runs on the main thread at 30 Hz. It owns
 * the state and the tick order, and delegates column streaming, players, interaction, item drops,
 * inventory, block entities (chests, stations), craft queues and debug commands.
 */
export class Simulation implements ColumnSink {
  readonly seed: string;
  readonly worldType: WorldType;
  readonly registry: Registry;
  readonly world: VoxelWorld;
  readonly light: LightEngine;
  readonly ctx: GenContext;
  readonly spawn: { readonly x: number; readonly y: number; readonly z: number };
  readonly allowDebug: boolean;
  /** Players by connection id. */
  readonly players = new Map<number, PlayerState>();
  /** Every entity by id, in insertion order (deterministic iteration). */
  readonly entities = new Map<number, Entity>();
  /** Entity positions on the x/z plane (cells of 8 blocks). */
  readonly spatial = new SpatialHash(8);
  /** Chests and stations by cell key (`cellKey`), loaded or not, in creation order. */
  readonly blockEntities = new Map<number, BlockEntity>();
  /** Next entity id; ids are never reused. */
  nextEntityId = 1;
  tick = 0;
  /** The world clock (time of day, day count). */
  readonly time: TimeState = createTime();
  /** Edited sections of the unloaded columns. */
  readonly edits = new EditStore();
  private readonly columns: ColumnPipeline;
  private readonly commands: StampedCommand[] = [];

  constructor(options: SimOptions) {
    this.seed = options.seed;
    this.worldType = options.worldType ?? 'default';
    this.registry = options.registry;
    this.allowDebug = options.allowDebug ?? false;
    this.world = new VoxelWorld(options.registry.air, options.registry.unknownBlock);
    this.light = new LightEngine(options.registry.tables);
    this.ctx = createGenContext(this.seed, this.registry, this.worldType);
    this.spawn = options.spawn ?? findSpawn(this.ctx);
    this.columns = new ColumnPipeline(
      this.world,
      options.registry.air,
      this.light,
      this.edits,
      options.source,
      { seed: this.seed, worldType: this.worldType },
      options.maxInFlight,
    );
    options.source.connect(this);
  }

  /** Adds a player at the spawn point (idempotent per connection id). */
  addPlayer(id: number, viewRadius = 6): PlayerState {
    const player = this.players.get(id);
    if (player) return player;
    const { x, y, z } = this.spawn;
    return this.join(createPlayer(id, x, y, z, viewRadius, this.nextEntityId++));
  }

  /** Puts a player record (new, or restored from a save) in the world and streams around it. */
  join(player: PlayerState): PlayerState {
    const { x, z } = player.body;
    this.players.set(player.playerId, player);
    this.entities.set(player.id, player);
    this.spatial.update(player.id, x, z);
    this.columns.setView(player.playerId, x, z, player.viewRadius);
    return player;
  }

  /** Entities within `radius` (x/z distance) of a point, written into `out`. */
  entitiesNear(x: number, z: number, radius: number, out: number[]): number[] {
    this.spatial.query(x, z, radius, out);
    let n = 0;
    for (let i = 0; i < out.length; i++) {
      const entity = this.entities.get(out[i]!);
      if (!entity) continue;
      const dx = entity.body.x - x;
      const dz = entity.body.z - z;
      if (dx * dx + dz * dz <= radius * radius) out[n++] = out[i]!;
    }
    out.length = n;
    return out;
  }

  /** Queues a command (the host stamps the player and sequence number). */
  enqueue(command: StampedCommand): void {
    this.commands.push(command);
  }

  /** A generated column arrives from the column source (any order, any time). */
  deliver(result: GenResult): void {
    this.columns.deliver(result);
  }

  /** A generation request failed: forget it so streaming asks again. */
  requestFailed(cx: number, cz: number): void {
    this.columns.requestFailed(cx, cz);
  }

  columnState(cx: number, cz: number): number {
    return this.columns.state(cx, cz);
  }

  /** Columns waiting to be integrated and requests in flight (loading screens, tests). */
  backlog(): { arrivals: number; requested: number } {
    return this.columns.backlog();
  }

  /** One fixed tick (1/30 s), in the order of docs/conception.md « Ordre d'un tick ». */
  step(out: SimEvent[]): void {
    this.tick++;
    this.applyCommands(out);
    stepTime(this.time);
    for (const player of this.players.values()) {
      const body = player.body;
      // Frozen while its column is not ready (no falling into the void).
      const active = this.columnState(blockToColumn(body.x), blockToColumn(body.z)) >= COLUMN_LIT;
      if (!stepPlayer(player, active, this.world, this.registry.tables, TICK_SECONDS, out))
        continue;
      this.track(player);
      stepInteraction(this, player, out);
    }
    // Block entities, craft queues and timed states.
    for (const player of this.players.values()) {
      checkOpened(this, player, out);
      stepCrafting(this, player, out);
    }
    stepStations(this, out);
    stepItemDrops(this, out);
    this.columns.integrate(INTEGRATE_PER_TICK);
    stepLight(this.light, SEAM_NODES_PER_TICK, out);
    this.columns.promote(out);
    this.columns.stream(out);
  }

  /** Integrates and requests outside play (loading screen, tests). */
  pump(columns: number, out: SimEvent[]): void {
    // Commands sent while no tick runs (paused, loading) still take effect.
    this.applyCommands(out);
    this.columns.integrate(columns);
    stepLight(this.light, SEAM_NODES_PER_TICK * LOADING_FACTOR, out);
    this.columns.promote(out);
    this.columns.stream(out);
  }

  /** Moves a player, at rest, to a position (debug teleport): no interpolation from the old one. */
  teleport(player: PlayerState, x: number, y: number, z: number): void {
    resetBody(player.body, x, y, z);
    player.prevX = x;
    player.prevY = y;
    player.prevZ = z;
    this.track(player);
  }

  /** Follows a moved body in the spatial hash and, unless detached, with the streaming view. */
  private track(player: PlayerState): void {
    const body = player.body;
    this.spatial.update(player.id, body.x, body.z);
    this.columns.followBody(player.playerId, body.x, body.z, player.viewRadius);
  }

  private applyCommands(out: SimEvent[]): void {
    const commands = this.commands;
    for (let i = 0; i < commands.length; i++)
      this.apply(commands[i]!.playerId, commands[i]!.command, out);
    commands.length = 0;
  }

  private apply(playerId: number, command: Command, out: SimEvent[]): void {
    switch (command.type) {
      case 'client.view': {
        if (!validView(command)) {
          reject(out, playerId, command.type, 'invalid');
          break;
        }
        const player = this.players.get(playerId);
        if (player) player.viewRadius = command.radius;
        if (command.detached || !player) {
          this.columns.setDetached(playerId, true);
          this.columns.setView(playerId, command.x, command.z, command.radius);
        } else {
          this.columns.setDetached(playerId, false);
          this.columns.setView(playerId, player.body.x, player.body.z, command.radius);
        }
        break;
      }
      case 'input': {
        const player = this.players.get(playerId);
        if (!player) break;
        if (validInput(command)) {
          player.input = command;
        } else {
          // Never keep stale held buttons after a bad command.
          player.input = { ...NEUTRAL_INPUT, yaw: player.yaw, pitch: player.pitch };
          reject(out, playerId, command.type, 'invalid');
        }
        break;
      }
      case 'inv.move':
      case 'inv.quickMove':
      case 'inv.drop': {
        const player = this.players.get(playerId);
        if (player) applyInventoryCommand(this, player, command, out);
        break;
      }
      case 'container.open':
      case 'container.close':
      case 'container.move':
      case 'station.move': {
        const player = this.players.get(playerId);
        if (player) applyBlockEntityCommand(this, player, command, out);
        break;
      }
      case 'craft.enqueue':
      case 'craft.cancel': {
        const player = this.players.get(playerId);
        if (player) applyCraftCommand(this, player, command, out);
        break;
      }
      case 'debug.teleport':
      case 'debug.setStat':
      case 'debug.fill':
      case 'debug.give':
      case 'debug.setTime':
      case 'debug.freezeTime':
        if (this.allowDebug) applyDebugCommand(this, playerId, command, out);
        else reject(out, playerId, command.type, 'debug disabled');
        break;
    }
  }
}
