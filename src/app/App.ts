import { generatePackTexture } from '../assets/procedural/patterns.ts';
import { basePack } from '../content/packs/base/index.ts';
import { buildRegistry, type Registry } from '../content/registry.ts';
import type { ContentPack } from '../content/schema.ts';
import { setLogSink } from '../core/log.ts';
import { fmtBytes, fmtNumber } from '../i18n/fmt.ts';
import { addStrings, t } from '../i18n/i18n.ts';
import { type CapabilityReport, detectCapabilities } from '../platform/capabilities.ts';
import { WorkerPool, workerCount } from '../platform/WorkerPool.ts';
import { Renderer } from '../render/Renderer.ts';
import { TitleScene } from '../render/TitleScene.ts';
import { createTextureArray } from '../render/textureArray.ts';
import { DEBUG_VIEWS, type DebugView } from '../render/voxelMaterial.ts';
import { WorldView } from '../render/WorldView.ts';
import { DebugOverlay } from '../ui/debug/DebugOverlay.ts';
import { fatalScreen } from '../ui/screens/fatal.ts';
import { hintBar } from '../ui/screens/hint.ts';
import { loadingScreen } from '../ui/screens/loading.ts';
import { titleOverlay } from '../ui/screens/title.ts';
import { unsupportedScreen } from '../ui/screens/unsupported.ts';
import { sectionKey, toColumn, toLocal } from '../world/coords.ts';
import { buildTestScene, TEST_SCENE_SURFACE } from '../world/gen/testScene.ts';
import { meshSection } from '../world/mesh/greedyMesher.ts';
import { createPadded, fillPadded } from '../world/mesh/padded.ts';
import { VoxelWorld } from '../world/VoxelWorld.ts';
import { type BootParams, parseBootParams } from './bootParams.ts';
import { FreeCam } from './FreeCam.ts';
import { GameSession } from './GameSession.ts';
import { FrameStats } from './perf.ts';

export const MILESTONE = 2;

export type AppState =
  | 'boot'
  | 'unsupported'
  | 'fatal'
  | 'title'
  | 'testchunk'
  | 'loading'
  | 'world';

/** Errors kept for `__game.errors()`; later ones are only counted. */
const MAX_ERRORS = 100;
const DEBUG_KEYS = new Set(['F3', 'Backquote', 'IntlBackslash']);
const RENDER_DISTANCE = 6;
/** Drawing buffer used by benchmarks (a 13-inch laptop at DPR 1.5), independent of the pane. */
const BENCH_BUFFER = [2160, 1350] as const;

