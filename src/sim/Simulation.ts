import type { Registry } from '../content/registry.ts';
import { blockToColumn } from '../world/coords.ts';
import { createGenContext, type GenContext, type WorldType } from '../world/gen/generateColumn.ts';
import { findSpawn } from '../world/gen/spawn.ts';
import { LightEngine } from '../world/light/LightEngine.ts';
import type { GenResult } from '../world/protocol.ts';
import { VoxelWorld } from '../world/VoxelWorld.ts';
import { stepCreatures } from './ai/creatureStep.ts';
import { stepScanners } from './bestiary.ts';
import type { BlockEntity } from './blockEntities.ts';
import { applyBlockEntityCommand } from './blockEntityCommands.ts';
import { BlockUpdateQueue, stepBlockUpdates } from './blockUpdates.ts';
import { COLUMN_LIT, ColumnPipeline } from './ColumnPipeline.ts';
import { TICK_SECONDS } from './clock.ts';
import { stepCombat } from './combat.ts';
import { reject, validInput, validView } from './commandRules.ts';
import { type Command, NEUTRAL_INPUT, type StampedCommand } from './commands.ts';
import { applyCraftCommand, stepCrafting } from './craftQueue.ts';
import { type CreatureState, unparkCreatures } from './creatures.ts';
import { respawn, stepDeaths } from './death.ts';
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
import { applyQuestCommand, stepQuests } from './quests.ts';
import { applyScreenCommand, checkOpened } from './screens.ts';
import { stepSleep } from './sleep.ts';
import { applySlotCommand } from './slotClicks.ts';
import { SpatialHash } from './spatialHash.ts';
import { placeHerds, type SpawnLogEntry, stepSpawning } from './spawning.ts';
import { stepStations } from './stations.ts';
import { stepSurvival } from './survival.ts';
import { clockEvents, createTime, stepTime, type TimeState } from './time.ts';

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
  /** Hostile creatures spawn (the world's rule; default true). */
  readonly hostiles?: boolean;
  /** Creatures spawn and herds are placed (default: generated worlds only, not the test ones). */
  readonly spawns?: boolean;
  /** No hostile spawns before this tick (default: the pack's `creatures.spawnGraceTicks`). */
  readonly graceTicks?: number;
}

/** What creatures may do in a world (spawning.ts). */
export interface CreatureRules {
  readonly hostiles: boolean;
  readonly spawns: boolean;
  readonly graceTicks: number;
}

/** Every entity record of the world. */
export type Entity = PlayerState | ItemDropState | CreatureState;

