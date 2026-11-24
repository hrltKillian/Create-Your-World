import { generatePackTexture } from '../assets/procedural/patterns.ts';
import { AudioEngine } from '../audio/AudioEngine.ts';
import { basePack } from '../content/packs/base/index.ts';
import { buildRegistry, NO_TINT, packTints, type Registry } from '../content/registry.ts';
import type { ContentPack } from '../content/schema.ts';
import { setLogSink } from '../core/log.ts';
import { addStrings } from '../i18n/i18n.ts';
import { InputManager } from '../input/InputManager.ts';
import { type CapabilityReport, detectCapabilities } from '../platform/capabilities.ts';
import { openSaveBackend } from '../platform/IdbStorage.ts';
import { DEFAULT_SETTINGS } from '../platform/settings.ts';
import { WorkerPool, workerCount } from '../platform/WorkerPool.ts';
import { DEFAULT_QUALITY, QUALITY_PRESETS } from '../render/quality.ts';
import { Renderer } from '../render/Renderer.ts';
import { TitleScene } from '../render/TitleScene.ts';
import { createTextureArray } from '../render/textureArray.ts';
import { DEBUG_VIEWS, type DebugView } from '../render/voxelMaterial.ts';
import { WorldView } from '../render/WorldView.ts';
import { DebugOverlay } from '../ui/debug/DebugOverlay.ts';
import { fatalScreen } from '../ui/screens/fatal.ts';
import { hintBar } from '../ui/screens/hint.ts';
import { titleOverlay } from '../ui/screens/title.ts';
import { unsupportedScreen } from '../ui/screens/unsupported.ts';
import { buildTestScene, meshTestScene, TEST_SCENE_SURFACE } from '../world/gen/testScene.ts';
import { VoxelWorld } from '../world/VoxelWorld.ts';
import type { AppState } from './appState.ts';
import { type BootParams, parseBootParams } from './bootParams.ts';
import { debugLines } from './debugLines.ts';
import { FreeCam } from './FreeCam.ts';
import { Game } from './Game.ts';
import type { GameSession } from './GameSession.ts';
import type { HudBridge } from './HudBridge.ts';
import type { InventoryUi } from './inventoryUi.ts';
import { FrameStats } from './perf.ts';

export const MILESTONE = 11;

/** Errors kept for `__game.errors()`; later ones are only counted. */
const MAX_ERRORS = 100;
/** Seconds between two refreshes of the debug overlay. */
const OVERLAY_REFRESH = 0.25;
/** Drawing buffer used by benchmarks (a 13-inch laptop at DPR 1.5), independent of the pane. */
const BENCH_BUFFER = [2160, 1350] as const;

/**
 * Composition root: capability gate, content, renderer, workers, the shared world view, input and
 * audio, the debug overlay and the frame loop; then the Game (menus, saves, the open world), or a
 * developer scene (`?scene=title`, `?scene=testchunk`).
 */
export class App {
  readonly params: BootParams;
  readonly frames = new FrameStats();
  readonly errors: string[] = [];
  droppedErrors = 0;
  capabilities: CapabilityReport | null = null;
  renderer: Renderer | null = null;
  workers: WorkerPool | null = null;
  registry: Registry | null = null;
  view: WorldView | null = null;
  overlay: DebugOverlay | null = null;
  input: InputManager | null = null;
  audio: AudioEngine | null = null;
  /** Menus, saves and the world open in this tab (null in the developer scenes). */
  game: Game | null = null;
  debugView: DebugView = 'none';
  /** performance.now() (from the navigation start) of the first frame in play; −1 until then. */
  playableAt = -1;

  private readonly root: HTMLElement;
  private readonly readyPromise: Promise<void>;
  private resolveReady: () => void = () => {};
  private rejectReady: (error: unknown) => void = () => {};
  /** State of the boot and of the developer scenes (the Game has its own). */
  private bootState: AppState = 'boot';
  /** The developer test scene's world and camera (`?scene=testchunk`). */
  private testScene: { readonly world: VoxelWorld; readonly freecam: FreeCam } | null = null;
  /** Time of the last animation frame (−1: the next frame starts the clock again). */
  private lastFrame = -1;

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

