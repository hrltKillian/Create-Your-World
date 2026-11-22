import type { Registry } from '../content/registry.ts';
import { type Column, columnFromResult } from '../world/Column.ts';
import { columnKey, toColumn, WORLD_HEIGHT } from '../world/coords.ts';
import {
  createGenContext,
  findSpawn,
  type GenContext,
  pointInfo,
  type WorldType,
} from '../world/gen/generateColumn.ts';
import type { GenResult } from '../world/protocol.ts';
import { VoxelWorld } from '../world/VoxelWorld.ts';
import type { Command, StampedCommand } from './commands.ts';
import type { SimEvent } from './events.ts';
import { PHYSICS, type StepResult, stepBody } from './physics.ts';
import { createPlayer, type PlayerState, restStamina, STAMINA, spendStamina } from './player.ts';
import type { ColumnSource, WorldSpec } from './ports.ts';
import { MAX_STREAM_RADIUS, SPIRAL, streamRadii } from './streaming.ts';

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
  /** Squared radii, cached when the view changes. */
  generate2: number;
  unload2: number;
  /** Meshes are shown within RD and hidden beyond RD + 1 (hysteresis). */
  show2: number;
  hide2: number;
}

export interface SimOptions {
  readonly seed: string;
  readonly worldType?: WorldType;
  readonly registry: Registry;
  readonly source: ColumnSource;
  /** Generation requests in flight at once. */
  readonly maxInFlight: number;
  /** Accept debug.* commands (dev builds and tests). */
  readonly allowDebug?: boolean;
}

const DT = 1 / TICKS_PER_SECOND;
/** Largest box a debug fill may touch. */
const FILL_LIMIT = 65_536;

/**
 * Authoritative game state. DOM-free and deterministic for a given order of deliveries; the client
 * only reads it (SimView) and sends commands. In v1 it runs on the main thread at 30 Hz.
 */
export class Simulation {
  readonly seed: string;
  readonly worldType: WorldType;
  readonly registry: Registry;
  readonly world: VoxelWorld;
  readonly ctx: GenContext;
  readonly spawn: { readonly x: number; readonly y: number; readonly z: number };
  readonly allowDebug: boolean;
  readonly players = new Map<number, PlayerState>();
  tick = 0;
  private readonly spec: WorldSpec;
  private readonly stepResult: StepResult = { landedFrom: 0, jumped: false, sprinting: false };
  private readonly source: ColumnSource;
  private readonly maxInFlight: number;
  private readonly views = new Map<number, PlayerView>();
  /** Clients streaming from a free camera instead of their body. */
  private readonly detached = new Set<number>();
  private readonly commands: StampedCommand[] = [];
  private readonly arrivals: GenResult[] = [];
  private readonly requested = new Set<number>();
  private readonly states = new Map<number, number>();
  /** MESHABLE columns the client was told to show (inside some player's render distance). */
  private readonly shown = new Set<number>();

  constructor(options: SimOptions) {
    this.seed = options.seed;
    this.worldType = options.worldType ?? 'default';
    this.registry = options.registry;
    this.source = options.source;
    this.maxInFlight = options.maxInFlight;
    this.allowDebug = options.allowDebug ?? false;
    this.world = new VoxelWorld(options.registry.air, options.registry.unknownBlock);
    this.ctx = createGenContext(this.seed, this.registry, this.worldType);
    this.spawn = findSpawn(this.ctx);
    this.spec = { seed: this.seed, worldType: this.worldType };
  }

  /** Adds a player at the spawn point (idempotent). */
  addPlayer(id: number, viewRadius = 6): PlayerState {
    let player = this.players.get(id);
    if (!player) {
      player = createPlayer(id, this.spawn.x, this.spawn.y, this.spawn.z, viewRadius);
      this.players.set(id, player);
      this.setView(id, this.spawn.x, this.spawn.z, viewRadius);
    }
    return player;
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
    this.applyCommands(out);
    for (const player of this.players.values()) this.stepPlayer(player, out);
    this.integrate(INTEGRATE_PER_TICK, out);
    this.stream(out);
  }

