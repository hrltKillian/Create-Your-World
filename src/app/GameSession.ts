import type { Registry } from '../content/registry.ts';
import type { InputManager } from '../input/InputManager.ts';
import { WorkerColumnSource } from '../platform/WorkerColumnSource.ts';
import type { WorkerPool } from '../platform/WorkerPool.ts';
import { BoxBatch } from '../render/BoxBatch.ts';
import { CameraRig } from '../render/CameraRig.ts';
import { EntityView } from '../render/EntityView.ts';
import { MeshScheduler } from '../render/MeshScheduler.ts';
import type { CameraPose, WorldView } from '../render/WorldView.ts';
import type { SimEvent } from '../sim/events.ts';
import { LocalSimHost, SerializingSimHost, type SimHost } from '../sim/host.ts';
import type { PlayerState } from '../sim/player.ts';
import {
  COLUMN_LIT,
  COLUMN_MESHABLE,
  INTEGRATE_PER_TICK,
  LOADING_FACTOR,
  Simulation,
  TICKS_PER_SECOND,
} from '../sim/Simulation.ts';
import { SECTIONS_PER_COLUMN, sectionKey, toColumn } from '../world/coords.ts';
import type { WorldType } from '../world/gen/generateColumn.ts';
import type { FreeCam } from './FreeCam.ts';

const TICK = 1 / TICKS_PER_SECOND;
const MAX_STEPS = 4;
/** Closest third-person camera distance (m) at which the avatar is still drawn. */
const AVATAR_MIN_DISTANCE = 0.6;
/** Radius (columns) that must be meshed before the loading screen goes away. */
export const LOADING_RADIUS = 3;
const PLAYER_ID = 1;

export interface SessionOptions {
  readonly seed: string;
  readonly worldType: WorldType;
  readonly renderDistance: number;
  /** Developer free camera instead of a player body. */
  readonly freecam: FreeCam | null;
  /** Ticks only advance through `step()` (automation). */
  readonly fixedStep: boolean;
  /** Route commands and events through JSON (proves the protocol is network-safe). */
  readonly serialize: boolean;
  readonly allowDebug: boolean;
}

/** One open world: simulation host, player control, streaming, meshing and the fixed-step loop. */
export class GameSession {
  readonly seed: string;
  readonly host: SimHost;
  readonly sim: Simulation;
  readonly scheduler: MeshScheduler;
  readonly rig = new CameraRig();
  readonly entities: EntityView;
  readonly batch: BoxBatch;
  readonly player: PlayerState;
  renderDistance: number;
  loading = true;
  /** performance.now() when the session was created (loading-time measurements). */
  readonly startedAt = performance.now();
  private readonly view: WorldView;
  private readonly input: InputManager;
  private readonly freecam: FreeCam | null;
  private readonly fixedStep: boolean;
  private readonly registry: Registry;
  private readonly events: SimEvent[] = [];
  private acc = 0;
  /** No ticks while paused (Pointer Lock lost); the world still loads and renders. */
  paused = false;

  constructor(
    options: SessionOptions,
    registry: Registry,
    pool: WorkerPool,
    view: WorldView,
    input: InputManager,
  ) {
    this.seed = options.seed;
    this.registry = registry;
    this.view = view;
    this.input = input;
    this.freecam = options.freecam;
    this.fixedStep = options.fixedStep;
    this.renderDistance = options.renderDistance;
    const source = new WorkerColumnSource(pool);
    this.sim = new Simulation({
      seed: options.seed,
      worldType: options.worldType,
      registry,
      source,
      maxInFlight: pool.size * 2,
      allowDebug: options.allowDebug,
    });
    source.connect(this.sim);
    this.player = this.sim.addPlayer(PLAYER_ID, options.renderDistance);
    this.host = options.serialize
      ? new SerializingSimHost(this.sim, PLAYER_ID)
      : new LocalSimHost(this.sim, PLAYER_ID);
    this.scheduler = new MeshScheduler(this.host.view, pool, view.chunks, {
      belowBlock: registry.unknownBlock,
      missingBlock: registry.unknownBlock,
      missingLight: 0,
      air: registry.air,
    });
    this.batch = new BoxBatch(view.materials.uniforms.uTextures.value, view.materials.uniforms);
    view.scene.add(this.batch.mesh);
    this.entities = new EntityView(this.batch, this.sim.world, registry);
    const spawn = this.sim.spawn;
    if (this.freecam)
      this.freecam.set({ x: spawn.x, y: spawn.y + 18, z: spawn.z, yaw: 0, pitch: -0.35 });
    this.sendView();
  }

  get ctx() {
    return this.sim.ctx;
  }

  get spawn(): { x: number; y: number; z: number } {
    return this.sim.spawn;
  }

  /** The point the world streams and meshes around (player feet or free camera). */
  focus(): { x: number; y: number; z: number } {
    if (this.freecam) return this.freecam.pose;
    return this.player.body;
  }

