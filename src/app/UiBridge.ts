import type { Registry } from '../content/registry.ts';
import { t } from '../i18n/i18n.ts';
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
import { levelOf, SKILLS } from '../sim/progression.ts';
import { BENCH_RADIUS, chestsNear } from '../sim/tidying.ts';
import { bestiaryRows } from '../ui/bestiary.ts';
import type { Hotbar } from '../ui/hud/hotbar.ts';
import { type HudHint, hintText } from '../ui/hud/hudHint.ts';
import { BIG_MAP_RADIUS } from '../ui/map.ts';
import { questRows, taskRows } from '../ui/quests.ts';
import type { BagScreen } from '../ui/screens/bag.ts';
import type { ContainerScreen } from '../ui/screens/container.ts';
import type { LogbookState, QueueView } from '../ui/screens/logbook.ts';
import type { MapScreen } from '../ui/screens/mapScreen.ts';
import type { StationScreen, StationStatus } from '../ui/screens/station.ts';
import type { WorkbenchScreen } from '../ui/screens/workbench.ts';
import { statusView } from '../ui/status.ts';
import type { MapModel } from './mapModel.ts';
import { canReroll, progressOf } from './progressModel.ts';

/** Seconds between two refreshes of the HUD and the open screens (10 Hz). */
const REFRESH_SECONDS = 0.1;

/** The views the bridge keeps up to date. */
export interface InventoryViews {
  readonly hotbar: Hotbar;
  readonly hint: HudHint;
  readonly bag: BagScreen;
  readonly container: ContainerScreen;
  readonly station: StationScreen;
  readonly workbench: WorkbenchScreen;
  readonly map: MapScreen;
  readonly maps: MapModel;
}

type OpenScreen = 'bag' | 'container' | 'station' | 'workbench' | 'map' | null;

/**
 * Refreshes the hotbar and the open screen (the bag with its Logbook, a chest, a station, a
 * workbench with its own Logbook, the big map) with the cursor stack, from the player's live state: at 10 Hz,
 * at once after an inventory, craft or block entity event, when the selected slot changes and when
 * a screen opens. The views diff what they show, so a refresh that changes nothing touches no DOM.
 * The player's hints (SimEvent `hint`) go to the HUD hint line.
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
      case 'stackedNearby':
        this.views.hint.show(
          event.count > 0
            ? t('hint.stacked', { n: event.count, chests: event.chests })
            : t(event.chests > 0 ? 'hint.stackedNone' : 'hint.noChest'),
        );
        this.dirty = true;
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
      open === this.shown &&
      !(open === 'map' && this.views.map.stale)
    )
      return;
    this.dirty = false;
    this.elapsed = 0;
    this.shown = open;
    const inventory = this.player.inventory;
    hotbar.update(inventory, this.input.slot);
    if (open === 'bag') this.bagScreen();
    else if (open === 'map') this.mapScreen();
    else if (open) this.blockScreen(open);
  }

  /** The big map, centred where it was dragged (a pixel a block). */
  private mapScreen(): void {
    const { map, maps } = this.views;
    const body = this.player.body;
    const centre = map.centreFor(body.x, body.z);
    map.update(maps.view(this.player, BIG_MAP_RADIUS, centre.x, centre.z));
  }

  private openScreen(): OpenScreen {
    const { bag, container, station, workbench, map } = this.views;
    if (bag.isOpen()) return 'bag';
    if (container.isOpen()) return 'container';
    if (station.isOpen()) return 'station';
    if (workbench.isOpen()) return 'workbench';
    return map.isOpen() ? 'map' : null;
  }

  /**
   * A Logbook's view of the player and a queue (the player's, for the hand recipes; a workbench's,
   * for its station's): the simulation's own ingredient count and queue room.
   */
  private logbook(
    queue: readonly CraftEntry[],
    station?: string,
    chests: readonly Inventory[] = [],
  ): LogbookState {
    const registry = this.view.registry;
    const crafting = registry.crafting;
    const player = this.player;
    // What the crafts may take: the inventory, and at a workbench the chests near it (« M32 »).
    const sources = [player.inventory, ...chests];
    return {
      source: {
        crafting,
        ...(station === undefined ? {} : { station }),
        seen: player.seen,
        level: levelOf(player.xp, registry.pack.balance.progression),
        owned: (ingredient) => {
          let owned = 0;
          for (const slots of sources)
            owned += countMatching(slots, 0, slots.length, crafting, ingredient);
          return owned;
        },
        room: (recipe) => queueRoom(registry, queue, recipe),
      },
      queue: queue.map((entry) => queueView(registry, entry)),
    };
  }

  /** The Bag: the inventory then the worn items, the cursor stack, the protection and the Logbook. */
  private bagScreen(): void {
    const { inventory, equipment, craft, cursor } = this.player;
    const gear = wornGear(this.view.registry, equipment, this.gear);
    const bestiary = bestiaryRows(this.view.registry, this.player.bestiary);
    const registry = this.view.registry;
    const player = this.player;
    const quests = questRows(registry, player.quests, player.pinned);
    const reroll = canReroll(player, this.view.time().ticks);
    const tasks = taskRows(registry, player.tasks, reroll);
    const balance = registry.pack.balance;
    const progress = progressOf(player, balance);
    const status = statusView(progress, balance.progression, SKILLS, balance.health.max);
    this.views.bag.update(
      screenSlots(inventory, equipment),
      cursor,
      this.logbook(craft),
      gear,
      bestiary,
      quests,
      tasks,
      status,
    );
  }

  /**
   * The open chest, station or workbench: the inventory then its slots (and a station's fire, a
   * workbench's Logbook).
   */
  private blockScreen(open: 'container' | 'station' | 'workbench'): void {
    const screen = this.player.screen;
    const entity =
      screen?.kind === 'block' ? this.view.blockEntity(screen.x, screen.y, screen.z) : undefined;
    if (entity?.kind !== open) return;
    const { inventory, cursor } = this.player;
    const slots = screenSlots(inventory, entity.slots);
    const { container, workbench, station } = this.views;
    if (entity.kind === 'container') container.update(slots, cursor);
    else if (entity.kind === 'workbench') {
      const near = chestsNear(
        (x, y, z) => this.view.blockEntity(x, y, z),
        entity.x,
        entity.y,
        entity.z,
        BENCH_RADIUS,
      ).map((chest) => chest.slots);
      workbench.update(slots, cursor, this.logbook(entity.craft, entity.station, near));
    } else station.update(slots, cursor, stationStatus(this.view.registry, entity));
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