  /** Player control and physics. Frozen while its column is not ready (no falling into the void). */
  private stepPlayer(player: PlayerState, out: SimEvent[]): void {
    const body = player.body;
    player.prevX = body.x;
    player.prevY = body.y;
    player.prevZ = body.z;
    const input = player.input;
    player.yaw = input.yaw;
    player.pitch = input.pitch;
    if (this.columnState(toColumn(Math.floor(body.x)), toColumn(Math.floor(body.z))) < COLUMN_LIT)
      return;
    const canSprint = !player.exhausted && player.stamina > 0;
    const result = stepBody(
      body,
      {
        forward: input.forward,
        strafe: input.strafe,
        jump: input.jump && (player.stamina >= STAMINA.jump || body.inWater),
        sprint: input.sprint && canSprint,
        crouch: input.crouch,
        yaw: input.yaw,
      },
      this.world,
      this.registry.tables,
      DT,
      this.stepResult,
    );
    if (result.jumped) spendStamina(player, STAMINA.jump);
    const moving = Math.abs(body.vx) + Math.abs(body.vz) > 0.1;
    if (result.sprinting && moving) spendStamina(player, STAMINA.sprintPerSecond * DT);
    else restStamina(player, DT);
    if (result.landedFrom > 0)
      out.push({ type: 'playerLanded', playerId: player.id, fall: result.landedFrom });
    if (!this.detached.has(player.id)) this.setView(player.id, body.x, body.z, player.viewRadius);
  }

  /** Integrates and requests outside play (loading screen, tests). */
  pump(columns: number, out: SimEvent[]): void {
    this.integrate(columns, out);
    this.stream(out);
  }

  private applyCommands(out: SimEvent[]): void {
    const commands = this.commands;
    for (let i = 0; i < commands.length; i++)
      this.apply(commands[i]!.playerId, commands[i]!.command, out);
    commands.length = 0;
  }

