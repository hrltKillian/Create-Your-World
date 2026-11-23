import { describe, expect, it } from 'vitest';
import { UiBridge } from '../../../src/app/UiBridge.ts';
import type { InputManager } from '../../../src/input/InputManager.ts';
import { createInventory } from '../../../src/sim/inventory.ts';
import type { PlayerState } from '../../../src/sim/player.ts';
import type { Hotbar } from '../../../src/ui/hud/hotbar.ts';
import type { BagScreen } from '../../../src/ui/screens/bag.ts';

function setup() {
  const hotbar = {
    selected: -1,
    updates: 0,
    update(_inventory: unknown, selected: number) {
      this.updates++;
      this.selected = selected;
    },
  };
  const bag = {
    open: false,
    updates: 0,
    isOpen() {
      return this.open;
    },
    update() {
      this.updates++;
    },
  };
  const input = { slot: 0 };
  const player = { playerId: 1, inventory: createInventory() };
  const bridge = new UiBridge(
    player as unknown as PlayerState,
    input as unknown as InputManager,
    hotbar as unknown as Hotbar,
    bag as unknown as BagScreen,
  );
  return { bridge, hotbar, bag, input };
}

const FRAME = 1 / 60;

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
    for (let i = 0; i < 7; i++) bridge.frame(FRAME);
    expect(hotbar.updates).toBe(3);
  });

  it('follows the selected slot and refreshes the bag only while it is open', () => {
    const { bridge, hotbar, bag, input } = setup();
    bridge.frame(FRAME);
    input.slot = 5;
    bridge.frame(FRAME);
    expect(hotbar.selected).toBe(5);
    expect(bag.updates).toBe(0);
    bag.open = true;
    bridge.frame(FRAME);
    expect(bag.updates).toBe(1);
  });
});