  /** Where the app is (`appState.ts`): boot and scene states, then the Game's. */
  get state(): AppState {
    if (this.bootState === 'fatal') return 'fatal';
    return this.game?.state ?? this.bootState;
  }

  /** The play session of the open world. */
  get session(): GameSession | null {
    return this.game?.open?.session ?? null;
  }

  /** Hotbar and bag of the open world (none with the free camera). */
  get inventory(): InventoryUi | null {
    return this.game?.open?.inventory ?? null;
  }

  get hud(): HudBridge | null {
    return this.game?.open?.hud ?? null;
  }

  get freecam(): FreeCam | null {
    return this.game?.open?.freecam ?? this.testScene?.freecam ?? null;
  }

  get world(): VoxelWorld | null {
    return this.session?.host.view.world ?? this.testScene?.world ?? null;
  }

  /** Resolves once the first frame is drawn or the menu shows (rejects on a boot failure). */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  async start(): Promise<void> {
    try {
      const report = detectCapabilities({ forceNoWebGL: this.params.forceNoWebGL });
      this.capabilities = report;
      if (!report.ok) {
        this.bootState = 'unsupported';
        this.root.replaceChildren(unsupportedScreen(report.missing));
        this.resolveReady();
        return;
      }
      this.registry = buildRegistry(basePack);
      addStrings(basePack.strings);
      this.workers = new WorkerPool(workerCount(navigator.hardwareConcurrency));
      this.workers.onFatal = (reason) => this.fail(new Error(reason));
      this.renderer = new Renderer(this.root, {
        // The game then caps it at the Resolution setting (`setPixelRatio`), or `?quality=`'s.
        maxPixelRatio: QUALITY_PRESETS[this.params.quality ?? DEFAULT_QUALITY].pixelRatio,
        // The bench build always renders at a fixed size so fill cost does not depend on the pane.
        fixedBuffer: __BENCH__ || this.params.bench ? BENCH_BUFFER : undefined,
      });
      document.addEventListener('visibilitychange', () => {
        this.lastFrame = -1;
        this.frames.resetClock();
      });
      if (this.params.scene === 'title') this.startTitle(report);
      else if (this.params.scene === 'testchunk') this.startTestScene(this.registry);
      else await this.startGame(this.registry, report);
    } catch (error) {
      this.fail(error);
    }
  }

  fail(error: unknown): void {
    if (this.bootState === 'fatal') return;
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    this.recordError(detail);
    this.bootState = 'fatal';
    this.stopLoop();
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
    // The xray view shows the caves, the test scene everything: no cave culling with them.
    const cull = this.params.occlusion && view !== 'xray' && !this.testScene;
    this.view?.chunks.occlusion.setEnabled(cull);
    this.session?.scheduler.setXray(view === 'xray');
  }

  private startTitle(report: CapabilityReport): void {
    const renderer = this.renderer!;
    const title = new TitleScene(renderer);
    this.root.append(titleOverlay(MILESTONE, report.touchOnly));
    this.bootState = 'title';
    this.runLoop((dt) => title.frame(dt));
  }