  private setView(playerId: number, x: number, z: number, radius: number): void {
    const r = Math.max(1, Math.min(MAX_STREAM_RADIUS - 3, Math.floor(radius)));
    const radii = streamRadii(r);
    const view = this.views.get(playerId);
    const cx = toColumn(Math.floor(x));
    const cz = toColumn(Math.floor(z));
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

  private apply(playerId: number, command: Command, out: SimEvent[]): void {
    switch (command.type) {
      case 'client.view': {
        const player = this.players.get(playerId);
        if (player) player.viewRadius = command.radius;
        if (command.detached || !player) {
          this.detached.add(playerId);
          this.setView(playerId, command.x, command.z, command.radius);
        } else {
          this.detached.delete(playerId);
          this.setView(playerId, player.body.x, player.body.z, command.radius);
        }
        break;
      }
      case 'input': {
        const player = this.players.get(playerId);
        if (player) player.input = command;
        break;
      }
      case 'debug.teleport':
      case 'debug.setStat':
      case 'debug.fill': {
        if (!this.allowDebug) {
          out.push({ type: 'rejected', playerId, command: command.type, reason: 'debug disabled' });
          break;
        }
        if (command.type === 'debug.fill') {
          this.fill(playerId, command, out);
          break;
        }
        const player = this.players.get(playerId);
        if (!player) break;
        if (command.type === 'debug.teleport')
          this.teleport(player, command.x, command.y, command.z);
        else if (command.stat === 'stamina')
          player.stamina = Math.max(0, Math.min(STAMINA.max, command.value));
        break;
      }
    }
  }

  /** Debug fill of a box of loaded blocks (no light update before the light engine lands). */
  private fill(
    playerId: number,
    c: Extract<Command, { type: 'debug.fill' }>,
    out: SimEvent[],
  ): void {
    const x0 = Math.min(c.x0, c.x1);
    const x1 = Math.max(c.x0, c.x1);
    const y0 = Math.max(0, Math.min(c.y0, c.y1));
    const y1 = Math.min(WORLD_HEIGHT - 1, Math.max(c.y0, c.y1));
    const z0 = Math.min(c.z0, c.z1);
    const z1 = Math.max(c.z0, c.z1);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > FILL_LIMIT) {
      out.push({ type: 'rejected', playerId, command: c.type, reason: 'too large' });
      return;
    }
    const state = this.registry.stateIdOrUnknown(c.state);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        if (!this.world.getColumn(toColumn(x), toColumn(z))) continue;
        for (let y = y0; y <= y1; y++) this.world.setBlock(x, y, z, state);
      }
    }
    out.push({ type: 'blocksChanged', x0, y0, z0, x1, y1, z1 });
  }

  /** Moves a player; 'surface' puts it on top of the ground (loaded heightmap or analytic height). */
  private teleport(player: PlayerState, x: number, y: number | 'surface', z: number): void {
    let ty: number;
    if (y === 'surface') {
      const column = this.world.getColumn(toColumn(Math.floor(x)), toColumn(Math.floor(z)));
      ty = column
        ? column.heightmap[(Math.floor(x) & 31) | ((Math.floor(z) & 31) << 5)]!
        : pointInfo(this.ctx, Math.floor(x), Math.floor(z)).height + 1;
    } else {
      ty = Math.max(1, Math.min(WORLD_HEIGHT - PHYSICS.height, y));
    }
    const body = player.body;
    body.x = x;
    body.y = ty;
    body.z = z;
    body.vx = 0;
    body.vy = 0;
    body.vz = 0;
    body.fallStartY = ty;
    player.prevX = x;
    player.prevY = ty;
    player.prevZ = z;
    if (!this.detached.has(player.id)) this.setView(player.id, x, z, player.viewRadius);
  }

  private withinUnload(cx: number, cz: number): boolean {
    for (const view of this.views.values()) {
      const dx = cx - view.cx;
      const dz = cz - view.cz;
      if (dx * dx + dz * dz <= view.unload2) return true;
    }
    return false;
  }

  private withinShow(cx: number, cz: number): boolean {
    for (const view of this.views.values()) {
      const dx = cx - view.cx;
      const dz = cz - view.cz;
      if (dx * dx + dz * dz <= view.show2) return true;
    }
    return false;
  }

  private beyondHide(cx: number, cz: number): boolean {
    for (const view of this.views.values()) {
      const dx = cx - view.cx;
      const dz = cz - view.cz;
      if (dx * dx + dz * dz <= view.hide2) return false;
    }
    return true;
  }

  private integrate(limit: number, out: SimEvent[]): void {
    let count = 0;
    while (count < limit && this.arrivals.length > 0) {
      const result = this.arrivals.shift()!;
      const key = columnKey(result.cx, result.cz);
      this.requested.delete(key);
      if (this.states.has(key) || !this.withinUnload(result.cx, result.cz)) continue;
      const column = columnFromResult(result, this.registry.air);
      this.world.columns.set(key, column);
      this.states.set(key, COLUMN_GENERATED);
      this.refreshAround(column.cx, column.cz, out);
      count++;
    }
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
    if (this.withinShow(cx, cz)) this.show(key, cx, cz, out);
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

  private stream(out: SimEvent[]): void {
    // Unload what no player needs any more; show or hide meshable columns by render distance.
    for (const [key, column] of this.world.columns) {
      if (!this.withinUnload(column.cx, column.cz)) {
        this.unload(key, column, out);
        continue;
      }
      if (this.states.get(key) !== COLUMN_MESHABLE) continue;
      if (this.shown.has(key)) {
        if (this.beyondHide(column.cx, column.cz)) this.hide(key, column.cx, column.cz, out);
      } else if (this.withinShow(column.cx, column.cz)) {
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
