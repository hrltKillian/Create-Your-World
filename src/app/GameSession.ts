import type { Registry } from '../content/registry.ts';
import { clampPitch } from '../core/angles.ts';
import type { InputManager } from '../input/InputManager.ts';
import type { WorkerPool } from '../platform/WorkerPool.ts';
import { CameraRig } from '../render/CameraRig.ts';
import type { EntityView } from '../render/EntityView.ts';
import { type MeshBudgets, MeshScheduler } from '../render/MeshScheduler.ts';
import { type PlayFrame, PlayView } from '../render/PlayView.ts';
import type { CameraPose, WorldView } from '../render/WorldView.ts';
import { COLUMN_LIT, COLUMN_MESHABLE } from '../sim/ColumnPipeline.ts';
import { TICK_SECONDS } from '../sim/clock.ts';
import { isLiquid } from '../sim/collision.ts';
import { NEUTRAL_INPUT } from '../sim/commands.ts';
import type { SimEvent } from '../sim/events.ts';
import type { SimHost } from '../sim/host.ts';
import type { PlayerState } from '../sim/player.ts';
import { INTEGRATE_PER_TICK, LOADING_FACTOR } from '../sim/Simulation.ts';
import { daylightAt, hourOf } from '../sim/time.ts';
import { blockToColumn, SECTIONS_PER_COLUMN, sectionKey } from '../world/coords.ts';
import { ClientAim } from './ClientAim.ts';
import type { FreeCam } from './FreeCam.ts';

const MAX_STEPS = 4;
/** Closest third-person camera distance (m) at which the avatar is still drawn. */
const AVATAR_MIN_DISTANCE = 0.6;
/** Radius (columns) that must be meshed before the loading screen goes away. */
export const LOADING_RADIUS = 3;

export interface SessionOptions {
  readonly renderDistance: number;
  /** Developer free camera instead of a player body. */
  readonly freecam: FreeCam | null;
  /** Ticks only advance through `step()` (automation). */
  readonly fixedStep: boolean;
}

/**
 * One open world as the client plays it: the simulation host (whose local player it drives),
 * player control, streaming, meshing and the fixed-step loop.
 */
export class GameSession {
  readonly seed: string;
  readonly host: SimHost;
  readonly scheduler: MeshScheduler;
  readonly rig = new CameraRig();
  /** Avatar, drops, particles, block overlays and the hand view. */
  readonly play: PlayView;
  readonly entities: EntityView;
  /** The block under the crosshair and the placement ghost, from the client's eye. */
  readonly aim: ClientAim;
  /** The local player's live (read-only) state, from the host's view. */
  readonly player: Readonly<PlayerState>;
  renderDistance: number;
  loading = true;
  /** performance.now() when the session was created (loading-time measurements). */
  readonly startedAt = performance.now();
  /** Wall time of the last simulation tick alone, in ms (the mobs benchmark). */
  tickMs = 0;
  private readonly view: WorldView;
  private readonly input: InputManager;
  private readonly freecam: FreeCam | null;
  private readonly fixedStep: boolean;
  private readonly registry: Registry;
  private readonly events: SimEvent[] = [];
  /** Reused every frame (no allocation). */
  private readonly playFrame: { -readonly [K in keyof PlayFrame]: PlayFrame[K] };
  private acc = 0;
  /** Column and radius of the last view sent to the host. */
  private sentCx = Number.NaN;
  private sentCz = Number.NaN;
  private sentRadius = Number.NaN;
  /** No ticks while paused (Pointer Lock lost); the world still loads and renders. */
  private paused = false;
  /** Client systems that react to the simulation's events besides rendering (UI, audio). */
  readonly listeners: ((event: SimEvent) => void)[] = [];

