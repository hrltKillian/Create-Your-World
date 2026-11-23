import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameSession } from '../../../src/app/GameSession.ts';
import { HudBridge } from '../../../src/app/HudBridge.ts';
import { hudEffects, targetText } from '../../../src/app/hudModel.ts';
import type { InventoryUi } from '../../../src/app/inventoryUi.ts';
import type { PlayGate } from '../../../src/app/playGate.ts';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { addStrings } from '../../../src/i18n/i18n.ts';
import type { InputManager } from '../../../src/input/InputManager.ts';
import type { Command } from '../../../src/sim/commands.ts';
import { createPlayer, type PlayerState } from '../../../src/sim/player.ts';
import { createTime } from '../../../src/sim/time.ts';
import type { HudEffect } from '../../../src/ui/hud/effects.ts';
import { type FakeElement, installFakeDom, removeFakeDom } from '../../helpers/fakeDom.ts';
import { registry } from '../../helpers/registry.ts';

/*
 * The HUD's view of the simulation (statuses, the aimed block's line) and the death screen's
 * hand-over with the open screen and the mouse. Thresholds come from the pack's balance.
 */

const b = registry.pack.balance;
const keys = (effects: readonly HudEffect[]) => effects.map((e) => e.key);
const block = (key: string) => registry.defaultState(key as `block:${string}`);
const item = (key: string) => registry.itemId(key);

beforeEach(() => {
  installFakeDom();
  addStrings(basePack.strings);
});
afterEach(removeFakeDom);

describe('HUD model', () => {
  it('lists the statuses past the balance thresholds, the most pressing first', () => {
    const player = createPlayer(1, 0, 65, 0, 2, b);
    const out: HudEffect[] = [];
    expect(hudEffects(player, b, out)).toEqual([]);
    const s = player.survival;
    s.temperature = -b.temperature.severeAt;
    s.hunger = 0;
    s.toxicity = b.toxicity.nauseousAt;
    s.thirst = b.thirst.lowAt - 1;
    s.shelter = 'enclosed';
    s.effects.push({ key: 'weakened', ticks: 90 });
    player.exhausted = true;
    expect(hudEffects(player, b, out)).toBe(out);
    expect(keys(out)).toEqual([
      'freezing',
      'starving',
      'nauseous',
      'thirsty',
      'exhausted',
      'weakened',
      'sheltered',
    ]);
    expect(out.find((e) => e.key === 'weakened')!.seconds).toBe(3);
    s.temperature = b.temperature.mildAt;
    s.toxicity = b.toxicity.harmAt;
    s.breath = 0;
    player.body.headInWater = true;
    expect(keys(hudEffects(player, b, out)).slice(0, 4)).toEqual([
      'drowning',
      'starving',
      'poisoned',
      'hot',
    ]);
  });

  it('names the aimed block with the tier it needs, or how to sleep on a bedroll', () => {
    const stone = block('block:stone');
    expect(targetText(registry, stone, -1, 'Right click')).toEqual({
      name: 'Stone',
      hint: 'Flint pickaxe needed',
    });
    expect(targetText(registry, stone, item('item:flint_pickaxe'), 'Right click').hint).toBeNull();
    const bed = registry.pack.blocks.find((def) => def.blockEntity === 'bed')!;
    expect(targetText(registry, block(bed.key), -1, 'Right click').hint).toBe(
      'Right click to sleep',
    );
  });
});