/**
 * Authoritative game state. DOM-free and deterministic for a given order of deliveries; the client
 * only reads it (SimView) and sends commands. In v1 it runs on the main thread at 30 Hz. It owns
 * the state and the tick order, and delegates column streaming, players, interaction, creatures
 * (AI, combat, spawning), item drops, inventory, slot screens and their clicks, block entities
 * (chests, stations, packs), craft queues, survival, deaths, sleep, quests and debug commands.
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
  readonly rules: CreatureRules;
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
  /** Columns whose first generation placed a herd (saved: no second herd when they load again). */
  readonly herdColumns = new Set<number>();
  /**
   * Creatures of the unloaded columns by column key, out of `entities` (saved with their column,
   * back when it loads: `parkCreature`, `unparkCreatures`).
   */
  readonly parked = new Map<number, CreatureState[]>();
  /** The last hostile spawns (tests; not saved). */
  readonly spawnLog: SpawnLogEntry[] = [];
  /** Block updates due or waiting (blockUpdates.ts, tick step 10). */
  readonly blockUpdates = new BlockUpdateQueue();
  private readonly columns: ColumnPipeline;
  private readonly commands: StampedCommand[] = [];

  constructor(options: SimOptions) {
    this.seed = options.seed;
    this.worldType = options.worldType ?? 'default';
    this.registry = options.registry;
    this.allowDebug = options.allowDebug ?? false;
    this.rules = {
      hostiles: options.hostiles ?? true,
      spawns: options.spawns ?? this.worldType === 'default',
      graceTicks: options.graceTicks ?? options.registry.pack.balance.creatures.spawnGraceTicks,
    };
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
      (column) => {
        unparkCreatures(this, column.cx, column.cz);
        placeHerds(this, column);
      },
    );
    options.source.connect(this);
  }

  /** Adds a player at the spawn point (idempotent per connection id). */
  addPlayer(id: number, viewRadius = 6): PlayerState {
    const player = this.players.get(id);
    if (player) return player;
    const { x, y, z } = this.spawn;
    const balance = this.registry.pack.balance;
    return this.join(createPlayer(id, x, y, z, viewRadius, balance, this.nextEntityId++));
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

  /** Whether a player's column is ready: until then it is frozen (no falling into the void). */
  isActive(player: PlayerState): boolean {
    const body = player.body;
    return this.columnState(blockToColumn(body.x), blockToColumn(body.z)) >= COLUMN_LIT;
  }

  /**
   * One fixed tick (1/30 s), in the order of docs/conception.md « Ordre d'un tick »; each player
   * moves and interacts (steps 4, 6, 7) before the creatures think and move (5, 6) and fight (8).
   */
  step(out: SimEvent[]): void {
    // This tick's events start here (survival reacts to the edits).
    const first = out.length;
    this.tick++;
    this.applyCommands(out);
    // The clock's messages cover this tick's time, a night slept through included.
    const clock = this.time.ticks;
    stepTime(this.time);
    for (const player of this.players.values()) {
      const active = this.isActive(player);
      if (!stepPlayer(player, active, this.world, this.registry, TICK_SECONDS, out)) continue;
      this.track(player);
      stepInteraction(this, player, out);
    }
    stepCreatures(this, out);
    stepCombat(this, out);
    stepScanners(this, out);
    // Block entities, craft queues and timed states.
    for (const player of this.players.values()) {
      checkOpened(this, player, out);
      stepCrafting(this, player, out);
    }
    stepStations(this, out);
    stepBlockUpdates(this, out);
    stepSurvival(this, out, first);
    stepItemDrops(this, out);
    stepSpawning(this);
    stepDeaths(this, out);
    stepSleep(this, out);
    clockEvents(clock, this.time.ticks, out);
    this.columns.integrate(INTEGRATE_PER_TICK);
    stepLight(this.light, SEAM_NODES_PER_TICK, out);
    this.columns.promote(out);
    this.columns.stream(out);
    stepQuests(this, out, first);
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
      case 'inv.drop': {
        const player = this.players.get(playerId);
        if (player) applyInventoryCommand(this, player, command, out);
        break;
      }
      case 'screen.open':
      case 'screen.close': {
        const player = this.players.get(playerId);
        if (player) applyScreenCommand(this, player, command, out);
        break;
      }
      case 'slot.click':
      case 'slot.hotkey': {
        const player = this.players.get(playerId);
        if (player) applySlotCommand(this, player, command, out);
        break;
      }
      case 'container.open':
      case 'station.keepLit': {
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
      case 'quest.claim':
      case 'quest.pin': {
        const player = this.players.get(playerId);
        if (player) applyQuestCommand(this, player, command, out);
        break;
      }
      case 'player.respawn': {
        const player = this.players.get(playerId);
        if (player) respawn(this, player, out);
        break;
      }
      case 'debug.teleport':
      case 'debug.setStat':
      case 'debug.kill':
      case 'debug.god':
      case 'debug.fill':
      case 'debug.give':
      case 'debug.setTime':
      case 'debug.freezeTime':
      case 'debug.open':
      case 'debug.spawn':
      case 'debug.killCreature':
        if (this.allowDebug) applyDebugCommand(this, playerId, command, out);
        else reject(out, playerId, command.type, 'debug disabled');
        break;
    }
  }
}
