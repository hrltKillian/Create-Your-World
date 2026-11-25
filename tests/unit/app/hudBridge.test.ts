import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameSession } from '../../../src/app/GameSession.ts';
import { HudBridge } from '../../../src/app/HudBridge.ts';
import { BIOME_SETTLE_SECONDS, BiomeWatch, targetText } from '../../../src/app/hudModel.ts';
import type { InventoryUi } from '../../../src/app/inventoryUi.ts';
import type { PlayGate } from '../../../src/app/playGate.ts';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { addStrings } from '../../../src/i18n/i18n.ts';
import type { InputManager } from '../../../src/input/InputManager.ts';
import type { Command } from '../../../src/sim/commands.ts';
import { createPlayer, type PlayerState } from '../../../src/sim/player.ts';
import { createTime } from '../../../src/sim/time.ts';
import { QUEST_NEWS_SECONDS } from '../../../src/ui/hud/hud.ts';
import { MINIMAP_RADIUS } from '../../../src/ui/map.ts';
import { VoxelWorld } from '../../../src/world/VoxelWorld.ts';
import { type FakeElement, installFakeDom, removeFakeDom } from '../../helpers/fakeDom.ts';
import { registry } from '../../helpers/registry.ts';

/*
 * The HUD's view of the simulation (the aimed block's line) and the death screen's
 * hand-over with the open screen and the mouse. Thresholds come from the pack's balance.
 */

const b = registry.pack.balance;
const block = (key: string) => registry.defaultState(key as `block:${string}`);
const item = (key: string) => registry.itemId(key);

beforeEach(() => {
  installFakeDom();
  addStrings(basePack.strings);
});
afterEach(removeFakeDom);

