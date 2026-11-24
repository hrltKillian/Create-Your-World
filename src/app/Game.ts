import type { AudioEngine } from '../audio/AudioEngine.ts';
import type { Registry } from '../content/registry.ts';
import { t } from '../i18n/i18n.ts';
import { actionForCode } from '../input/bindings.ts';
import { BASE_SENSITIVITY, type InputManager, isTextField } from '../input/InputManager.ts';
import type { SaveBackend } from '../platform/IdbStorage.ts';
import type { SaveStatus } from '../platform/SaveManager.ts';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  type Settings,
  saveSettings,
} from '../platform/settings.ts';
import { WorkerColumnSource } from '../platform/WorkerColumnSource.ts';
import type { WorkerPool } from '../platform/WorkerPool.ts';
import { QUALITY_PRESETS } from '../render/quality.ts';
import type { WorldView } from '../render/WorldView.ts';
import { savingBanner } from '../ui/screens/banner.ts';
import { loadingScreen } from '../ui/screens/loading.ts';
import type { NewWorldForm } from '../ui/screens/newWorld.ts';
import { type AppEvent, type AppState, nextState } from './appState.ts';
import type { BootParams } from './bootParams.ts';
import { Menus } from './Menus.ts';
import { OpenWorld } from './OpenWorld.ts';
import type { FrameStats } from './perf.ts';
import {
  createWorld,
  loadWorld,
  newWorld,
  openErrorKey,
  type WorldDeps,
  WorldOpenError,
  type WorldSlot,
} from './worlds.ts';

/** The pause menu's line for each save state. */
const SAVE_STATUS_KEYS: Readonly<Record<SaveStatus, string | null>> = {
  idle: null,
  saving: 'save.status.saving',
  saved: 'save.status.saved',
  quota: 'save.status.quota',
  error: 'save.status.error',
};

/** What the game needs from the App, all of it shared by every world. */
export interface GameHost {
  readonly root: HTMLElement;
  readonly params: BootParams;
  readonly registry: Registry;
  readonly workers: WorkerPool;
  readonly view: WorldView;
  readonly input: InputManager;
  readonly audio: AudioEngine;
  /** The pack's textures (item icons). */
  readonly layers: readonly Uint8Array[];
  readonly layoutLoaded: Promise<void>;
  readonly frames: FrameStats;
  readonly touchOnly: boolean;
  /** The xray debug view is on (a new world meshes with it). */
  xray(): boolean;
  /** Caps the drawing buffer's pixel ratio (the Resolution setting). */
  setPixelRatio(cap: number): void;
  /** Runs `frame` on every animation frame (with the debug overlay), instead of the last loop. */
  runLoop(frame: (dt: number) => void): void;
  stopLoop(): void;
  /** The first screen is up (`App.ready()` resolves). */
  shown(): void;
  fail(error: unknown): void;
  recordError(message: string): void;
}

/**
 * The game after the boot (docs « Menus », « Sauvegarde »): the settings, the save backend, the
 * menus and the world open in this tab, moving through the states of `appState.ts` (menu →
 * loading → world ⇄ paused → quitting → menu). `?skipMenu=1` (and selftests) start in a new world,
 * `?world=<id>` in a saved one.
 */
export class Game {
  state: AppState = 'boot';
  settings: Settings;
  /** The world open in this tab (null in the menus). */
  open: OpenWorld | null = null;
  readonly menus: Menus;
  /** Where the worlds are saved (IndexedDB, or memory: `unavailable` shows the banner). */
  readonly backend: SaveBackend;
  private readonly host: GameHost;
  private readonly loading: HTMLElement;

  constructor(host: GameHost, backend: SaveBackend) {
    this.host = host;
    this.backend = backend;
    // Selftests and benchmarks measure on the defaults (a player's render distance, field of view
    // or keys would change their draws, captures and presses).
    const automated = host.params.selftest !== null || host.params.bench !== null;
    this.settings = automated ? DEFAULT_SETTINGS : loadSettings();
    this.applySettings(this.settings);
    host.view.setRenderDistance(this.renderDistance());
    host.setPixelRatio(this.graphics().pixelRatio);
    this.loading = loadingScreen();
    this.loading.hidden = true;
    host.root.append(this.loading);
    if (backend.unavailable) host.root.append(savingBanner());
    const click = host.registry.pack.sounds?.click;
    this.menus = new Menus({
      storage: backend.storage,
      touchOnly: host.touchOnly,
      seed: host.params.seed ?? '',
      settings: () => this.settings,
      keyLabel: (code) => host.input.labels.label(code),
      click: () => {
        if (click) host.audio.playUi(click);
      },
      play: (id) => void this.openWorld(id),
      create: (form) => void this.createWorld(form),
      resume: () => this.resume(),
      saveAndQuit: () => void this.saveAndQuit(),
      quitWithoutSaving: () => void this.quitWithoutSaving(),
      changeSettings: (settings) => this.changeSettings(settings),
    });
    host.root.append(this.menus.element);
    window.addEventListener('keydown', this.onPauseKey);
  }

