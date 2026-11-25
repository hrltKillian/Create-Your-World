import { describe, expect, it } from 'vitest';
import { queueView, stationStatus, UiBridge } from '../../../src/app/UiBridge.ts';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { addStrings } from '../../../src/i18n/i18n.ts';
import type { InputManager } from '../../../src/input/InputManager.ts';
import type { BlockEntity, StationEntity } from '../../../src/sim/blockEntities.ts';
import { ticksOf } from '../../../src/sim/clock.ts';
import { OPEN_SLOTS_BASE } from '../../../src/sim/commands.ts';
import type { Gear } from '../../../src/sim/environment.ts';
import type { SimView } from '../../../src/sim/host.ts';
import { createInventory, type Inventory, type ItemStack } from '../../../src/sim/inventory.ts';
import type { Hotbar } from '../../../src/ui/hud/hotbar.ts';
import type { HudHint } from '../../../src/ui/hud/hudHint.ts';
import type { BagScreen } from '../../../src/ui/screens/bag.ts';
import type { ContainerScreen } from '../../../src/ui/screens/container.ts';
import type { LogbookState } from '../../../src/ui/screens/logbook.ts';
import type { StationScreen, StationStatus } from '../../../src/ui/screens/station.ts';
import type { WorkbenchScreen } from '../../../src/ui/screens/workbench.ts';
import { registry } from '../../helpers/registry.ts';

/** The cursor stack a screen shows. */
type Cursor = ItemStack | null;

/** A screen stand-in that records its updates. */
function screen<T extends unknown[]>() {
  return {
    open: false,
    updates: [] as T[],
    isOpen() {
      return this.open;
    },
    update(...args: T) {
      this.updates.push(args);
    },
  };
}

function setup(entity?: BlockEntity) {
  const hotbar = {
    selected: -1,
    updates: 0,
    update(_inventory: unknown, selected: number) {
      this.updates++;
      this.selected = selected;
    },
  };
  const hint = {
    shown: [] as string[],
    elapsed: 0,
    show(text: string) {
      this.shown.push(text);
    },
    frame(dt: number) {
      this.elapsed += dt;
    },
  };
  const bag = screen<[Inventory, Cursor, LogbookState, Gear]>();
  const container = screen<[Inventory, Cursor]>();
  const station = screen<[Inventory, Cursor, StationStatus]>();
  const workbench = screen<[Inventory, Cursor, LogbookState]>();
  const input = { slot: 0 };
  const player = {
    playerId: 1,
    inventory: createInventory(),
    equipment: [null, null, null, null, null] as Inventory,
    bestiary: {},
    quests: {},
    pinned: null,
    seen: {},
    craft: [],
    cursor: null as Cursor,
    screen: entity ? { kind: 'block', x: entity.x, y: entity.y, z: entity.z } : null,
  };
  const view = {
    registry,
    player: () => player,
    blockEntity: () => entity,
  };
  const bridge = new UiBridge(view as unknown as SimView, input as unknown as InputManager, {
    hotbar: hotbar as unknown as Hotbar,
    hint: hint as unknown as HudHint,
    bag: bag as unknown as BagScreen,
    container: container as unknown as ContainerScreen,
    station: station as unknown as StationScreen,
    workbench: workbench as unknown as WorkbenchScreen,
  });
  return { bridge, hotbar, bag, container, station, workbench, hint, input, player };
}

const FRAME = 1 / 60;

function kiln(): StationEntity {
  return {
    kind: 'station',
    x: 1,
    y: 2,
    z: 3,
    station: 'station:kiln',
    slots: [null, null, { item: 'item:charcoal', count: 2 }, null],
    burnTicksLeft: 600,
    burnTicks: 2400,
    progressTicks: ticksOf(10) / 2,
    process: 'process:copper_ingot',
    lit: true,
    keepLit: false,
    tick: 0,
  };
}