/** Composition root: capability gate, content, renderer, workers, screens and the frame loop. */
export class App {
  state: AppState = 'boot';
  readonly params: BootParams;
  readonly frames = new FrameStats();
  readonly errors: string[] = [];
  droppedErrors = 0;
  capabilities: CapabilityReport | null = null;
  renderer: Renderer | null = null;
  workers: WorkerPool | null = null;
  registry: Registry | null = null;
  world: VoxelWorld | null = null;
  view: WorldView | null = null;
  freecam: FreeCam | null = null;
  overlay: DebugOverlay | null = null;
  session: GameSession | null = null;
  debugView: DebugView = 'none';

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
      this.registry = buildRegistry(basePack);
      addStrings(basePack.strings);
      this.workers = new WorkerPool(workerCount(navigator.hardwareConcurrency));
      this.renderer = new Renderer(this.root, {
        maxPixelRatio: 1.5,
        fixedBuffer: this.params.bench ? BENCH_BUFFER : undefined,
      });
      if (this.params.scene === 'title') this.startTitle(report);
      else if (this.params.scene === 'testchunk') this.startTestScene(this.registry);
      else this.startWorld(this.registry);
    } catch (error) {
      this.fail(error);
    }
  }

  fail(error: unknown): void {
    if (this.state === 'fatal') return;
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    this.recordError(detail);
    this.state = 'fatal';
    this.renderer?.webgl.setAnimationLoop(null);
    this.root.replaceChildren(fatalScreen(detail));
    this.rejectReady(error);
  }

  recordError(message: string): void {
    if (this.errors.length < MAX_ERRORS) this.errors.push(message);
    else this.droppedErrors++;
  }

  setDebugView(view: DebugView): void {
    this.debugView = view;
    this.view?.setDebugView(view);
  }

  /** Meshes every non-empty section of the loaded world on the main thread (M1; workers in M2). */
  meshWorld(): void {
    const { world, registry, view } = this;
    if (!world || !registry || !view) return;
    const padded = createPadded();
    const fill = {
      belowBlock: registry.unknownBlock,
      missingBlock: registry.air,
      missingLight: 0xf0,
      air: registry.air,
    };
    for (const column of world.columns.values()) {
      column.sections.forEach((section, sy) => {
        const key = sectionKey(column.cx, sy, column.cz);
        if (section.isEmpty(registry.air)) {
          view.chunks.remove(key);
          return;
        }
        fillPadded(world, column.cx, sy, column.cz, fill, padded);
        view.chunks.update(
          key,
          column.cx * 32,
          sy * 32,
          column.cz * 32,
          meshSection(padded, registry.tables),
        );
      });
    }
  }

  private startTitle(report: CapabilityReport): void {
    const renderer = this.renderer!;
    const title = new TitleScene(renderer);
    this.root.append(titleOverlay(MILESTONE, report.touchOnly));
    this.state = 'title';
    this.runLoop((dt) => title.frame(dt));
  }

  private createWorldView(
    pack: ContentPack,
    tints: readonly string[],
    renderDistance: number,
  ): WorldView {
    const size = pack.manifest.textureSize;
    const textures = createTextureArray(
      pack.textures.map((def) => generatePackTexture(def, size)),
      size,
    );
    return new WorldView(this.renderer!, textures, tints, renderDistance);
  }

  /** Default mode: an endless generated world explored with the free camera (M2). */
  private startWorld(registry: Registry): void {
    const renderer = this.renderer!;
    const pack = registry.pack;
    const renderDistance = this.params.rd ?? RENDER_DISTANCE;
    const view = this.createWorldView(pack, biomeTints(pack), renderDistance);
    this.view = view;
    const freecam = new FreeCam(
      renderer.webgl.domElement,
      { x: 0, y: 100, z: 0, yaw: 0, pitch: 0 },
      !this.params.noLock,
    );
    this.freecam = freecam;
    const seed = this.params.seed ?? Math.floor(Math.random() * 1e9).toString(36);
    const session = new GameSession(seed, registry, this.workers!, view, freecam, renderDistance);
    this.session = session;
    this.world = session.sim.world;
    const overlay = new DebugOverlay(this.params.debug);
    this.overlay = overlay;
    const loading = loadingScreen();
    this.root.append(overlay.element, loading, hintBar('hint.freecam'));
    this.installDebugToggle(overlay);
    this.state = 'loading';
    const requested = this.params.view as DebugView | null;
    if (requested && DEBUG_VIEWS.includes(requested)) this.setDebugView(requested);

    let sinceOverlay = 0;
    this.runLoop((dt) => {
      const t0 = performance.now();
      session.frame(dt);
      const t1 = performance.now();
      view.setPose(freecam.pose);
      view.frame(dt);
      this.frames.span('world', t1 - t0);
      this.frames.span('render', performance.now() - t1);
      if (this.state === 'loading' && !session.loading) {
        this.state = 'world';
        loading.remove();
      }
      sinceOverlay += dt;
      if (sinceOverlay >= 0.25) {
        sinceOverlay = 0;
        this.refreshOverlay();
      }
    });
  }

  private installDebugToggle(overlay: DebugOverlay): void {
    window.addEventListener('keydown', (event) => {
      if (DEBUG_KEYS.has(event.code)) {
        event.preventDefault();
        overlay.toggle();
      }
    });
  }

  private startTestScene(registry: Registry): void {
    const renderer = this.renderer!;
    const pack = registry.pack;
    const tints = ['#ffffff', pack.tints.grass, pack.tints.foliage, pack.tints.water];
    const view = this.createWorldView(pack, tints, RENDER_DISTANCE);
    this.view = view;
    const world = new VoxelWorld(registry.air, registry.unknownBlock);
    this.world = world;
    buildTestScene(world, registry);
    this.meshWorld();
    const requested = this.params.view as DebugView | null;
    if (requested && DEBUG_VIEWS.includes(requested)) this.setDebugView(requested);

    const freecam = new FreeCam(
      renderer.webgl.domElement,
      { x: 0, y: TEST_SCENE_SURFACE + 9, z: 14, yaw: 0, pitch: -0.42 },
      !this.params.noLock,
    );
    this.freecam = freecam;
    const overlay = new DebugOverlay(this.params.debug);
    this.overlay = overlay;
    this.root.append(overlay.element, hintBar('hint.freecam'));
    this.installDebugToggle(overlay);
    this.state = 'testchunk';

    let sinceOverlay = 0;
    this.runLoop((dt) => {
      freecam.update(dt);
      view.setPose(freecam.pose);
      view.frame(dt);
      sinceOverlay += dt;
      if (sinceOverlay >= 0.25) {
        sinceOverlay = 0;
        this.refreshOverlay();
      }
    });
  }

  private refreshOverlay(): void {
    const { overlay, view, freecam, world } = this;
    if (!overlay?.isVisible() || !view || !freecam || !world) return;
    const info = this.renderer!.webgl.info;
    const snap = this.frames.snapshot();
    const chunks = view.chunks.stats();
    const pose = freecam.pose;
    const yawDeg = ((((-pose.yaw * 180) / Math.PI) % 360) + 360) % 360;
    overlay.setLines([
      { label: 'debug.fps', value: fmtNumber(snap.fps) },
      { label: 'debug.frame', value: `${fmtNumber(snap.workP95, 2)} ms` },
      { label: 'debug.draws', value: fmtNumber(info.render.calls) },
      { label: 'debug.triangles', value: fmtNumber(info.render.triangles) },
      { label: 'debug.sections', value: fmtNumber(chunks.sections) },
      { label: 'debug.quads', value: fmtNumber(chunks.quads) },
      { label: 'debug.geometry', value: fmtBytes(chunks.geometryBytes) },
      { label: 'debug.voxels', value: fmtBytes(world.voxelBytes()) },
      {
        label: 'debug.position',
        value: `${fmtNumber(pose.x, 1)} ${fmtNumber(pose.y, 1)} ${fmtNumber(pose.z, 1)}`,
      },
      { label: 'debug.facing', value: `${fmtNumber(yawDeg)}°` },
      { label: 'debug.view', value: this.debugView },
      ...this.worldLines(pose.x, pose.z),
    ]);
  }

  private worldLines(x: number, z: number): { label: string; value: string }[] {
    const session = this.session;
    if (!session || !this.registry || !this.world) return [];
    const column = this.world.getColumn(toColumn(Math.floor(x)), toColumn(Math.floor(z)));
    const sorted = [...(this.registry.pack.biomes ?? [])].sort((a, b) => a.order - b.order);
    const biome = column
      ? sorted[column.biomes[toLocal(Math.floor(x)) | (toLocal(Math.floor(z)) << 5)]!]
      : undefined;
    const mesh = session.scheduler.stats();
    const pool = this.workers?.stats();
    return [
      { label: 'debug.seed', value: session.seed },
      { label: 'debug.biome', value: biome ? t(biome.nameKey) : '—' },
      { label: 'debug.columns', value: fmtNumber(this.world.columns.size) },
      { label: 'debug.meshQueue', value: `${mesh.pending} / ${mesh.inFlight}` },
      {
        label: 'debug.workerTimes',
        value: pool
          ? `${fmtNumber(pool.meanMs.gen, 1)} / ${fmtNumber(pool.meanMs.mesh, 1)} ms`
          : '—',
      },
    ];
  }

  private runLoop(frame: (dt: number) => void): void {
    const renderer = this.renderer!;
    let firstFrame = true;
    let last = -1;
    renderer.webgl.setAnimationLoop((now: number) => {
      try {
        this.frames.frameStart(now);
        const dt = last < 0 ? 0 : Math.min(now - last, 250) / 1000;
        last = now;
        frame(dt);
        this.frames.frameEnd();
        if (firstFrame) {
          firstFrame = false;
          this.resolveReady();
        }
      } catch (error) {
        // three schedules the next frame before calling us: stop the loop and show the error once.
        this.fail(error);
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

/** Tint table of the voxel shader: slot 0 = no tint, then grass/foliage/water per biome (by order). */
export function biomeTints(pack: ContentPack): string[] {
  const out = ['#ffffff'];
  const biomes = [...(pack.biomes ?? [])].sort((a, b) => a.order - b.order);
  if (biomes.length === 0) return [...out, pack.tints.grass, pack.tints.foliage, pack.tints.water];
  for (const biome of biomes) out.push(biome.tints.grass, biome.tints.foliage, biome.tints.water);
  return out;
}
