import { describe, expect, it } from 'vitest';
import { UiBridge } from '../../../src/app/UiBridge.ts';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { addStrings } from '../../../src/i18n/i18n.ts';
import type { InputManager } from '../../../src/input/InputManager.ts';
import { createInventory } from '../../../src/sim/inventory.ts';
import type { PlayerState } from '../../../src/sim/player.ts';
import type { Hotbar } from '../../../src/ui/hud/hotbar.ts';
import type { HudHint } from '../../../src/ui/hud/hudHint.ts';
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
  const input = { slot: 0 };
  const player = { playerId: 1, inventory: createInventory() };
  const bridge = new UiBridge(
    player as unknown as PlayerState,
    input as unknown as InputManager,
    hotbar as unknown as Hotbar,
    bag as unknown as BagScreen,
    hint as unknown as HudHint,
  );
  return { bridge, hotbar, bag, hint, input };
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
});
