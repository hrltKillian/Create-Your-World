import { generatePackTexture } from '../assets/procedural/patterns.ts';
import { AudioEngine } from '../audio/AudioEngine.ts';
import { AudioCues } from '../audio/cues.ts';
import { basePack } from '../content/packs/base/index.ts';
import { buildRegistry, type Registry } from '../content/registry.ts';
import type { ContentPack } from '../content/schema.ts';
import { setLogSink } from '../core/log.ts';
import { addStrings } from '../i18n/i18n.ts';
import { DEFAULT_BINDINGS } from '../input/bindings.ts';
import { InputManager } from '../input/InputManager.ts';
import { type CapabilityReport, detectCapabilities } from '../platform/capabilities.ts';
import { WorkerPool, workerCount } from '../platform/WorkerPool.ts';
import { Renderer } from '../render/Renderer.ts';
import { TitleScene } from '../render/TitleScene.ts';
import { createTextureArray } from '../render/textureArray.ts';
import { DEBUG_VIEWS, type DebugView } from '../render/voxelMaterial.ts';
import { WorldView } from '../render/WorldView.ts';
import { DebugOverlay } from '../ui/debug/DebugOverlay.ts';
import { crosshair } from '../ui/hud/crosshair.ts';
import { fatalScreen } from '../ui/screens/fatal.ts';
import { hintBar } from '../ui/screens/hint.ts';
import { loadingScreen } from '../ui/screens/loading.ts';
import { titleOverlay } from '../ui/screens/title.ts';
import { unsupportedScreen } from '../ui/screens/unsupported.ts';
import { buildTestScene, meshTestScene, TEST_SCENE_SURFACE } from '../world/gen/testScene.ts';
import { VoxelWorld } from '../world/VoxelWorld.ts';
import { type BootParams, parseBootParams } from './bootParams.ts';
import { debugLines } from './debugLines.ts';
import { FreeCam } from './FreeCam.ts';
import { GameSession } from './GameSession.ts';
import { InventoryUi } from './inventoryUi.ts';
import { FrameStats } from './perf.ts';
import { PlayGate } from './playGate.ts';

