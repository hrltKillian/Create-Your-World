import type { InputManager } from '../input/InputManager.ts';
import type { SimEvent } from '../sim/events.ts';
import type { PlayerState } from '../sim/player.ts';
import type { Hotbar } from '../ui/hud/hotbar.ts';
import type { BagScreen } from '../ui/screens/bag.ts';

/** Seconds between two refreshes of the HUD and the open screens (10 Hz). */
const REFRESH_SECONDS = 0.1;

/**
 * Refreshes the hotbar and the bag from the player's live state: at 10 Hz, at once after an
 * inventory event, when the selected slot changes and when the bag opens. The views diff what
 * they show, so a refresh that changes nothing touches no DOM.
 */
export class UiBridge {
  private readonly player: Readonly<PlayerState>;
  private readonly input: InputManager;
  private readonly hotbar: Hotbar;
  private readonly bag: BagScreen;
  private elapsed = 0;
  private dirty = true;
  private bagShown = false;

  constructor(player: Readonly<PlayerState>, input: InputManager, hotbar: Hotbar, bag: BagScreen) {
    this.player = player;
    this.input = input;
    this.hotbar = hotbar;
    this.bag = bag;
  }

  onEvent(event: SimEvent): void {
    if (event.type === 'inventoryChanged' && event.playerId === this.player.playerId)
      this.dirty = true;
  }

  frame(dt: number): void {
    this.elapsed += dt;
    const bagOpen = this.bag.isOpen();
    if (
      !this.dirty &&
      this.elapsed < REFRESH_SECONDS &&
      this.input.slot === this.hotbar.selected &&
      bagOpen === this.bagShown
    )
      return;
    this.dirty = false;
    this.elapsed = 0;
    this.bagShown = bagOpen;
    const inventory = this.player.inventory;
    this.hotbar.update(inventory, this.input.slot);
    if (bagOpen) this.bag.update(inventory);
  }
}