describe('HUD model', () => {
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

/** The pack's biomes as the generation lists them (by order). */
const biomes = [...registry.pack.biomes!].sort((p, q) => p.order - q.order).map((def) => ({ def }));

/**
 * A play session with the local player, a gate and an inventory that record what they do, over
 * one loaded column (0, 0) whose west half (x < 16) is biome 0 and east half biome 1.
 */
function setup(tips: { dusk(): boolean } | null = null) {
  const player = createPlayer(1, 0, 65, 0, 2, b);
  const sent: Command[] = [];
  const gate = {
    screenOpen: false,
    playing: true,
    relocks: 0,
    canOpenScreen() {
      return !this.screenOpen && this.playing;
    },
    screenIsOpen() {
      return this.screenOpen;
    },
    openScreen() {
      this.screenOpen = true;
    },
    closeScreen() {
      this.screenOpen = false;
      this.relocks++;
    },
  };
  // Column (0, 0) only: biome 0 west of x 16, biome 1 east of it.
  const world = new VoxelWorld(0, 0);
  world.setBlock(0, 0, 0, 0);
  const column = world.getColumn(0, 0)!;
  for (let z = 0; z < 32; z++) for (let x = 16; x < 32; x++) column.biomes[x | (z << 5)] = 1;
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
    maps: {
      radii: [] as number[],
      view(_player: unknown, radius: number) {
        this.radii.push(radius);
        return { columns: [], player: { x: 0.5, z: 0.5, yaw: 0 }, waypoints: [] };
      },
    },
  };
  const listeners: ((event: unknown) => void)[] = [];
  const session = {
    player,
    rig: { yaw: 0 },
    aim: { hit: { hit: false, state: 0 }, creature: undefined as unknown },
    listeners,
    host: {
      view: { registry, time: () => createTime(), world, gen: { biomes } },
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
    tips,
  );
  const die = (p: PlayerState) => {
    p.survival.health = 0;
    p.survival.dead = true;
    p.survival.cause = 'fall';
  };
  const emit = (event: unknown) => {
    for (const listener of listeners) listener(event);
  };
  return { bridge, player, sent, gate, inventory, listeners, layer, die, emit, session };
}

describe('HudBridge', () => {
  it('names the aimed creature before the block behind it, unknown until met', () => {
    const { bridge, session } = setup();
    const line = bridge.hud.target.element as unknown as FakeElement;
    session.aim.hit = { hit: true, state: block('block:stone') };
    bridge.frame(0.1);
    expect(line.querySelector('.target-name')!.textContent).toBe('Stone');
    session.aim.creature = { kind: 'creature', creature: 'creature:trotter' };
    bridge.frame(0.1);
    expect(line.querySelector('.target-name')!.textContent).toBe('Unknown creature');
    session.player.bestiary['creature:trotter'] = 1;
    bridge.frame(0.1);
    expect(line.querySelector('.target-name')!.textContent).toBe('Trotter');
    expect(line.querySelector('.target-hint')!.hidden).toBe(true);
  });

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

  it('takes the gate over from a station a death closed, so Respawn captures the mouse', () => {
    const { bridge, player, gate, inventory, die } = setup();
    inventory.open = 'station';
    gate.screenOpen = true;
    bridge.frame(0.1);
    // The death closes the station: its view goes, the gate stays open for the death screen.
    die(player);
    inventory.open = null;
    bridge.frame(0.1);
    expect(bridge.deathOpen()).toBe(true);
    const screen = bridge.hud.death.element as unknown as FakeElement;
    screen.findAction('respawn')!.dispatch('click');
    expect(gate).toMatchObject({ screenOpen: false, relocks: 1 });
  });

  it('says where the belongings wait only when the death left a pack', () => {
    const { bridge, player, die, emit } = setup();
    const screen = bridge.hud.death.element as unknown as FakeElement;
    const packLine = () => screen.querySelector('.death-pack')!.hidden === false;
    die(player);
    bridge.frame(0.1);
    expect(bridge.deathOpen()).toBe(true);
    expect(packLine()).toBe(false);
    screen.findAction('respawn')!.dispatch('click');
    player.survival.dead = false;
    emit({ type: 'respawned', playerId: 1, x: 0, y: 65, z: 0 });
    bridge.frame(0.1);
    player.survival.packLeft = true;
    die(player);
    bridge.frame(0.1);
    expect(packLine()).toBe(true);
  });

  it('opens a world saved dead with the pack line only when that death left a pack', () => {
    // An older pack does not count: the last death left none.
    for (const packLeft of [false, true]) {
      const { bridge, player, die } = setup();
      player.graves = [{ x: 3, y: 65, z: 3 }];
      player.survival.packLeft = packLeft;
      die(player);
      bridge.frame(0.1);
      const screen = bridge.hud.death.element as unknown as FakeElement;
      expect(screen.querySelector('.death-pack')!.hidden).toBe(!packLeft);
    }
  });

  it('lists the items the local player picks up, by name, and lets them fade', () => {
    const { bridge, emit } = setup();
    const feed = bridge.hud.pickups.element as unknown as FakeElement;
    emit({ type: 'itemPickedUp', playerId: 1, entityId: 9, item: 'item:stick', count: 2 });
    emit({ type: 'itemPickedUp', playerId: 2, entityId: 9, item: 'item:flint', count: 1 });
    emit({ type: 'itemPickedUp', playerId: 1, entityId: 9, item: 'item:stick', count: 1 });
    const name = basePack.strings[registry.item('item:stick')!.nameKey];
    expect(feed.childNodes.map((row) => (row as FakeElement).textContent)).toEqual([`+3 ${name}`]);
    for (let i = 0; i < 60; i++) bridge.frame(0.1);
    expect(feed.childNodes).toEqual([]);
  });

  it('names the biome the player enters once it holds, not the one they start in', () => {
    const { bridge, player } = setup();
    const banner = bridge.hud.biome.element as unknown as FakeElement;
    player.body.x = 4.5;
    bridge.frame(0.1);
    expect(banner.classList.contains('play')).toBe(false);
    // A step across the border and back: no banner.
    player.body.x = 20.5;
    bridge.frame(0.1);
    player.body.x = 4.5;
    bridge.frame(0.1);
    expect(banner.classList.contains('play')).toBe(false);
    player.body.x = 20.5;
    for (let t = 0; t <= BIOME_SETTLE_SECONDS + 0.05; t += 0.1) bridge.frame(0.1);
    expect(banner.classList.contains('play')).toBe(true);
    expect(banner.textContent).toBe(basePack.strings[biomes[1]!.def.nameKey]);
  });

  it('draws the minimap at 10 Hz under the big map’s key', () => {
    const { bridge, inventory } = setup();
    bridge.frame(0.05);
    expect(inventory.maps.radii).toEqual([MINIMAP_RADIUS]);
    bridge.frame(0.05);
    expect(inventory.maps.radii).toHaveLength(1);
    const hint = bridge.hud.map.element.querySelector('.minimap-hint')!;
    expect(hint.textContent).toBe('Right click · Map');
  });

  it('turns quests, the clock and the night into lines and banners', () => {
    const { bridge, inventory, listeners } = setup();
    const quests = registry.pack.quests!;
    const [first, hunt] = [quests.find((q) => q.requires)!, quests.find((q) => q.counter)!];
    const name = (key: string) => basePack.strings[key];
    for (const listener of listeners) {
      listener({ type: 'questUnlocked', playerId: 1, quest: first.key });
      listener({ type: 'questDone', playerId: 1, quest: first.key, already: false });
      listener({ type: 'questDone', playerId: 1, quest: first.key, already: true });
      listener({ type: 'questProgress', playerId: 1, quest: hunt.key, progress: 0 });
      listener({ type: 'questUnlocked', playerId: 1, quest: quests[0]!.key });
      listener({ type: 'questDone', playerId: 2, quest: first.key, already: false });
      listener({ type: 'nightSurvived', night: 2 });
    }
    // The messages of one frame share their own line (not the hint line), for QUEST_NEWS_SECONDS;
    // another player's, and the unlock of a quest open from the start, are not shown.
    const news = bridge.hud.questNews.element as unknown as FakeElement;
    expect(news.hidden).toBe(true);
    bridge.frame(0.01);
    expect(inventory.hint.shown).toEqual([]);
    expect(news.hidden).toBe(false);
    expect(news.textContent).toBe(
      [
        `New quest: ${name(first.textKey)}`,
        `Quest complete: ${name(first.textKey)} (claim it in the Quests tab)`,
        `Quest complete: ${name(first.textKey)} (already done)`,
        `${name(hunt.textKey)} 0/${hunt.counter!.count}`,
      ].join(' · '),
    );
    bridge.frame(QUEST_NEWS_SECONDS - 0.5);
    expect(news.hidden).toBe(false);
    bridge.frame(1);
    expect(news.hidden).toBe(true);
    const banner = bridge.hud.banner.element as unknown as FakeElement;
    expect(banner.textContent).toBe('Night 2 survived');
    expect(banner.classList.contains('play')).toBe(true);
    bridge.frame(0.1);
    const clock = bridge.hud.clock as unknown as FakeElement;
    expect(clock.textContent).toBe('07:00 · Day 1');
  });

  it('leaves a sunset to the onboarding when it shows its dusk tip, else shows the banner', () => {
    let first = true;
    const once = () => {
      const shown = first;
      first = false;
      return shown;
    };
    const { bridge, emit } = setup({ dusk: once });
    const banner = bridge.hud.banner.element as unknown as FakeElement;
    emit({ type: 'sunset', day: 1 });
    expect(banner.classList.contains('play')).toBe(false);
    emit({ type: 'sunset', day: 2 });
    expect(banner.textContent).toBe('The sun is setting…');
    expect(banner.classList.contains('play')).toBe(true);
  });
});

describe('BiomeWatch', () => {
  it('takes the first biome as where the player is, and tells a new one once it held', () => {
    const watch = new BiomeWatch();
    expect(watch.update(-1, 0.1)).toBe(-1);
    expect(watch.update(3, 0.1)).toBe(-1);
    expect(watch.update(5, BIOME_SETTLE_SECONDS / 2)).toBe(-1);
    expect(watch.update(3, 0.1)).toBe(-1);
    expect(watch.update(5, BIOME_SETTLE_SECONDS / 2)).toBe(-1);
    expect(watch.update(5, BIOME_SETTLE_SECONDS / 2)).toBe(5);
    expect(watch.update(5, 10)).toBe(-1);
    // Unloaded ground changes nothing.
    expect(watch.update(-1, 10)).toBe(-1);
    expect(watch.update(5, 10)).toBe(-1);
  });
});
