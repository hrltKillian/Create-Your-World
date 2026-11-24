import type { MeshBudgets } from '../render/MeshScheduler.ts';

/**
 * Adaptive client throttling (docs « Ralentissement adaptatif »): frame work over 12 ms for 2 s
 * cuts the client's per-frame slices (padded copies and uploads of the mesh scheduler) by 30 %;
 * under 8 ms for 5 s gives back 10 %, up to the nominal budgets. The simulation's budgets never
 * change. The work is smoothed first (an exponential average over about 10 frames), so one odd
 * frame neither starts nor stops a slow or fast stretch.
 */
export const THROTTLE = {
  slowMs: 12,
  slowSeconds: 2,
  down: 0.7,
  fastMs: 8,
  fastSeconds: 5,
  up: 1.1,
  /** Lowest scale: the slices never fall under this share of the nominal ones. */
  minScale: 0.25,
  /** Weight of a new frame in the smoothed work. */
  smoothing: 0.1,
} as const;

export class ClientThrottle {
  /** Share of the nominal client slices in use (minScale…1). */
  scale = 1;
  /** Smoothed frame work (ms). */
  private work = -1;
  private slowFor = 0;
  private fastFor = 0;
  /** The scaled budgets, reused (no allocation per frame). */
  private readonly scaled: { -readonly [K in keyof MeshBudgets]: MeshBudgets[K] } = {
    maxInFlight: 0,
    dispatchPerFrame: 0,
    uploadsPerFrame: 0,
    uploadBytesPerFrame: 0,
  };

  /** One frame's CPU work (ms) and its duration (s). */
  observe(workMs: number, dt: number): void {
    this.work = this.work < 0 ? workMs : this.work + (workMs - this.work) * THROTTLE.smoothing;
    if (this.work > THROTTLE.slowMs) {
      this.fastFor = 0;
      this.slowFor += dt;
      if (this.slowFor >= THROTTLE.slowSeconds) {
        this.slowFor = 0;
        this.scale = Math.max(THROTTLE.minScale, this.scale * THROTTLE.down);
      }
    } else if (this.work < THROTTLE.fastMs) {
      this.slowFor = 0;
      if (this.scale >= 1) return;
      this.fastFor += dt;
      if (this.fastFor >= THROTTLE.fastSeconds) {
        this.fastFor = 0;
        this.scale = Math.min(1, this.scale * THROTTLE.up);
      }
    } else {
      this.slowFor = 0;
      this.fastFor = 0;
    }
  }

  /**
   * The nominal budgets scaled down: copies, uploads and upload bytes per frame (at least one
   * each). Jobs in flight run on the workers, so they keep their nominal number.
   */
  budgets(nominal: MeshBudgets): MeshBudgets {
    if (this.scale >= 1) return nominal;
    const out = this.scaled;
    out.maxInFlight = nominal.maxInFlight;
    out.dispatchPerFrame = Math.max(1, Math.round(nominal.dispatchPerFrame * this.scale));
    out.uploadsPerFrame = Math.max(1, Math.round(nominal.uploadsPerFrame * this.scale));
    out.uploadBytesPerFrame = Math.max(1, Math.round(nominal.uploadBytesPerFrame * this.scale));
    return out;
  }
}