describe('UiBridge', () => {
  it('refreshes at once after an inventory event of its player, else at 10 Hz', () => {
    const { bridge, hotbar } = setup();
    bridge.frame(FRAME);
    expect(hotbar.updates).toBe(1);
    bridge.frame(FRAME);
    bridge.onEvent({ type: 'inventoryChanged', playerId: 2 });
    bridge.frame(FRAME);
    expect(hotbar.updates).toBe(1);
    bridge.onEvent({ type: 'inventoryChanged', playerId: 1 });
    bridge.frame(FRAME);
    expect(hotbar.updates).toBe(2);
    bridge.onEvent({ type: 'crafted', playerId: 1, recipe: 'r', item: 'i', count: 1 });
    bridge.frame(FRAME);
    expect(hotbar.updates).toBe(3);
    for (let i = 0; i < 7; i++) bridge.frame(FRAME);
    expect(hotbar.updates).toBe(4);
  });

  it('follows the selected slot and refreshes the bag and its Logbook only while it is open', () => {
    const { bridge, hotbar, bag, input, player } = setup();
    bridge.frame(FRAME);
    input.slot = 5;
    bridge.frame(FRAME);
    expect(hotbar.selected).toBe(5);
    expect(bag.updates).toHaveLength(0);
    bag.open = true;
    player.inventory[3] = { item: 'item:broadleaf_log', count: 4 };
    player.equipment[2] = { item: 'item:fur_coat', count: 1 };
    bridge.frame(FRAME);
    expect(bag.updates).toHaveLength(1);
    // The inventory, then the worn items (slots 64–68) and what they protect from.
    const [slots, cursor, logbook, gear] = bag.updates[0]!;
    expect(cursor).toBeNull();
    expect(slots).toHaveLength(OPEN_SLOTS_BASE + 5);
    expect(slots[3]).toEqual({ item: 'item:broadleaf_log', count: 4 });
    expect(slots[OPEN_SLOTS_BASE + 2]).toEqual({ item: 'item:fur_coat', count: 1 });
    expect(gear).toMatchObject({ armor: 2, warmth: 10, cooling: 0 });
    // The simulation's own count: a tag ingredient counts every item carrying it.
    expect(logbook.source.owned('tag:log')).toBe(4);
    // The hand recipes, with the room the player's own queue has.
    expect(logbook.source.station).toBeUndefined();
    expect(logbook.source.room(registry.crafting.recipe('recipe:cord')!)).toBe(5 * 64);
    expect(logbook.queue).toEqual([]);
    // The cursor stack the simulation holds for the player shows with the slots.
    player.cursor = { item: 'item:flint', count: 3 };
    bridge.onEvent({ type: 'inventoryChanged', playerId: 1 });
    bridge.frame(FRAME);
    expect(bag.updates.at(-1)![1]).toEqual({ item: 'item:flint', count: 3 });
  });

  it('shows the open chest or station from slot 64 on, with the station fire', () => {
    const chest: BlockEntity = { kind: 'container', x: 0, y: 0, z: 0, slots: [null, null] };
    const a = setup(chest);
    a.container.open = true;
    a.bridge.frame(FRAME);
    expect(a.container.updates[0]![0]).toHaveLength(OPEN_SLOTS_BASE + 2);
    const b = setup(kiln());
    b.station.open = true;
    b.bridge.frame(FRAME);
    const [slots, , status] = b.station.updates[0]!;
    expect(slots[OPEN_SLOTS_BASE + 2]).toEqual({ item: 'item:charcoal', count: 2 });
    expect(status).toEqual({
      lit: true,
      flame: 0.25,
      progress: 0.5,
      process: 'process:copper_ingot',
      keepLit: false,
    });
  });

  it("shows an open workbench's outputs and its Logbook: the bench's recipes and queue", () => {
    const entry = { recipe: 'recipe:chest', count: 2, progressTicks: 45, reserved: [] };
    const bench: BlockEntity = {
      kind: 'workbench',
      x: 0,
      y: 0,
      z: 0,
      station: 'station:workbench',
      slots: [{ item: 'item:chest', count: 1 }, null, null, null],
      craft: [entry],
      tick: 0,
    };
    const s = setup(bench);
    s.workbench.open = true;
    s.bridge.frame(FRAME);
    const [slots, , logbook] = s.workbench.updates[0]!;
    expect(slots[OPEN_SLOTS_BASE]).toEqual({ item: 'item:chest', count: 1 });
    expect(logbook.source.station).toBe('station:workbench');
    expect(logbook.queue).toEqual([queueView(registry, entry)]);
    // The bench's queue: the chest's entry takes 62 more, then 4 free entries of 64.
    expect(logbook.source.room(registry.crafting.recipe('recipe:chest')!)).toBe(62 + 4 * 64);
  });

  it("shows its player's hints, translated, and keeps the hint line's clock running", () => {
    addStrings(basePack.strings);
    const { bridge, hint } = setup();
    const weak = { key: 'hint.toolTooWeak', params: { tier: 'tier.copper', tool: 'tool.pick' } };
    bridge.onEvent({ type: 'hint', playerId: 2, ...weak });
    expect(hint.shown).toEqual([]);
    bridge.onEvent({ type: 'hint', playerId: 1, ...weak });
    expect(hint.shown).toEqual(['Tool too weak: Copper pickaxe required']);
    bridge.frame(FRAME);
    bridge.frame(FRAME);
    expect(hint.elapsed).toBeCloseTo(2 * FRAME);
  });

  it('gives queue entries and stations their progress from the recipe and process times', () => {
    const entry = { recipe: 'recipe:flint_hatchet', count: 3, progressTicks: 15, reserved: [] };
    expect(queueView(registry, entry)).toEqual({
      recipe: 'recipe:flint_hatchet',
      count: 3,
      progress: 15 / ticksOf(2),
    });
    const cold = { ...kiln(), burnTicks: 0, burnTicksLeft: 0, process: '', progressTicks: 0 };
    expect(stationStatus(registry, { ...cold, lit: false })).toEqual({
      lit: false,
      flame: 0,
      progress: 0,
      process: '',
      keepLit: false,
    });
  });

  it('shows an idle kiln with fuel time left as banked (not lit), its flame size kept', () => {
    // Its ore taken out mid-burn: the fire stops (`lit` false) with 600 of 2400 ticks left.
    const banked = { ...kiln(), process: '', progressTicks: 0, lit: false };
    expect(stationStatus(registry, banked)).toEqual({
      lit: false,
      flame: 0.25,
      progress: 0,
      process: '',
      keepLit: false,
    });
    // A campfire kept burning says so (its screen's toggle).
    expect(stationStatus(registry, { ...banked, keepLit: true }).keepLit).toBe(true);
  });
});
