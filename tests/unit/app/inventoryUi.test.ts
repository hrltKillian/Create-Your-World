import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameSession } from '../../../src/app/GameSession.ts';
import { InventoryUi } from '../../../src/app/inventoryUi.ts';
import type { PlayGate } from '../../../src/app/playGate.ts';
import type { AudioEngine } from '../../../src/audio/AudioEngine.ts';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { addStrings } from '../../../src/i18n/i18n.ts';
import { DEFAULT_BINDINGS } from '../../../src/input/bindings.ts';
import type { InputManager } from '../../../src/input/InputManager.ts';
import type { SimEvent } from '../../../src/sim/events.ts';
import { type FakeElement, installFakeDom, removeFakeDom } from '../../helpers/fakeDom.ts';
import { registry } from '../../helpers/registry.ts';
import { playerTestSim } from '../../helpers/simHarness.ts';

/*
 * The screens of chests and stations against the gate: the simulation opens and closes them, and
 * a close caused by the player's death leaves the gate's screen to the death screen.
 */

// No canvas under Node: the icons are counted, not drawn.
const iconSets = vi.hoisted(() => ({ made: 0 }));
vi.mock('../../../src/assets/procedural/iconGen.ts', () => ({
  createItemIcons: async () => {
    iconSets.made++;
    return [];
  },
}));

const win = globalThis as { window?: unknown };
/** The UI's keydown listener on the window. */
let keydown: (event: KeyboardEvent) => void = () => {};
/** A station just north of the player. */
const CAMPFIRE = { x: 0, y: 65, z: -2 };

beforeEach(() => {
  installFakeDom();
  win.window = {
    addEventListener: (type: string, listener: (event: KeyboardEvent) => void) => {
      if (type === 'keydown') keydown = listener;
    },
    removeEventListener: () => {},
  };
  addStrings(basePack.strings);
});
afterEach(() => {
  delete win.window;
  removeFakeDom();
});

/** A session over a test simulation whose events reach the UI, a gate that records its calls. */
function setup() {
  const s = playerTestSim({ seed: 'inventory-ui' });
  const listeners: ((event: SimEvent) => void)[] = [];
  const session = { host: s.host, player: s.player, listeners };
  const gate = {
    screenOpen: false,
    closes: 0,
    canOpenScreen() {
      return !this.screenOpen;
    },
    openScreen() {
      this.screenOpen = true;
    },
    closeScreen() {
      this.screenOpen = false;
      this.closes++;
    },
  };
  const input = { slot: 0, keyLabel: () => 'E', bindings: DEFAULT_BINDINGS };
  const layer = document.createElement('div') as unknown as HTMLElement;
  const ui = new InventoryUi(
    layer,
    registry,
    [],
    session as unknown as GameSession,
    input as unknown as InputManager,
    gate as unknown as PlayGate,
    { playUi: () => {} } as unknown as AudioEngine,
  );
  /** Sends commands for one tick and hands that tick's events to the UI. */
  const send = (...commands: Parameters<typeof s.send>) => {
    for (const event of s.send(...commands)) for (const listener of listeners) listener(event);
  };
  s.put(CAMPFIRE.x, CAMPFIRE.y, CAMPFIRE.z, 'block:campfire[lit=0]');
  return { ...s, ui, gate, send };
}

describe('InventoryUi', () => {
  it('closes a station on a death without releasing the gate, which the death screen takes', () => {
    const { ui, gate, send } = setup();
    send({ type: 'debug.open', ...CAMPFIRE });
    expect(ui.screen()).toBe('station');
    expect(gate.screenOpen).toBe(true);
    send({ type: 'debug.setStat', stat: 'health', value: 0 });
    expect(ui.screen()).toBeNull();
    // Not back to play: the gate's screen is still up, for the death screen.
    expect(gate.closes).toBe(0);
    expect(gate.screenOpen).toBe(true);
  });

  it('closes a station the player walked away from back to play', () => {
    const { ui, gate, send } = setup();
    send({ type: 'debug.open', ...CAMPFIRE });
    expect(ui.screen()).toBe('station');
    send({ type: 'debug.teleport', x: 20.5, y: 65, z: 0.5 });
    expect(ui.screen()).toBeNull();
    expect(gate.closes).toBe(1);
    expect((ui.station.element as unknown as FakeElement).hidden).toBe(true);
  });

  it("cancels Tab's focus move when it closes the bag, a clicked button holding the focus", () => {
    const { ui, gate } = setup();
    const press = () => {
      const event = { code: 'Tab', repeat: false, defaultPrevented: false } as KeyboardEvent;
      (event as { preventDefault(): void }).preventDefault = () => {
        (event as { defaultPrevented: boolean }).defaultPrevented = true;
      };
      keydown(event);
      return event.defaultPrevented;
    };
    ui.toggleBag();
    expect(ui.screen()).toBe('bag');
    expect(press()).toBe(true);
    expect(ui.screen()).toBeNull();
    expect(gate.closes).toBe(1);
    // Paused (no screen may open): Tab keeps its browser action, for the menus' controls.
    gate.screenOpen = true;
    expect(press()).toBe(false);
  });

  it('closes the bag, a chest or a station on Esc back to play, the Esc consumed', () => {
    const { ui, gate, send, player } = setup();
    const esc = () => {
      const event = { code: 'Escape', repeat: false, defaultPrevented: false } as KeyboardEvent;
      (event as { preventDefault(): void }).preventDefault = () => {
        (event as { defaultPrevented: boolean }).defaultPrevented = true;
      };
      keydown(event);
      return event.defaultPrevented;
    };
    ui.toggleBag();
    expect(ui.screen()).toBe('bag');
    // Consumed, so the app's pause key handler leaves it alone.
    expect(esc()).toBe(true);
    expect(ui.screen()).toBeNull();
    expect(gate).toMatchObject({ screenOpen: false, closes: 1 });
    send({ type: 'debug.open', ...CAMPFIRE });
    expect(ui.screen()).toBe('station');
    expect(esc()).toBe(true);
    expect(ui.screen()).toBeNull();
    expect(gate).toMatchObject({ screenOpen: false, closes: 2 });
    // The simulation closes the station too.
    send();
    expect(player.screen).toBeNull();
    // In play with no screen, Esc is the app's (the pause menu).
    expect(esc()).toBe(false);
  });

  it("leaves the keys typed in the Logbook's search to it, but Esc", () => {
    const { ui } = setup();
    const search = { tagName: 'INPUT', type: 'search' };
    const typed = (code: string) => {
      const event = {
        code,
        repeat: false,
        defaultPrevented: false,
        target: search,
        preventDefault() {
          event.defaultPrevented = true;
        },
      };
      keydown(event as unknown as KeyboardEvent);
      return event.defaultPrevented;
    };
    ui.toggleBag();
    // E (the bag's key), Tab and a hotbar number type into the box: the bag stays open.
    for (const code of ['KeyE', 'Tab', 'Digit2']) expect(typed(code)).toBe(false);
    expect(ui.screen()).toBe('bag');
    expect(typed('Escape')).toBe(true);
    expect(ui.screen()).toBeNull();
  });

  it('draws the item icons once for every world opened with the same content', () => {
    const before = iconSets.made;
    setup();
    setup();
    expect(iconSets.made - before).toBeLessThanOrEqual(1);
  });
});