  /** One rendered frame: input, fixed-step ticks, streaming, meshing, camera and entities. */
  frame(dt: number): CameraPose {
    if (this.freecam) this.freecam.update(dt);
    else {
      this.input.applyMouseLook(this.rig);
      if (this.input.consume('camera')) this.rig.toggleMode();
    }
    // While paused the accumulator is frozen, so the view stays where it was.
    if (!this.paused && !this.fixedStep) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= TICK && steps < MAX_STEPS) {
        this.tick();
        this.acc -= TICK;
        steps++;
      }
      if (steps === MAX_STEPS) this.acc = 0;
    }
    // A teleport or a far respawn lands in an unlit column: load around it behind the overlay.
    if (!this.loading && !this.freecam && !this.playerColumnLit()) this.loading = true;
    if (this.loading)
      this.host.pumpWorld({ columns: INTEGRATE_PER_TICK * LOADING_FACTOR }, this.events);
    // Fixed-step sessions only tick on request; keep the world streaming meanwhile.
    else if (this.fixedStep || this.paused)
      this.host.pumpWorld({ columns: INTEGRATE_PER_TICK }, this.events);
    this.flushEvents();
    const focus = this.focus();
    this.scheduler.update(focus.x, focus.y, focus.z, this.loading ? LOADING_BUDGETS : PLAY_BUDGETS);
    if (this.loading && this.chunksReady(this.loadingRadius())) this.loading = false;
    return this.render(dt);
  }

  /** Advances `n` ticks right now (fixed-step automation). */
  step(n: number): void {
    for (let i = 0; i < n; i++) this.tick();
    this.flushEvents();
    const focus = this.focus();
    this.scheduler.update(focus.x, focus.y, focus.z, LOADING_BUDGETS);
  }

  /**
   * Steps the world without rendering (hidden pane, automation). Fixed-step sessions only stream:
   * their ticks are advanced explicitly, so the tick count stays deterministic.
   */
  pumpOnce(): void {
    if (!this.fixedStep && !this.paused) this.tick();
    this.host.pumpWorld({ columns: INTEGRATE_PER_TICK * LOADING_FACTOR }, this.events);
    this.flushEvents();
    const focus = this.focus();
    this.scheduler.update(focus.x, focus.y, focus.z, LOADING_BUDGETS);
    if (this.loading && this.chunksReady(this.loadingRadius())) this.loading = false;
  }

  /** Radius that ends the loading screen: 3 columns, or less at a smaller render distance. */
  loadingRadius(): number {
    return Math.min(LOADING_RADIUS, this.renderDistance);
  }

  setRenderDistance(renderDistance: number): void {
    this.renderDistance = renderDistance;
    this.view.setRenderDistance(renderDistance);
    this.sendView();
  }

  /** The player's column is lit, so the player is simulated (not frozen). */
  playerColumnLit(): boolean {
    const b = this.player.body;
    return this.sim.columnState(toColumn(Math.floor(b.x)), toColumn(Math.floor(b.z))) >= COLUMN_LIT;
  }

  /** Every column within `radius` of the focus is meshable and its sections are uploaded. */
  chunksReady(radius: number): boolean {
    const focus = this.focus();
    const ccx = toColumn(Math.floor(focus.x));
    const ccz = toColumn(Math.floor(focus.z));
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        if (this.sim.columnState(ccx + dx, ccz + dz) !== COLUMN_MESHABLE) return false;
        for (let sy = 0; sy < SECTIONS_PER_COLUMN; sy++) {
          if (this.scheduler.busy(sectionKey(ccx + dx, sy, ccz + dz))) return false;
        }
      }
    }
    return true;
  }

  private tick(): void {
    this.sendView();
    if (!this.freecam) this.host.send(this.input.sample(this.rig));
    this.host.advance(1, this.events);
    this.input.tickForced();
  }

  private render(dt: number): CameraPose {
    if (this.freecam) return this.freecam.pose;
    const alpha = this.fixedStep ? 1 : Math.min(1, this.acc / TICK);
    const pose = this.rig.update(this.player, alpha, this.sim.world, this.registry.tables, dt);
    this.batch.begin(
      Math.floor(pose.x / 32) * 32,
      Math.floor(pose.y / 32) * 32,
      Math.floor(pose.z / 32) * 32,
    );
    // Hidden when the camera is pressed against the avatar (back to a wall): no view of the hood.
    const visible = this.rig.mode === 'third' && this.rig.distance >= AVATAR_MIN_DISTANCE;
    this.entities.drawPlayer(this.player, alpha, dt, visible);
    this.batch.end();
    return pose;
  }

  private sendView(): void {
    const focus = this.focus();
    this.host.send({
      type: 'client.view',
      x: focus.x,
      z: focus.z,
      radius: this.renderDistance,
      detached: this.freecam !== null,
    });
  }

  private flushEvents(): void {
    for (const event of this.events) this.scheduler.onEvent(event);
    this.events.length = 0;
  }
}

const PLAY_BUDGETS = {
  maxInFlight: 8,
  dispatchPerFrame: 4,
  uploadsPerFrame: 8,
  uploadBytesPerFrame: 1 << 20,
};
const LOADING_BUDGETS = {
  maxInFlight: 16,
  dispatchPerFrame: 16,
  uploadsPerFrame: 48,
  uploadBytesPerFrame: 8 << 20,
};
