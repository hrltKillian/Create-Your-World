import { createItemIcons } from '../assets/procedural/iconGen.ts';
import type { AudioEngine } from '../audio/AudioEngine.ts';
import type { Registry } from '../content/registry.ts';
import { createLogger } from '../core/log.ts';
import { t } from '../i18n/i18n.ts';
import { actionForCode, HOTBAR_CODES } from '../input/bindings.ts';
import { type InputManager, isTextField } from '../input/InputManager.ts';
import { OPEN_SLOTS_BASE } from '../sim/commands.ts';
import { CRAFT_QUEUE, MAX_CRAFT_COUNT } from '../sim/craftQueue.ts';
import type { SimEvent } from '../sim/events.ts';
import { Hotbar } from '../ui/hud/hotbar.ts';
import { HudHint } from '../ui/hud/hudHint.ts';
import type { ItemArt } from '../ui/itemSlot.ts';
import { type BagPage, BagScreen } from '../ui/screens/bag.ts';
import { ContainerScreen } from '../ui/screens/container.ts';
import { LogbookPanel } from '../ui/screens/logbook.ts';
import { StationScreen } from '../ui/screens/station.ts';
import { WorkbenchScreen } from '../ui/screens/workbench.ts';
import type { ScreenActions, ScreenDeps } from '../ui/slotBoard.ts';
import type { GameSession } from './GameSession.ts';
import type { PlayGate } from './playGate.ts';
import { UiBridge } from './UiBridge.ts';

const log = createLogger('ui');

/**
 * The item icons of a registry (blob URLs, by item id), drawn once for the page: a registry and its
 * texture layers live as long as it, so every world opened again shares the same URLs (kept for
 * the page, never drawn twice).
 */
const iconsOf = new WeakMap<Registry, Promise<string[]>>();

function itemIcons(registry: Registry, layers: readonly Uint8Array[]): Promise<string[]> {
  let icons = iconsOf.get(registry);
  if (!icons) {
    icons = createItemIcons(registry, layers, registry.pack.manifest.textureSize);
    iconsOf.set(registry, icons);
    // A failure is drawn again by the next world opened.
    icons.catch(() => iconsOf.delete(registry));
  }
  return icons;
}

/** The screens over the world (the hook's `ui.screen()` names them). */
export type InventoryScreen = 'bag' | 'container' | 'station' | 'workbench';

/** What the controller needs from each screen. */
interface ScreenView {
  isOpen(): boolean;
  close(): void;
  hotkey(hotbarSlot: number): void;
}

/**
 * The hotbar, the hint line and the screens of a play session (Bag with its Logbook, Container,
 * Station, Workbench with its own Logbook): item icons, refresh, commands, sounds and keys. E or
 * Tab opens the bag on its Inventory, L on its Logbook, B on its Bestiary, J on its Quests
 * (`toggleBag`); one of
 * them closes any other screen (back to play: PlayGate.closeScreen), a hotbar key over
 * a slot swaps; keys typed in a text box (the Logbook's search) are its own. Esc is the pause
 * menu's alone (Game.onPauseKey): it never closes a screen. The Bag opens in the simulation too (`screen.open`),
 * whose slot clicks need it; chests, stations and workbenches open from the simulation (secondary
 * on the block): their screen shows on its `blockEntityOpened` event and goes on
 * `blockEntityClosed`. Closing a screen sends `screen.close` (the cursor stack goes back to the
 * inventory).
 */
export class InventoryUi {
  readonly hotbar: Hotbar;
  readonly hint = new HudHint();
  readonly bag: BagScreen;
  readonly container: ContainerScreen;
  readonly station: StationScreen;
  readonly workbench: WorkbenchScreen;
  readonly bridge: UiBridge;
  private readonly session: GameSession;
  private readonly input: InputManager;
  private readonly gate: PlayGate;

  /** `layer`: the play layer of the world (its elements go with it). */
  constructor(
    layer: HTMLElement,
    registry: Registry,
    layers: readonly Uint8Array[],
    session: GameSession,
    input: InputManager,
    gate: PlayGate,
    audio: AudioEngine,
  ) {
    this.session = session;
    this.input = input;
    this.gate = gate;
    const art: ItemArt = { registry, icons: [] };
    itemIcons(registry, layers)
      .then((urls) => {
        art.icons = urls;
      })
      .catch((error: unknown) => log.error('item icons failed', error));
    const click = registry.pack.sounds?.click;
    const actions: ScreenActions = {
      send: (command) => session.host.send(command),
      click: () => {
        if (click) audio.playUi(click);
      },
    };
    const deps: ScreenDeps = {
      art,
      actions,
      slotCount: session.player.inventory.length,
      openBase: OPEN_SLOTS_BASE,
      closeKey: () => input.keyLabel('inventory'),
    };
    this.hotbar = new Hotbar(art);
    const limits = { queue: CRAFT_QUEUE, maxCount: MAX_CRAFT_COUNT };
    this.bag = new BagScreen(deps, new LogbookPanel(art, actions, limits));
    this.container = new ContainerScreen(deps);
    this.station = new StationScreen(deps);
    this.workbench = new WorkbenchScreen(deps, new LogbookPanel(art, actions, limits));
    // The bridge refreshes this object's views (hotbar, hint line and screens).
    this.bridge = new UiBridge(session.host.view, input, this);
    session.listeners.push((event) => {
      this.bridge.onEvent(event);
      this.onEvent(event);
    });
    layer.append(
      this.hotbar.element,
      this.hint.element,
      this.bag.element,
      this.container.element,
      this.station.element,
      this.workbench.element,
    );
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** The world closes (its play layer goes with the elements). */
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
  }

