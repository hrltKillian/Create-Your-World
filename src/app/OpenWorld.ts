import type { AudioEngine } from '../audio/AudioEngine.ts';
import { AudioCues } from '../audio/cues.ts';
import type { Registry } from '../content/registry.ts';
import type { InputManager } from '../input/InputManager.ts';
import type { SaveBackend } from '../platform/IdbStorage.ts';
import {
  type PageTargets,
  requestPersistence,
  SaveManager,
  type SaveStatus,
} from '../platform/SaveManager.ts';
import type { WorkerPool } from '../platform/WorkerPool.ts';
import type { WorldLock } from '../platform/worldLock.ts';
import type { CameraPose, WorldView } from '../render/WorldView.ts';
import { createHost } from '../sim/host.ts';
import type { WorldInfo } from '../sim/persistence.ts';
import { h } from '../ui/h.ts';
import { crosshair } from '../ui/hud/crosshair.ts';
import { hintBar } from '../ui/screens/hint.ts';
import type { BootParams } from './bootParams.ts';
import { FreeCam } from './FreeCam.ts';
import { GameSession } from './GameSession.ts';
import { HudBridge } from './HudBridge.ts';
import { InventoryUi } from './inventoryUi.ts';
import { type GateEvents, PlayGate } from './playGate.ts';
import { PLAYER_ID, type WorldSlot } from './worlds.ts';

/** What a world needs from the app (all of it outlives the world). */
export interface OpenWorldDeps {
  /** Where the play layer goes. */
  readonly root: HTMLElement;
  readonly registry: Registry;
  /** The pack's textures (item icons). */
  readonly layers: readonly Uint8Array[];
  readonly pool: WorkerPool;
  readonly view: WorldView;
  readonly input: InputManager;
  readonly audio: AudioEngine;
  readonly backend: SaveBackend;
  /** The page events that save at once (`document` and `window`). */
  readonly page: PageTargets;
  readonly params: BootParams;
  readonly layoutLoaded: Promise<void>;
  readonly renderDistance: number;
  /** Play stopped (the mouse was released) or started again. */
  readonly gate: GateEvents;
  readonly onSaveStatus: (status: SaveStatus) => void;
}

/**
 * The world open in this tab: its lock, the play session over its simulation, its saves (autosave,
 * page hide, pause, save & quit) and the play layer (crosshair, click to play, hotbar, bag, HUD).
 * `saveLast()` then `close()` save a last time and let everything go; the renderer, the world view,
 * the input and the audio belong to the App and serve the next world.
 */
export class OpenWorld {
  readonly info: WorldInfo;
  readonly session: GameSession;
  readonly saves: SaveManager;
  readonly freecam: FreeCam | null;
  /** Click to play and the bag (none with the free camera). */
  readonly gate: PlayGate | null = null;
  readonly inventory: InventoryUi | null = null;
  /** The survival HUD and the death screen (none with the free camera). */
  readonly hud: HudBridge | null = null;
  private readonly lock: WorldLock;
  private readonly input: InputManager;
  private readonly events: GateEvents;
  private readonly layer: HTMLElement;
  private readonly cross: HTMLElement;

  constructor(slot: WorldSlot, deps: OpenWorldDeps) {
    const { params, input, audio, registry } = deps;
    this.info = slot.info;
    this.lock = slot.lock;
    this.input = input;
    this.events = deps.gate;
    const host = createHost(slot.sim, PLAYER_ID, params.host === 'serialize');
    // The session moves the free camera to the spawn.
    this.freecam = params.freecam
      ? new FreeCam(input, { x: 0, y: 100, z: 0, yaw: 0, pitch: 0 })
      : null;
    const session = new GameSession(
      { renderDistance: deps.renderDistance, freecam: this.freecam, fixedStep: params.fixedStep },
      host,
      deps.pool,
      deps.view,
      input,
    );
    this.session = session;
    // `?time=` and `?freezeTime=1` set the clock through its debug commands (dev builds only).
    if (params.time !== null) host.send({ type: 'debug.setTime', hours: params.time });
    if (params.freezeTime) host.send({ type: 'debug.freezeTime', frozen: true });
    const cues = new AudioCues(audio, registry.pack.sounds?.pickup);
    session.listeners.push((event) => cues.onEvent(event));

    this.saves = new SaveManager({
      storage: deps.backend.storage,
      deflater: deps.backend.deflater,
      sim: slot.sim,
      info: slot.info,
      stored: slot.stored,
      full: slot.full,
      onStatus: deps.onSaveStatus,
    });
    session.listeners.push((event) => this.saves.onEvent(event));
    this.saves.watchPage(deps.page);
    this.saves.start();
    if (slot.created) {
      void requestPersistence();
      // Stored at once: the world is in the list even if the tab dies before the first autosave.
      void this.saves.save();
    }

    this.cross = crosshair();
    this.layer = h('div', { class: 'play-layer' }, this.cross);
    deps.root.append(this.layer);
    if (this.freecam) {
      // The free camera flies without the click-to-play pause, the hotbar or the bag.
      this.layer.append(hintBar('hint.freecam'));
      input.enabled = true;
      return;
    }
    const gate = new PlayGate(this.layer, input, session, deps.layoutLoaded, deps.gate);
    this.gate = gate;
    this.inventory = new InventoryUi(
      this.layer,
      registry,
      deps.layers,
      session,
      input,
      gate,
      audio,
    );
    this.hud = new HudBridge(this.layer, session, input, gate, this.inventory);
  }

  /** One frame of play: input, ticks, streaming, meshing, the HUD; returns the camera pose. */
  frame(dt: number): CameraPose {
    const session = this.session;
    const pose = session.frame(dt);
    this.inventory?.bridge.frame(dt);
    this.hud?.frame(dt);
    this.cross.classList.toggle('hidden', session.rig.mode === 'third' || this.freecam !== null);
    return pose;
  }

  /** The pause menu may open (not over the bag). */
  canPause(): boolean {
    return this.gate?.canPause() ?? true;
  }

  /** The pause menu opens: play stops and the world is saved (docs « Sauvegarde automatique »). */
  pause(): void {
    if (this.gate) this.gate.pause();
    else {
      this.session.setPaused(true);
      this.input.enabled = false;
    }
    void this.saves.save();
  }

  /** Resume: play starts again once the mouse is captured (`GateEvents.playing`). */
  resume(): void {
    if (this.gate) this.gate.resume();
    else {
      this.session.setPaused(false);
      this.input.enabled = true;
      this.events.playing();
    }
  }

  /**
   * Save & quit, first step (the frame loop stopped): the last save; resolves with its success.
   * When it fails, the world stays open and goes on saving (autosave, page hide).
   */
  saveLast(): Promise<boolean> {
    return this.saves.close();
  }

  /**
   * Save & quit once saved, or Quit without saving (the frame loop stopped): the saves stop, the
   * world's objects leave the shared view and the page, and the lock goes.
   */
  async close(): Promise<void> {
    this.saves.stop();
    this.inventory?.dispose();
    this.gate?.dispose();
    this.layer.remove();
    this.session.dispose();
    this.input.enabled = false;
    this.input.releaseAll();
    await this.lock.release();
  }
}