  /** The shared world view, input, audio and debug overlay, the save backend, then the Game. */
  private async startGame(registry: Registry, report: CapabilityReport): Promise<void> {
    const pack = registry.pack;
    const layers = packLayers(pack);
    const view = this.createWorldView(pack, layers, biomeTints(pack));
    this.view = view;
    const input = this.createInput();
    input.enabled = false;
    const layoutLoaded = input.labels.loadLayoutMap(
      (navigator as Navigator & { keyboard?: KeyboardLayoutSource }).keyboard,
    );
    const audio = this.createAudio(pack);
    this.root.append(this.mountDebug().element);
    const backend = await openSaveBackend(this.params);
    this.game = new Game(
      {
        root: this.root,
        params: this.params,
        registry,
        workers: this.workers!,
        view,
        input,
        audio,
        layers,
        layoutLoaded,
        frames: this.frames,
        touchOnly: report.touchOnly,
        xray: () => this.debugView === 'xray',
        setPixelRatio: (cap) => this.renderer!.setMaxPixelRatio(cap),
        runLoop: (frame) => this.runSceneLoop(frame),
        stopLoop: () => this.stopLoop(),
        shown: () => this.resolveReady(),
        fail: (error) => this.fail(error),
        recordError: (message) => this.recordError(message),
      },
      backend,
    );
    await this.game.start();
  }

  /** `layers`: the pack's textures (RGBA bytes, see `packLayers`). */
  private createWorldView(
    pack: ContentPack,
    layers: readonly Uint8Array[],
    tints: readonly string[],
  ): WorldView {
    const textures = createTextureArray(layers, pack.manifest.textureSize);
    const view = new WorldView(this.renderer!, textures, tints, DEFAULT_SETTINGS.renderDistance);
    view.chunks.occlusion.setEnabled(this.params.occlusion);
    return view;
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

  /** Developer test scene (M1): a fixed hand-built area, meshed once, seen from a free camera. */
  private startTestScene(registry: Registry): void {
    const pack = registry.pack;
    const view = this.createWorldView(pack, packLayers(pack), packTints(pack));
    this.view = view;
    // A showcase seen whole (m1 counts one draw per mesh): no cave culling.
    view.chunks.occlusion.setEnabled(false);
    const world = new VoxelWorld(registry.air, registry.unknownBlock);
    buildTestScene(world, registry);
    meshTestScene(world, registry, view.chunks);
    const freecam = new FreeCam(this.createInput(), {
      x: 0,
      y: TEST_SCENE_SURFACE + 9,
      z: 14,
      yaw: 0,
      pitch: -0.42,
    });
    this.testScene = { world, freecam };
    const overlay = this.mountDebug();
    this.root.append(overlay.element, hintBar('hint.freecam'));
    this.bootState = 'testchunk';

    this.runSceneLoop((dt) => {
      freecam.update(dt);
      view.setPose(freecam.pose);
      view.frame(dt);
    });
  }

  /** The one InputManager of the app, on the canvas (Pointer Lock unless `?noLock=1`). */
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
   * The debug overlay (the caller places its element), toggled with the debug keys as bound now
   * (not while typing in a menu field: IntlBackslash is @ on a Mac AZERTY), and the `?view=`
   * debug view.
   */
  private mountDebug(): DebugOverlay {
    const overlay = new DebugOverlay(this.params.debug);
    this.overlay = overlay;
    window.addEventListener('keydown', (event) => {
      const keys = this.input?.bindings.debug;
      if (keys?.includes(event.code) && !(event.target instanceof HTMLInputElement)) {
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

  /** Runs `frame` on every animation frame, instead of the previous loop. */
  private runLoop(frame: (dt: number) => void): void {
    this.lastFrame = -1;
    this.renderer!.webgl.setAnimationLoop((now: number) => {
      try {
        this.frames.frameStart(now);
        const dt = this.lastFrame < 0 ? 0 : Math.min(now - this.lastFrame, 250) / 1000;
        this.lastFrame = now;
        frame(dt);
        this.frames.frameEnd();
        if (this.playableAt < 0 && this.state === 'world') this.playableAt = performance.now();
        this.resolveReady();
      } catch (error) {
        // three schedules the next frame before calling us: stop the loop and show the error once.
        this.fail(error);
      }
    });
  }

  private stopLoop(): void {
    this.renderer?.webgl.setAnimationLoop(null);
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

interface KeyboardLayoutSource {
  getLayoutMap(): Promise<ReadonlyMap<string, string>>;
}