  /** The open screen, or null while playing. */
  screen(): InventoryScreen | null {
    if (this.bag.isOpen()) return 'bag';
    if (this.container.isOpen()) return 'container';
    if (this.station.isOpen()) return 'station';
    return this.workbench.isOpen() ? 'workbench' : null;
  }

  /**
   * The key of a Bag page (Bag, Logbook, Bestiary): opens the bag on that page while playing; on
   * the bag, shows the page, or closes it when it is the page on show; on another screen, closes
   * it. Returns whether it did any.
   */
  toggleBag(page: BagPage = 'inventory'): boolean {
    const screen = this.screen();
    if (screen === 'bag' && this.bag.shown() !== page) this.bag.show(page);
    else if (screen) this.closeScreen();
    else if (this.gate.canOpenScreen()) {
      this.bag.open(page);
      this.gate.openScreen();
      this.session.host.send({ type: 'screen.open', kind: 'bag' });
    } else return false;
    return true;
  }

  /** Closes the open screen, back to play (the mouse captured again: PlayGate.closeScreen). */
  closeScreen(): void {
    if (!this.screen()) return;
    this.hideScreen();
    this.gate.closeScreen();
  }

  /** Closes the open screen for another that takes its place (the death screen): the gate keeps it. */
  hideScreen(): void {
    const open = this.openView();
    if (!open) return;
    open.close();
    this.session.host.send({ type: 'screen.close' });
  }

  private openView(): ScreenView | null {
    const screen = this.screen();
    return screen ? this[screen] : null;
  }

  private onEvent(event: SimEvent): void {
    if (!('playerId' in event) || event.playerId !== this.session.player.playerId) return;
    if (event.type === 'blockEntityOpened') this.openBlock(event.x, event.y, event.z);
    else if (event.type === 'blockEntityClosed') this.blockClosed();
  }

  /**
   * The simulation opened a chest, a station or a workbench for the player: its screen shows (over
   * the bag).
   */
  private openBlock(x: number, y: number, z: number): void {
    const view = this.session.host.view;
    const registry = view.registry;
    const entity = view.blockEntity(x, y, z);
    // A station or a workbench names its station (undefined: one the pack lacks, no screen).
    const station =
      entity && 'station' in entity ? registry.crafting.station(entity.station) : null;
    const showing = this.openView();
    if (!entity || station === undefined || (!showing && !this.gate.canOpenScreen())) {
      // No screen can show it (paused): the simulation closes it again.
      this.session.host.send({ type: 'screen.close' });
      return;
    }
    showing?.close();
    if (entity.kind === 'workbench' && station) this.workbench.open(station, t(station.nameKey));
    else if (station) this.station.open(station, t(station.nameKey));
    else {
      const name = registry.blockDef(view.world.getBlock(x, y, z)).nameKey;
      this.container.open(t(name), entity.slots.length);
    }
    if (!showing) this.gate.openScreen();
  }

  /**
   * The simulation closed the open chest, station or workbench (moved away, broken, another one
   * opened, the player died). A death keeps the gate's screen: the death screen takes it over
   * (HudBridge), so the game does not pause and Respawn captures the mouse again.
   */
  private blockClosed(): void {
    const open = this.openView();
    if (!open || open === this.bag) return;
    open.close();
    if (!this.session.player.survival.dead) this.gate.closeScreen();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || isTextField(event.target) || this.gate.menuIsUp()) return;
    const action = actionForCode(this.input.bindings, event.code);
    if (
      action === 'inventory' ||
      action === 'logbook' ||
      action === 'bestiary' ||
      action === 'quests'
    ) {
      // Consumed: Tab on a button clicked in the screen must not move the focus out of the page.
      if (this.toggleBag(action)) event.preventDefault();
    } else if (!this.screen()) return;
    else {
      const slot = HOTBAR_CODES.indexOf(event.code);
      if (slot >= 0) this.openView()?.hotkey(slot);
    }
  };
}
