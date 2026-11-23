import { createItemIcons } from '../assets/procedural/iconGen.ts';
import type { AudioEngine } from '../audio/AudioEngine.ts';
import type { Registry } from '../content/registry.ts';
import { createLogger } from '../core/log.ts';
import { HOTBAR_CODES } from '../input/bindings.ts';
import type { InputManager } from '../input/InputManager.ts';
import { INVENTORY_SLOTS } from '../sim/inventory.ts';
import { Hotbar } from '../ui/hud/hotbar.ts';
import { HudHint } from '../ui/hud/hudHint.ts';
import type { ItemArt } from '../ui/itemSlot.ts';
import { BagScreen } from '../ui/screens/bag.ts';
import type { GameSession } from './GameSession.ts';
import type { PlayGate } from './playGate.ts';
import { UiBridge } from './UiBridge.ts';

const log = createLogger('ui');

/**
 * The hotbar, the hint line and the bag of a play session: item icons, refresh, commands, sounds
 * and keys (E or Tab opens and closes the bag, Esc closes it, a hotbar key over a slot swaps).
 */
export class InventoryUi {
  readonly hotbar: Hotbar;
  readonly hint = new HudHint();
  readonly bag: BagScreen;
  readonly bridge: UiBridge;
  private readonly input: InputManager;
  private readonly gate: PlayGate;

  constructor(
    root: HTMLElement,
    registry: Registry,
    layers: readonly Uint8Array[],
    session: GameSession,
    input: InputManager,
    gate: PlayGate,
    audio: AudioEngine,
  ) {
    this.input = input;
    this.gate = gate;
    const art: ItemArt = { registry, icons: [] };
    createItemIcons(registry, layers, registry.pack.manifest.textureSize)
      .then((urls) => {
        art.icons = urls;
      })
      .catch((error: unknown) => log.error('item icons failed', error));
    const click = registry.pack.sounds?.click;
    this.hotbar = new Hotbar(art);
    this.bag = new BagScreen(
      art,
      {
        send: (command) => session.host.send(command),
        click: () => {
          if (click) audio.playUi(click);
        },
      },
      INVENTORY_SLOTS,
      () => input.keyLabel('inventory'),
    );
    this.bridge = new UiBridge(session.player, input, this.hotbar, this.bag, this.hint);
    session.listeners.push((event) => this.bridge.onEvent(event));
    root.append(this.hotbar.element, this.hint.element, this.bag.element);
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** Opens the bag while playing, or closes it (capturing the mouse again). */
  toggleBag(): void {
    if (this.bag.isOpen()) this.closeBag(true);
    else if (this.gate.canOpenScreen()) {
      this.bag.open();
      this.gate.openScreen();
    }
  }

  /** `relock`: back to the game (its own key), else to the "Click to resume" overlay (Esc). */
  closeBag(relock: boolean): void {
    if (!this.bag.isOpen()) return;
    this.bag.close();
    this.gate.closeScreen(relock);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const bindings = this.input.bindings;
    if (bindings.inventory.includes(event.code)) this.toggleBag();
    else if (!this.bag.isOpen()) return;
    else if (bindings.pause.includes(event.code)) this.closeBag(false);
    else {
      const slot = HOTBAR_CODES.indexOf(event.code);
      if (slot >= 0) this.bag.hotkey(slot);
    }
  };
}