  constructor(
    options: SessionOptions,
    host: SimHost,
    pool: WorkerPool,
    view: WorldView,
    input: InputManager,
  ) {
    const registry = host.view.registry;
    this.host = host;
    this.seed = host.view.seed;
    this.registry = registry;
    this.view = view;
    this.input = input;
    this.freecam = options.freecam;
    this.fixedStep = options.fixedStep;
    this.renderDistance = options.renderDistance;
    this.player = host.view.player()!;
    this.scheduler = new MeshScheduler(this.host.view, pool, view.chunks, {
      belowBlock: registry.unknownBlock,
      missingBlock: registry.unknownBlock,
      missingLight: 0,
      air: registry.air,
    });
    this.play = new PlayView(view, this.host.view);
    this.entities = this.play.entities;
    this.aim = new ClientAim(this.host.view.world, registry, this.player);
    // Puts the eye at the spawn before the first frame, so the first ticks aim from there.
    this.rig.update(this.player, 1, this.host.view.world, registry.tables, 0);
    this.playFrame = {
      player: this.player,
      alpha: 1,
      dt: 0,
      pose: this.rig.pose,
      eye: this.rig.eye,
      firstPerson: true,
      avatarVisible: false,
      targets: this.aim,
    };
    const spawn = this.host.view.spawn;
    if (this.freecam)
      this.freecam.set({ x: spawn.x, y: spawn.y + 18, z: spawn.z, yaw: 0, pitch: -0.35 });
    this.sendView();
  }

  /**
   * Stops or restarts the ticks. Pausing also sends a neutral input (same view and slot): the
   * simulation applies commands without ticking, so nothing it holds (primary for the strike poses,
   * secondary) stays pressed while paused.
   */
  setPaused(paused: boolean): void {
    if (paused && !this.paused) {
      const rig = this.rig;
      this.host.send({
        ...NEUTRAL_INPUT,
        yaw: rig.yaw,
        pitch: clampPitch(rig.pitch),
        slot: this.input.slot,
      });
    }
    this.paused = paused;
  }

