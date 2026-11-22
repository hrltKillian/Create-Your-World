import type { Registry } from '../content/registry.ts';
import { WorkerColumnSource } from '../platform/WorkerColumnSource.ts';
import type { WorkerPool } from '../platform/WorkerPool.ts';
import { MeshScheduler } from '../render/MeshScheduler.ts';
import type { WorldView } from '../render/WorldView.ts';
import type { SimEvent } from '../sim/events.ts';
import { LocalSimHost } from '../sim/host.ts';
import {
  COLUMN_MESHABLE,
  INTEGRATE_PER_TICK,
  LOADING_FACTOR,
  Simulation,
  TICKS_PER_SECOND,
} from '../sim/Simulation.ts';
import { SECTIONS_PER_COLUMN, sectionKey, toColumn } from '../world/coords.ts';
import { createGenContext, findSpawn, type GenContext } from '../world/gen/generateColumn.ts';
import type { FreeCam } from './FreeCam.ts';

const TICK = 1 / TICKS_PER_SECOND;
const MAX_STEPS = 4;
/** Radius (columns) that must be meshed before the loading screen goes away. */
export const LOADING_RADIUS = 3;

/** One open world: simulation host, streaming, meshing and the fixed-step loop. */
export class GameSession {
  readonly seed: string;
  readonly host: LocalSimHost;
  readonly sim: Simulation;
  readonly scheduler: MeshScheduler;
  readonly ctx: GenContext;
  readonly spawn: { x: number; y: number; z: number };
  renderDistance: number;
  loading = true;
  private readonly view: WorldView;
  private readonly freecam: FreeCam;
  private readonly events: SimEvent[] = [];
  private acc = 0;

  constructor(
    seed: string,
    registry: Registry,
    pool: WorkerPool,
    view: WorldView,
    freecam: FreeCam,
    renderDistance: number,
  ) {
    this.seed = seed;
    this.view = view;
    this.freecam = freecam;
    this.renderDistance = renderDistance;
    this.ctx = createGenContext(seed, registry);
    this.spawn = findSpawn(this.ctx);
    const source = new WorkerColumnSource(pool);
    this.sim = new Simulation({ seed, registry, source, maxInFlight: pool.size * 2 });
    source.connect(this.sim);
    this.host = new LocalSimHost(this.sim);
    this.scheduler = new MeshScheduler(this.host.view, pool, view.chunks, {
      belowBlock: registry.unknownBlock,
      missingBlock: registry.unknownBlock,
      missingLight: 0,
      air: registry.air,
    });
    freecam.set({ x: this.spawn.x, y: this.spawn.y + 18, z: this.spawn.z, yaw: 0, pitch: -0.35 });
    this.sendView();
  }

  /** One rendered frame: fixed-step ticks, streaming, meshing. */
  frame(dt: number): void {
    this.freecam.update(dt);
    this.acc += dt;
    let steps = 0;
    while (this.acc >= TICK && steps < MAX_STEPS) {
      this.sendView();
      this.host.advance(1, this.events);
      this.acc -= TICK;
      steps++;
    }
    if (steps === MAX_STEPS) this.acc = 0;
    if (this.loading)
      this.host.pumpWorld({ columns: INTEGRATE_PER_TICK * LOADING_FACTOR }, this.events);
    this.flushEvents();
    const pose = this.freecam.pose;
    this.scheduler.update(pose.x, pose.y, pose.z, this.loading ? LOADING_BUDGETS : PLAY_BUDGETS);
    if (this.loading && this.chunksReady(LOADING_RADIUS)) this.loading = false;
  }

  /** Steps the world without rendering (hidden pane, automation). */
  pumpOnce(): void {
    this.sendView();
    this.host.advance(1, this.events);
    this.host.pumpWorld({ columns: INTEGRATE_PER_TICK * LOADING_FACTOR }, this.events);
    this.flushEvents();
    const pose = this.freecam.pose;
    this.scheduler.update(pose.x, pose.y, pose.z, LOADING_BUDGETS);
    if (this.loading && this.chunksReady(LOADING_RADIUS)) this.loading = false;
  }

  setRenderDistance(renderDistance: number): void {
    this.renderDistance = renderDistance;
    this.view.setRenderDistance(renderDistance);
    this.sendView();
  }

  /** Every column within `radius` of the camera is meshable and its sections are uploaded. */
  chunksReady(radius: number): boolean {
    const pose = this.freecam.pose;
    const ccx = toColumn(Math.floor(pose.x));
    const ccz = toColumn(Math.floor(pose.z));
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

  private sendView(): void {
    const pose = this.freecam.pose;
    this.host.send({ type: 'client.view', x: pose.x, z: pose.z, radius: this.renderDistance });
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