  /** The first screen: a new world (`?skipMenu=1`), a saved one (`?world=`) or the main menu. */
  start(): Promise<void> {
    const params = this.host.params;
    if (params.skipMenu)
      return this.createWorld({ name: '', seed: params.seed ?? '', hostiles: true });
    if (params.world) return this.openWorld(params.world);
    return this.showMenu();
  }

  /**
   * Applies settings at once (input, audio, camera, resolution, interface scale, the open world's
   * particles, view bob and render distance) and stores them.
   */
  changeSettings(settings: Settings): void {
    const distance = this.renderDistance();
    const ratio = this.graphics().pixelRatio;
    this.applySettings(settings);
    const nextDistance = this.renderDistance();
    if (nextDistance !== distance) {
      this.host.view.setRenderDistance(nextDistance);
      this.open?.session.setRenderDistance(nextDistance);
    }
    // Only on a change: a resized drawing buffer is cleared (a slider must not flicker the world).
    const nextRatio = this.graphics().pixelRatio;
    if (nextRatio !== ratio) this.host.setPixelRatio(nextRatio);
    saveSettings(settings);
  }

  /** Opens a saved world (Play, Continue, `?world=`). */
  openWorld(id: string): Promise<void> {
    return this.enterWorld(() => loadWorld(this.worldDeps(), id));
  }

  /** Creates a world from the New world form (or `?skipMenu=1`) and opens it. */
  createWorld(form: NewWorldForm): Promise<void> {
    const world = newWorld(form, t('newWorld.untitled'), Date.now());
    return this.enterWorld(() => createWorld(this.worldDeps(), world));
  }

  /** Pauses play (Esc, the mouse released): the pause menu over the world. */
  pause(): void {
    const open = this.open;
    if (!open || !this.go('pause')) return;
    open.pause();
    this.menus.openPause(open.info.name);
  }

  /** Resume (the pause menu): play starts again once the mouse is captured. */
  resume(): void {
    if (this.state === 'paused') this.open?.resume();
  }

  /**
   * Save & quit (from the pause menu): the last save, the world closed, then the main menu. When
   * the save fails, the world stays open behind the pause menu, which says so and offers Retry and
   * Quit without saving. Resolves with the save's success (false also when there was no world to
   * quit).
   */
  async saveAndQuit(): Promise<boolean> {
    const open = this.open;
    if (!open || !this.go('quit')) return false;
    this.menus.setQuitting(true);
    // Nothing may draw or tick the world while it is saved for the last time.
    this.host.stopLoop();
    let saved: boolean;
    try {
      saved = await open.saveLast();
    } catch (error) {
      this.host.fail(error);
      return false;
    }
    if (saved) {
      await this.closeWorld(open);
    } else {
      this.go('quitFailed');
      this.play(open);
      this.menus.quitFailed();
    }
    return saved;
  }

  /** Quit without saving (confirmed on the pause menu after a failed Save & quit). */
  async quitWithoutSaving(): Promise<void> {
    const open = this.open;
    if (!open || !this.go('quit')) return;
    this.host.stopLoop();
    await this.closeWorld(open);
  }

  /** The world closes (its last save done or given up), then the main menu shows. */
  private async closeWorld(open: OpenWorld): Promise<void> {
    try {
      await open.close();
    } catch (error) {
      this.host.fail(error);
      return;
    }
    this.open = null;
    this.menus.setQuitting(false);
    await this.showMenu();
  }

  /** The main menu (at boot, after a failed opening or save & quit), with a notice key. */
  private async showMenu(notice: string | null = null): Promise<void> {
    if (!this.go('menu')) return;
    this.host.stopLoop();
    this.host.input.enabled = false;
    await this.menus.openMain(notice);
    this.host.shown();
  }

  /**
   * Takes a world (lock, records or a new simulation) behind the loading screen, then plays it.
   * A world that cannot be opened sends the player back to the menu with its message.
   */
  private async enterWorld(take: () => Promise<WorldSlot>): Promise<void> {
    if (!this.go('open')) return;
    this.menus.close();
    let slot: WorldSlot;
    try {
      slot = await take();
    } catch (error) {
      if (error instanceof WorldOpenError) await this.showMenu(openErrorKey(error));
      else this.host.fail(error);
      return;
    }
    const host = this.host;
    const { view, audio } = host;
    const open = new OpenWorld(slot, {
      root: host.root,
      registry: host.registry,
      layers: host.layers,
      pool: host.workers,
      view,
      input: host.input,
      audio,
      backend: this.backend,
      page: { doc: document, win: window },
      params: host.params,
      layoutLoaded: host.layoutLoaded,
      renderDistance: this.renderDistance(),
      gate: { paused: () => this.pause(), playing: () => this.resumed() },
      onSaveStatus: (status) => this.onSaveStatus(status),
    });
    this.open = open;
    this.applyWorldSettings(open);
    open.session.scheduler.setXray(host.xray());
    // The session's play objects (overlays, hand view) are in place: compile while loading.
    view.precompile().catch((error: unknown) => host.recordError(`[render] ${String(error)}`));
    // The ear starts at the spawn eye (then follows the camera every frame).
    const eye = open.session.rig.pose;
    audio.setListener(eye.x, eye.y, eye.z, eye.yaw, eye.pitch);
    this.play(open);
  }

