import type { Registry } from '../content/registry.ts';
import type { InputManager } from '../input/InputManager.ts';
import type { StationEntity } from '../sim/blockEntities.ts';
import { ticksOf } from '../sim/clock.ts';
import { OPEN_SLOTS_BASE } from '../sim/commands.ts';
import { type CraftEntry, queueRoom } from '../sim/craftQueue.ts';
import { type Gear, wornGear } from '../sim/environment.ts';
import type { SimEvent } from '../sim/events.ts';
import type { SimView } from '../sim/host.ts';
import { countMatching, type Inventory } from '../sim/inventory.ts';
import type { PlayerState } from '../sim/player.ts';
import type { Hotbar } from '../ui/hud/hotbar.ts';
import { type HudHint, hintText } from '../ui/hud/hudHint.ts';
import type { BagScreen } from '../ui/screens/bag.ts';
import type { ContainerScreen } from '../ui/screens/container.ts';
import type { LogbookState, QueueView } from '../ui/screens/logbook.ts';
import type { StationScreen, StationStatus } from '../ui/screens/station.ts';

/** Seconds between two refreshes of the HUD and the open screens (10 Hz). */
const REFRESH_SECONDS = 0.1;

/** The views the bridge keeps up to date. */
export interface InventoryViews {
  readonly hotbar: Hotbar;
  readonly hint: HudHint;
  readonly bag: BagScreen;
  readonly container: ContainerScreen;
  readonly station: StationScreen;
}

type OpenScreen = 'bag' | 'container' | 'station' | null;

/**
 * Refreshes the hotbar and the open screen (the bag with its Logbook, a chest, a station) from the
 * player's live state: at 10 Hz, at once after an inventory, craft or block entity event, when the
 * selected slot changes and when a screen opens. The views diff what they show, so a refresh that
 * changes nothing touches no DOM. The player's hints (SimEvent `hint`) go to the HUD hint line.
 */
export class UiBridge {
  private readonly view: SimView;
  private readonly player: Readonly<PlayerState>;
  private readonly input: InputManager;
  private readonly views: InventoryViews;
  private elapsed = 0;
  private dirty = true;
  private shown: OpenScreen = null;
  private readonly gear: Gear = {
    armor: 0,
    warmth: 0,
    cooling: 0,
    airFilter: 1,
    waterproof: false,
  };

  constructor(view: SimView, input: InputManager, views: InventoryViews) {
    this.view = view;
    this.player = view.player()!;
    this.input = input;
    this.views = views;
  }

  onEvent(event: SimEvent): void {
    if (!('playerId' in event) || event.playerId !== this.player.playerId) return;
    switch (event.type) {
      case 'hint':
        this.views.hint.show(hintText(event.key, event.params));
        break;
      case 'inventoryChanged':
      case 'crafted':
      case 'blockEntityOpened':
      case 'blockEntityClosed':
        this.dirty = true;
        break;
    }
  }

  frame(dt: number): void {
    const { hotbar, hint } = this.views;
    hint.frame(dt);
    this.elapsed += dt;
    const open = this.openScreen();
    if (
      !this.dirty &&
      this.elapsed < REFRESH_SECONDS &&
      this.input.slot === hotbar.selected &&
      open === this.shown
    )
      return;
    this.dirty = false;
    this.elapsed = 0;
    this.shown = open;
    const inventory = this.player.inventory;
    hotbar.update(inventory, this.input.slot);
    if (open === 'bag') this.bagScreen();
    else if (open) this.blockScreen(open);
  }

  private openScreen(): OpenScreen {
    const { bag, container, station } = this.views;
    if (bag.isOpen()) return 'bag';
    if (container.isOpen()) return 'container';
    return station.isOpen() ? 'station' : null;
  }

  /** The Logbook's view of the player: the simulation's own ingredient count and station rule. */
  private logbook(): LogbookState {
    const view = this.view;
    const crafting = view.registry.crafting;
    const player = this.player;
    return {
      source: {
        crafting,
        seen: player.seen,
        owned: (ingredient) =>
          countMatching(player.inventory, 0, player.inventory.length, crafting, ingredient),
        stationNear: (station) => view.stationNear(station),
        room: (recipe) => queueRoom(view.registry, player.craft, recipe),
      },
      queue: player.craft.map((entry) => queueView(view.registry, entry)),
    };
  }

  /** The Bag: the inventory then the worn items, their protection, and the Logbook. */
  private bagScreen(): void {
    const { inventory, equipment } = this.player;
    const gear = wornGear(this.view.registry, equipment, this.gear);
    this.views.bag.update(screenSlots(inventory, equipment), this.logbook(), gear);
  }

  /** The open chest or station: the inventory then its slots (and a station's fire). */
  private blockScreen(open: 'container' | 'station'): void {
    const screen = this.player.screen;
    const entity =
      screen?.kind === 'block' ? this.view.blockEntity(screen.x, screen.y, screen.z) : undefined;
    if (entity?.kind !== open) return;
    const slots = screenSlots(this.player.inventory, entity.slots);
    if (entity.kind === 'container') this.views.container.update(slots);
    else this.views.station.update(slots, stationStatus(this.view.registry, entity));
  }
}

/**
 * The slots of a screen by slot number: the inventory, then the open block entity's or the worn
 * items from OPEN_SLOTS_BASE (the slots between are empty).
 */
export function screenSlots(inventory: Inventory, open: Inventory): Inventory {
  const slots: Inventory = new Array(OPEN_SLOTS_BASE + open.length).fill(null);
  for (let i = 0; i < inventory.length; i++) slots[i] = inventory[i]!;
  for (let i = 0; i < open.length; i++) slots[OPEN_SLOTS_BASE + i] = open[i]!;
  return slots;
}

/** A queue entry as the Logbook shows it, with the progress of its craft under way. */
export function queueView(registry: Registry, entry: Readonly<CraftEntry>): QueueView {
  const recipe = registry.crafting.recipe(entry.recipe);
  const progress = recipe ? entry.progressTicks / ticksOf(recipe.seconds) : 0;
  return { recipe: entry.recipe, count: entry.count, progress: Math.min(1, progress) };
}

/**
 * A station's fire as its block shows it (`lit`: an idle kiln keeps its fuel item's time left but
 * does not burn), its flame (that time left) and progress, 0…1.
 */
export function stationStatus(registry: Registry, station: Readonly<StationEntity>): StationStatus {
  const process = registry.crafting.process(station.process);
  const progress = process ? station.progressTicks / ticksOf(process.seconds) : 0;
  return {
    lit: station.lit,
    flame: station.burnTicks > 0 ? station.burnTicksLeft / station.burnTicks : 0,
    progress: Math.min(1, progress),
    process: station.process,
    keepLit: station.keepLit,
  };
}