  get spawn(): { readonly x: number; readonly y: number; readonly z: number } {
    return this.host.view.spawn;
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
      // G throws one item of the selected slot, Shift+G the whole stack.
      if (this.input.consume('drop'))
        this.host.send({ type: 'inv.drop', slot: this.input.slot, all: this.input.shiftHeld() });
    }
    // While paused the accumulator is frozen, so the view stays where it was.
    if (!this.paused && !this.fixedStep) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= TICK_SECONDS && steps < MAX_STEPS) {
        this.tick();
        this.acc -= TICK_SECONDS;
        steps++;
      }
      if (steps === MAX_STEPS) this.acc = 0;
    }
    // A teleport or a far respawn lands in an unlit column: load around it behind the overlay.
    if (!this.loading && !this.freecam && !this.playerColumnLit()) this.loading = true;
    if (this.loading)
      this.host.pumpWorld({ columns: INTEGRATE_PER_TICK * LOADING_FACTOR }, this.events);
    // Fixed-step and paused sessions do not tick here; keep the world streaming meanwhile.
    else if (this.fixedStep || this.paused) {
      this.sendViewIfMoved();
      this.host.pumpWorld({ columns: INTEGRATE_PER_TICK }, this.events);
    }
    this.afterTicks(this.loading ? LOADING_BUDGETS : PLAY_BUDGETS, true);
    const pose = this.render(dt);
    this.updateEnvironment(pose);
    return pose;
  }

  /** Advances `n` ticks right now (fixed-step automation). The loading flag is left to frames. */
  step(n: number): void {
    for (let i = 0; i < n; i++) this.tick();
    this.afterTicks(LOADING_BUDGETS, false);
  }

  /**
   * Streams and meshes without rendering (automation while frames stall). With `tick` (pass it
   * only for a hidden page, where frames no longer tick) it also advances one tick; fixed-step and
   * paused sessions never tick here, so their tick count stays deterministic.
   */
  pumpOnce(tick: boolean): void {
    if (tick && !this.fixedStep && !this.paused) this.tick();
    else this.sendViewIfMoved();
    this.host.pumpWorld({ columns: INTEGRATE_PER_TICK * LOADING_FACTOR }, this.events);
    this.afterTicks(LOADING_BUDGETS, true);
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

  /** The world is closed: its meshes and play objects leave the (shared) world view. */
  dispose(): void {
    this.play.dispose();
    this.view.chunks.clear();
  }

  /** The player's column is lit, so the player is simulated (not frozen). */
  playerColumnLit(): boolean {
    const b = this.player.body;
    const state = this.host.view.columnState(blockToColumn(b.x), blockToColumn(b.z));
    return state >= COLUMN_LIT;
  }

  /** Every column within `radius` of the focus is meshable and its sections are uploaded. */
  chunksReady(radius: number): boolean {
    const focus = this.focus();
    const ccx = blockToColumn(focus.x);
    const ccz = blockToColumn(focus.z);
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        if (this.host.view.columnState(ccx + dx, ccz + dz) !== COLUMN_MESHABLE) return false;
        for (let sy = 0; sy < SECTIONS_PER_COLUMN; sy++) {
          if (this.scheduler.busy(sectionKey(ccx + dx, sy, ccz + dz))) return false;
        }
      }
    }
    return true;
  }

  private tick(): void {
    this.sendView();
    if (!this.freecam) {
      // The view may have turned since the last frame (automation steps several ticks at once).
      this.updateAim();
      this.host.send(this.input.sample(this.rig, this.aim.target()));
    }
    const t0 = performance.now();
    this.host.advance(1, this.events);
    this.tickMs = performance.now() - t0;
    this.input.tickForced();
  }

  private render(dt: number): CameraPose {
    if (this.freecam) return this.freecam.pose;
    const alpha = this.fixedStep ? 1 : Math.min(1, this.acc / TICK_SECONDS);
    const pose = this.rig.update(
      this.player,
      alpha,
      this.host.view.world,
      this.registry.tables,
      dt,
    );
    const rig = this.rig;
    this.updateAim();
    const frame = this.playFrame;
    frame.alpha = alpha;
    frame.dt = dt;
    frame.firstPerson = rig.mode === 'first';
    // Hidden when the camera is pressed against the avatar (back to a wall): no view of the hood.
    frame.avatarVisible = rig.mode === 'third' && rig.distance >= AVATAR_MIN_DISTANCE;
    this.play.draw(frame);
    return pose;
  }

  /** Time of day (sky, fog, daylight) and the medium around the camera (underwater fog). */
  private updateEnvironment(pose: CameraPose): void {
    const sim = this.host.view;
    const hour = hourOf(sim.time().ticks);
    this.view.setTime(hour, daylightAt(hour));
    this.view.setUnderwater(isLiquid(sim.world, this.registry.tables, pose.x, pose.y, pose.z));
  }

  /** The block under the crosshair from the interpolated eye, and the placement ghost. */
  private updateAim(): void {
    const rig = this.rig;
    this.aim.update(rig.eye, rig.yaw, rig.pitch, this.input.slot, this.input.isDown('crouch'));
  }

  /** Sends the view only when the focus changed column or the radius changed (no queue growth). */
  private sendViewIfMoved(): void {
    const focus = this.focus();
    const cx = blockToColumn(focus.x);
    const cz = blockToColumn(focus.z);
    if (cx !== this.sentCx || cz !== this.sentCz || this.renderDistance !== this.sentRadius)
      this.sendView();
  }

  private sendView(): void {
    const focus = this.focus();
    this.sentCx = blockToColumn(focus.x);
    this.sentCz = blockToColumn(focus.z);
    this.sentRadius = this.renderDistance;
    this.host.send({
      type: 'client.view',
      x: focus.x,
      z: focus.z,
      radius: this.renderDistance,
      detached: this.freecam !== null,
    });
  }

  /**
   * Common tail of `frame`, `step` and `pumpOnce`: hands the tick events to the mesh scheduler,
   * meshes around the focus and, when `endLoading`, drops the loading flag once the area is ready.
   */
  private afterTicks(budgets: MeshBudgets, endLoading: boolean): void {
    for (const event of this.events) {
      this.scheduler.onEvent(event);
      this.play.onEvent(event);
      for (const listener of this.listeners) listener(event);
    }
    this.events.length = 0;
    const focus = this.focus();
    this.scheduler.update(focus.x, focus.y, focus.z, budgets);
    if (endLoading && this.loading && this.chunksReady(this.loadingRadius())) this.loading = false;
  }
}

const PLAY_BUDGETS: MeshBudgets = {
  maxInFlight: 8,
  dispatchPerFrame: 4,
  uploadsPerFrame: 8,
  uploadBytesPerFrame: 1 << 20,
};
const LOADING_BUDGETS: MeshBudgets = {
  maxInFlight: 16,
  dispatchPerFrame: 16,
  uploadsPerFrame: 48,
  uploadBytesPerFrame: 8 << 20,
};