export const MILESTONE = 4;

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
const DEBUG_KEYS: ReadonlySet<string> = new Set(DEFAULT_BINDINGS.debug);
/** Seconds between two refreshes of the debug overlay. */
const OVERLAY_REFRESH = 0.25;
const RENDER_DISTANCE = 6;
/** Tint slot 0 of the voxel shader: untinted. */
const NO_TINT = '#ffffff';
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
  input: InputManager | null = null;
  audio: AudioEngine | null = null;
  /** Hotbar and bag of the play session (none with the free camera). */
  inventory: InventoryUi | null = null;
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
      this.workers.onFatal = (reason) => this.fail(new Error(reason));
      this.renderer = new Renderer(this.root, {
        maxPixelRatio: 1.5,
        // The bench build always renders at a fixed size so fill cost does not depend on the pane.
        fixedBuffer: __BENCH__ || this.params.bench ? BENCH_BUFFER : undefined,
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

  private startTitle(report: CapabilityReport): void {
    const renderer = this.renderer!;
    const title = new TitleScene(renderer);
    this.root.append(titleOverlay(MILESTONE, report.touchOnly));
    this.state = 'title';
    this.runLoop((dt) => title.frame(dt));
  }

  /** `layers`: the pack's textures (RGBA bytes, see `packLayers`). */
  private createWorldView(
    pack: ContentPack,
    layers: readonly Uint8Array[],
    tints: readonly string[],
    renderDistance: number,
  ): WorldView {
    const textures = createTextureArray(layers, pack.manifest.textureSize);
    return new WorldView(this.renderer!, textures, tints, renderDistance);
  }

  /** The sound engine: recipes pre-rendered now, the AudioContext made or resumed on a click. */
  private createAudio(pack: ContentPack): AudioEngine {
    const audio = new AudioEngine(pack.sfx ?? [], { muted: this.params.mute });
    this.audio = audio;
    audio.prerender().catch((error: unknown) => this.recordError(`[audio] ${String(error)}`));
    window.addEventListener('pointerdown', () => audio.resume());
    // « Onglet caché »: silent while hidden; shown again, a context made by a click resumes.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) audio.suspend();
      else if (audio.state() !== 'idle') audio.resume();
    });
    return audio;
  }

  /** Default mode: an endless generated world, explored on foot (or with ?freecam=1). */
  private startWorld(registry: Registry): void {
    const pack = registry.pack;
    const renderDistance = this.params.rd ?? RENDER_DISTANCE;
    const layers = packLayers(pack);
    const view = this.createWorldView(pack, layers, biomeTints(pack), renderDistance);
    this.view = view;
    const input = this.createInput();
    const layoutLoaded = input.labels.loadLayoutMap(
      (navigator as Navigator & { keyboard?: KeyboardLayoutSource }).keyboard,
    );
    const freecam = this.params.freecam
      ? new FreeCam(input, { x: 0, y: 100, z: 0, yaw: 0, pitch: 0 })
      : null;
    this.freecam = freecam;
    const seed = this.params.seed ?? Math.floor(Math.random() * 1e9).toString(36);
    const session = new GameSession(
      {
        seed,
        worldType: this.params.worldType,
        renderDistance,
        freecam,
        fixedStep: this.params.fixedStep,
        serialize: this.params.host === 'serialize',
        allowDebug: __DEBUG_HOOK__,
      },
      registry,
      this.workers!,
      view,
      input,
    );
    this.session = session;
    this.world = session.host.view.world;
    // The session's play objects (overlays, hand view) are in place: compile while loading.
    view.precompile().catch((error: unknown) => this.recordError(`[render] ${String(error)}`));
    const audio = this.createAudio(pack);
    // The ear starts at the spawn eye (then follows the camera every frame).
    const eye = session.rig.pose;
    audio.setListener(eye.x, eye.y, eye.z, eye.yaw, eye.pitch);
    const cues = new AudioCues(audio, pack.sounds?.pickup);
    session.listeners.push((event) => cues.onEvent(event));
    const overlay = this.mountDebug();
    const loading = loadingScreen();
    const cross = crosshair();
    this.root.append(cross, overlay.element, loading);
    if (freecam) this.root.append(hintBar('hint.freecam'));
    else {
      // The free camera flies without the click-to-play pause, the hotbar or the bag.
      const gate = new PlayGate(this.root, input, session, layoutLoaded);
      this.inventory = new InventoryUi(this.root, registry, layers, session, input, gate, audio);
    }
    const inventory = this.inventory;
    this.state = 'loading';

    this.runSceneLoop((dt) => {
      const t0 = performance.now();
      const pose = session.frame(dt);
      const t1 = performance.now();
      view.setPose(pose);
      view.frame(dt);
      inventory?.bridge.frame(dt);
      audio.setListener(pose.x, pose.y, pose.z, pose.yaw, pose.pitch);
      cross.classList.toggle('hidden', session.rig.mode === 'third' || freecam !== null);
      this.frames.span('world', t1 - t0);
      this.frames.span('render', performance.now() - t1);
      if (session.loading !== (this.state === 'loading')) {
        this.state = session.loading ? 'loading' : 'world';
        loading.hidden = !session.loading;
      }
    });
  }

  /** Developer test scene (M1): a fixed hand-built area, meshed once, seen from a free camera. */
  private startTestScene(registry: Registry): void {
    const pack = registry.pack;
    const view = this.createWorldView(pack, packLayers(pack), packTints(pack), RENDER_DISTANCE);
    this.view = view;
    const world = new VoxelWorld(registry.air, registry.unknownBlock);
    this.world = world;
    buildTestScene(world, registry);
    meshTestScene(world, registry, view.chunks);
    const freecam = new FreeCam(this.createInput(), {
      x: 0,
      y: TEST_SCENE_SURFACE + 9,
      z: 14,
      yaw: 0,
      pitch: -0.42,
    });
    this.freecam = freecam;
    const overlay = this.mountDebug();
    this.root.append(overlay.element, hintBar('hint.freecam'));
    this.state = 'testchunk';

    this.runSceneLoop((dt) => {
      freecam.update(dt);
      view.setPose(freecam.pose);
      view.frame(dt);
    });
  }

  /** The one InputManager of a scene, on the canvas (Pointer Lock unless `?noLock=1`). */
  private createInput(): InputManager {
    const input = new InputManager(this.renderer!.webgl.domElement, {
      pointerLock: !this.params.noLock,
      language: navigator.language,
    });
    if (this.params.kb) input.labels.force(this.params.kb);
    this.input = input;
    return input;
  }

  /**
   * The debug overlay of a scene (the caller places its element), toggled with the debug keys,
   * and the `?view=` debug render view.
   */
  private mountDebug(): DebugOverlay {
    const overlay = new DebugOverlay(this.params.debug);
    this.overlay = overlay;
    window.addEventListener('keydown', (event) => {
      if (DEBUG_KEYS.has(event.code)) {
        event.preventDefault();
        overlay.toggle();
      }
    });
    const requested = this.params.view as DebugView | null;
    if (requested && DEBUG_VIEWS.includes(requested)) this.setDebugView(requested);
    return overlay;
  }

  /** The frame loop of a 3D scene, with the debug overlay refreshed every OVERLAY_REFRESH s. */
  private runSceneLoop(update: (dt: number) => void): void {
    let sinceOverlay = 0;
    this.runLoop((dt) => {
      update(dt);
      sinceOverlay += dt;
      if (sinceOverlay >= OVERLAY_REFRESH) {
        sinceOverlay = 0;
        this.refreshOverlay();
      }
    });
  }

  private refreshOverlay(): void {
    if (!this.overlay?.isVisible()) return;
    const lines = debugLines(this);
    if (lines) this.overlay.setLines(lines);
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
  const biomes = [...(pack.biomes ?? [])].sort((a, b) => a.order - b.order);
  if (biomes.length === 0) return packTints(pack);
  const out = [NO_TINT];
  for (const biome of biomes) out.push(biome.tints.grass, biome.tints.foliage, biome.tints.water);
  return out;
}

/** RGBA bytes of every pack texture, in layer order (the texture array and the item icons). */
function packLayers(pack: ContentPack): Uint8Array[] {
  return pack.textures.map((def) => generatePackTexture(def, pack.manifest.textureSize));
}

/** Tint table without biomes: no tint, then the pack's own grass/foliage/water tints. */
function packTints(pack: ContentPack): string[] {
  return [NO_TINT, pack.tints.grass, pack.tints.foliage, pack.tints.water];
}

interface KeyboardLayoutSource {
  getLayoutMap(): Promise<ReadonlyMap<string, string>>;
}