/** A play session with the local player, a gate and an inventory that record what they do. */
function setup() {
  const player = createPlayer(1, 0, 65, 0, 2, b);
  const sent: Command[] = [];
  const gate = {
    screenOpen: false,
    playing: true,
    relocks: 0,
    canOpenScreen() {
      return !this.screenOpen && this.playing;
    },
    openScreen() {
      this.screenOpen = true;
    },
    closeScreen(relock: boolean) {
      this.screenOpen = false;
      if (relock) this.relocks++;
    },
  };
  const inventory = {
    open: null as string | null,
    hint: {
      shown: [] as string[],
      show(text: string) {
        this.shown.push(text);
      },
    },
    screen() {
      return this.open;
    },
    hideScreen() {
      this.open = null;
    },
  };
  const listeners: ((event: unknown) => void)[] = [];
  const session = {
    player,
    rig: { yaw: 0 },
    aim: { hit: { hit: false, state: 0 } },
    listeners,
    host: {
      view: { registry, time: () => createTime() },
      send: (command: Command) => sent.push(command),
    },
  };
  const input = { slot: 0, keyLabel: () => 'Right click' };
  const layer = document.createElement('div') as unknown as FakeElement;
  const bridge = new HudBridge(
    layer as unknown as HTMLElement,
    session as unknown as GameSession,
    input as unknown as InputManager,
    gate as unknown as PlayGate,
    inventory as unknown as InventoryUi,
  );
  const die = (p: PlayerState) => {
    p.survival.health = 0;
    p.survival.dead = true;
    p.survival.cause = 'fall';
  };
  return { bridge, player, sent, gate, inventory, listeners, layer, die };
}

describe('HudBridge', () => {
  it('puts the HUD under the play layer and the death screen over it', () => {
    const { layer, bridge } = setup();
    expect(layer.childNodes[0]).toBe(bridge.hud.element);
    expect(layer.childNodes.at(-1)).toBe(bridge.hud.death.element);
  });

  it('opens the death screen in the open screen’s place and gives the mouse back on Respawn', () => {
    const { bridge, player, sent, gate, inventory, die } = setup();
    inventory.open = 'bag';
    gate.screenOpen = true;
    bridge.frame(0.1);
    expect(bridge.deathOpen()).toBe(false);
    die(player);
    bridge.frame(0.1);
    expect(bridge.deathOpen()).toBe(true);
    expect(inventory.open).toBeNull();
    expect(gate.screenOpen).toBe(true);
    const screen = bridge.hud.death.element as unknown as FakeElement;
    expect(screen.querySelector('.death-cause')!.textContent).toBe('Fell from too high');
    screen.findAction('respawn')!.dispatch('click');
    expect(sent).toEqual([{ type: 'player.respawn' }]);
    expect(bridge.deathOpen()).toBe(false);
    expect(gate).toMatchObject({ screenOpen: false, relocks: 1 });
    // Until the simulation brings the player back, the screen stays shut.
    bridge.frame(0.1);
    expect(bridge.deathOpen()).toBe(false);
    player.survival.dead = false;
    bridge.frame(0.1);
    die(player);
    bridge.frame(0.1);
    expect(bridge.deathOpen()).toBe(true);
  });

  it('shows over the click-to-play overlay without taking the gate, as when a world opens dead', () => {
    const { bridge, player, gate, die } = setup();
    gate.playing = false;
    die(player);
    bridge.frame(0.1);
    expect(bridge.deathOpen()).toBe(true);
    expect(gate.screenOpen).toBe(false);
    // Brought back another way (the hook's respawn): the screen goes, the gate is left alone.
    player.survival.dead = false;
    bridge.frame(0.1);
    expect(bridge.deathOpen()).toBe(false);
    expect(gate.relocks).toBe(0);
    // Dead again while paused, then play resumes: the screen takes the gate, freeing the mouse.
    die(player);
    bridge.frame(0.1);
    expect(gate.screenOpen).toBe(false);
    gate.playing = true;
    bridge.frame(0.1);
    expect(bridge.deathOpen()).toBe(true);
    expect(gate.screenOpen).toBe(true);
  });

  it('turns objectives, the clock and the night into lines and banners', () => {
    const { bridge, inventory, listeners } = setup();
    const chain = registry.pack.objectives!;
    for (const listener of listeners) {
      listener({ type: 'objectiveDone', playerId: 1, objective: chain[0]!.key });
      listener({ type: 'nightSurvived', night: 2 });
    }
    expect(inventory.hint.shown).toEqual([
      `Objective complete: ${basePack.strings[chain[0]!.textKey]}`,
    ]);
    const banner = bridge.hud.banner.element as unknown as FakeElement;
    expect(banner.textContent).toBe('Night 2 survived');
    expect(banner.classList.contains('play')).toBe(true);
    bridge.frame(0.1);
    const clock = bridge.hud.clock as unknown as FakeElement;
    expect(clock.textContent).toBe('07:00 · Day 1');
  });
});
