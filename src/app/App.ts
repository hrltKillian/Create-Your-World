import { setLogSink } from '../core/log.ts';
import { type CapabilityReport, detectCapabilities } from '../platform/capabilities.ts';
import { WorkerPool, workerCount } from '../platform/WorkerPool.ts';
import { Renderer } from '../render/Renderer.ts';
import { TitleScene } from '../render/TitleScene.ts';
import { fatalScreen } from '../ui/screens/fatal.ts';
import { titleOverlay } from '../ui/screens/title.ts';
import { unsupportedScreen } from '../ui/screens/unsupported.ts';
import { type BootParams, parseBootParams } from './bootParams.ts';
import { FrameStats } from './perf.ts';

export const MILESTONE = 0;

export type AppState = 'boot' | 'unsupported' | 'fatal' | 'title';

/** Composition root: capability gate, renderer, workers, screens and the frame loop. */
export class App {
  state: AppState = 'boot';
  readonly params: BootParams;
  readonly frames = new FrameStats();
  readonly errors: string[] = [];
  capabilities: CapabilityReport | null = null;
  renderer: Renderer | null = null;
  workers: WorkerPool | null = null;

  private readonly root: HTMLElement;
  private readonly readyPromise: Promise<void>;
  private resolveReady: () => void = () => {};
  private rejectReady: (error: unknown) => void = () => {};

  constructor(root: HTMLElement, search: string) {
    this.root = root;
    this.params = parseBootParams(search, __DEBUG_HOOK__);
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // Avoid an unhandled rejection when nobody awaits ready().
    this.readyPromise.catch(() => {});
    this.installErrorCapture();
  }

  /** Resolves once the first frame has been rendered (or rejects on a boot failure). */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  async start(): Promise<void> {
    try {
      const report = detectCapabilities({ forceNoWebGL: this.params.forceNoWebGL });
      this.capabilities = report;
      if (!report.ok) {
        this.state = 'unsupported';
        this.root.replaceChildren(unsupportedScreen(report.missing));
        this.resolveReady();
        return;
      }
      this.workers = new WorkerPool(workerCount(navigator.hardwareConcurrency));
      this.startScene(report);
    } catch (error) {
      this.fail(error);
    }
  }

  fail(error: unknown): void {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    this.recordError(detail);
    this.state = 'fatal';
    this.renderer?.webgl.setAnimationLoop(null);
    this.root.replaceChildren(fatalScreen(detail));
    this.rejectReady(error);
  }

  recordError(message: string): void {
    this.errors.push(message);
  }

  private startScene(report: CapabilityReport): void {
    const renderer = new Renderer(this.root, { maxPixelRatio: 1.5 });
    this.renderer = renderer;
    const title = new TitleScene(renderer);
    this.root.append(titleOverlay(MILESTONE, report.touchOnly));
    this.state = 'title';

    let firstFrame = true;
    let last = -1;
    renderer.webgl.setAnimationLoop((now: number) => {
      this.frames.frameStart(now);
      const dt = last < 0 ? 0 : Math.min(now - last, 250) / 1000;
      last = now;
      title.frame(dt);
      this.frames.frameEnd();
      if (firstFrame) {
        firstFrame = false;
        this.resolveReady();
      }
    });

    document.addEventListener('visibilitychange', () => {
      last = -1;
      this.frames.resetClock();
    });
  }

  private installErrorCapture(): void {
    setLogSink((level, scope, message, data) => {
      const line = `[${scope}] ${message}`;
      if (level === 'error') {
        this.recordError(line);
        console.error(line, data ?? '');
      } else if (level === 'warn') {
        console.warn(line, data ?? '');
      } else if (this.params.debug) {
        console.info(line, data ?? '');
      }
    });
    window.addEventListener('error', (event) => {
      this.recordError(
        event.error instanceof Error ? (event.error.stack ?? event.message) : event.message,
      );
    });
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      this.recordError(reason instanceof Error ? (reason.stack ?? reason.message) : String(reason));
    });
  }
}