  /** Runs the open world on every animation frame: play, drawing, sound, the loading screen. */
  private play(open: OpenWorld): void {
    const { view, audio, frames } = this.host;
    this.host.runLoop((dt) => {
      const t0 = performance.now();
      const pose = open.frame(dt);
      const t1 = performance.now();
      view.setPose(pose);
      view.frame(dt);
      audio.setListener(pose.x, pose.y, pose.z, pose.yaw, pose.pitch);
      frames.playSpans(open.session.spans, t1 - t0, performance.now() - t1);
      // Selftests stream on the nominal slices, so their waits do not depend on the machine.
      if (!this.host.params.selftest) open.session.throttle.observe(frames.lastWork(), dt);
      const loading = open.session.loading;
      if (loading ? this.state === 'world' : this.state === 'loading')
        this.go(loading ? 'unloaded' : 'loaded');
    });
  }

  /** What opening a world needs (the column source is new for each simulation). */
  private worldDeps(): WorldDeps {
    const pool = this.host.workers;
    return {
      storage: this.backend.storage,
      deflater: this.backend.deflater,
      registry: this.host.registry,
      source: new WorkerColumnSource(pool),
      maxInFlight: pool.size * 2,
      allowDebug: __DEBUG_HOOK__,
      worldType: this.host.params.worldType,
      viewRadius: this.renderDistance(),
      spawns: this.host.params.spawns ?? undefined,
      graceTicks: this.host.params.grace ?? undefined,
    };
  }

  /** Columns around the player: `?rd=` (or `?quality=`'s) in dev builds, else the setting. */
  private renderDistance(): number {
    return this.host.params.rd ?? this.settings.renderDistance;
  }

  /** Play started again (the mouse captured after Resume): the menus close. */
  private resumed(): void {
    if (this.go('resume')) this.menus.close();
  }

  private onSaveStatus(status: SaveStatus): void {
    this.menus.setSaveStatus(SAVE_STATUS_KEYS[status]);
    if (status === 'saved' && this.state === 'paused') this.menus.clearQuitFailed();
    if (status === 'quota') this.open?.inventory?.hint.show(t('save.status.quota'));
  }

  /**
   * The pause key (Esc unless rebound): back one menu screen; on the pause menu, resume when there
   * is no Pointer Lock (a key is not a user gesture, so it cannot capture the mouse); while
   * playing, pause. The bag takes its own Esc first (it marks the event), and the Key bindings
   * screen every key while it waits for one. A pause key rebound to a letter is typed into a text
   * box (the New world name and seed), where Esc still goes back.
   */
  private readonly onPauseKey = (event: KeyboardEvent): void => {
    const pauseKey = actionForCode(this.host.input.bindings, event.code) === 'pause';
    if (event.repeat || event.defaultPrevented || !pauseKey) return;
    if (event.code !== 'Escape' && isTextField(event.target)) return;
    if (this.state === 'menu' || this.state === 'paused') {
      if (!this.menus.back() && this.state === 'paused' && !this.host.input.pointer) this.resume();
    } else if ((this.state === 'world' || this.state === 'loading') && this.open?.canPause()) {
      this.pause();
    }
  };

  /** Moves to the next state; false (nothing changes) when the state does not take the event. */
  private go(event: AppEvent): boolean {
    const next = nextState(this.state, event);
    if (next === null) return false;
    this.state = next;
    this.loading.hidden = next !== 'loading';
    return true;
  }

  private applySettings(settings: Settings): void {
    this.settings = settings;
    const { input, audio, view, root } = this.host;
    input.sensitivity = BASE_SENSITIVITY * settings.sensitivity;
    input.invertY = settings.invertY;
    input.crouchToggle = settings.crouch === 'toggle';
    input.bindings = settings.bindings;
    audio.setVolumes(settings.volumes);
    view.setFov(settings.fov);
    // main.css zooms the HUD, screens and menus; the dragged stack undoes it (it follows the
    // pointer in viewport pixels).
    root.style.setProperty('--ui-scale', String(settings.uiScale));
    root.style.setProperty('--ui-unscale', String(1 / settings.uiScale));
    if (this.open) this.applyWorldSettings(this.open);
  }

  /** The settings a world's own objects hold (every world opens with particles and the bob on). */
  private applyWorldSettings(open: OpenWorld): void {
    open.session.play.particles.setEnabled(this.graphics().particles);
    open.session.rig.viewBob = this.settings.viewBob;
  }

  /** Resolution and particles: `?quality=`'s preset in dev builds, else the settings. */
  private graphics(): { readonly pixelRatio: number; readonly particles: boolean } {
    const quality = this.host.params.quality;
    return quality ? QUALITY_PRESETS[quality] : this.settings;
  }
}
