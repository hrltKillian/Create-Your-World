import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_BOOT_PARAMS, parseBootParams } from '../../../src/app/bootParams.ts';
import type { GameSession } from '../../../src/app/GameSession.ts';
import type { InventoryScreen } from '../../../src/app/inventoryUi.ts';
import {
  controlRows,
  Onboarding,
  onboardingMode,
  seenTipsFor,
} from '../../../src/app/onboarding.ts';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { addStrings, i18nMissing, t } from '../../../src/i18n/i18n.ts';
import { DEFAULT_BINDINGS } from '../../../src/input/bindings.ts';
import type { InputManager } from '../../../src/input/InputManager.ts';
import { KeyLabels } from '../../../src/input/keyLabels.ts';
import { SeenTips } from '../../../src/platform/onboarding.ts';
import { createPlayer } from '../../../src/sim/player.ts';
import { TIP_SECONDS } from '../../../src/ui/onboarding.ts';
import { type FakeElement, installFakeDom, removeFakeDom } from '../../helpers/fakeDom.ts';
import { type FakeTarget, installFakeWindow, removeFakeWindow } from '../../helpers/fakeTarget.ts';
import { registry } from '../../helpers/registry.ts';

/*
 * Onboarding (docs « Prise en main »): when it shows (never under automation), the controls card
 * with the player's own key labels, and each tip once, from the events and gauges that start it.
 * The thirst threshold comes from the pack's balance.
 */

const b = registry.pack.balance;
let win: FakeTarget;

beforeEach(() => {
  installFakeDom();
  win = installFakeWindow();
  addStrings(basePack.strings);
});
afterEach(() => {
  removeFakeWindow();
  removeFakeDom();
});

/** The texts of the card's rows: [label, keys…] each. */
function cardRows(card: FakeElement): string[][] {
  const rows = card.querySelector('.controls-rows')!;
  const lines: string[][] = [];
  for (const node of rows.childNodes) {
    if (typeof node === 'string') continue;
    if (node.tagName === 'DT') lines.push([node.textContent]);
    else lines.at(-1)!.push(...node.childNodes.map((key) => (key as FakeElement).textContent));
  }
  return lines;
}

/** An onboarding over a fake session, input (AZERTY labels) and screens. */
function setup(seen: SeenTips | null = new SeenTips(null)) {
  const player = createPlayer(1, 0, 65, 0, 2, b);
  const listeners: ((event: unknown) => void)[] = [];
  const session = { player, listeners, host: { view: { registry } } };
  const labels = new KeyLabels('fr-FR');
  const requests: number[] = [];
  const input = {
    bindings: DEFAULT_BINDINGS,
    labels,
    keyLabel: (action: keyof typeof DEFAULT_BINDINGS) => labels.label(DEFAULT_BINDINGS[action][0]!),
    pointer: { request: () => requests.push(1) },
  };
  const screens = { open: null as InventoryScreen | null, screen: () => screens.open };
  const layer = document.createElement('div') as unknown as FakeElement;
  const onboarding = new Onboarding(
    layer as unknown as HTMLElement,
    session as unknown as GameSession,
    input as unknown as InputManager,
    screens,
    Promise.resolve(),
    seen,
  );
  const emit = (event: unknown) => {
    for (const listener of listeners) listener(event);
  };
  const card = onboarding.card.element as unknown as FakeElement;
  const tip = onboarding.tip.element as unknown as FakeElement;
  /** Closes the card with « Got it ». */
  const gotIt = () => card.findAction('onboarding-close')!.dispatch('click');
  return { onboarding, player, screens, layer, emit, card, tip, requests, gotIt };
}

describe('onboarding mode', () => {
  it('shows once per browser, never under automation unless ?onboarding= says so', () => {
    const at = (search: string, webdriver = false) =>
      onboardingMode(parseBootParams(search, true), webdriver);
    expect(onboardingMode(DEFAULT_BOOT_PARAMS, false)).toBe('browser');
    expect(at('?seed=42&storage=memory&world=abc')).toBe('browser');
    expect(at('?selftest=m0')).toBe('off');
    expect(at('?noLock=1')).toBe('off');
    expect(at('?skipMenu=1')).toBe('off');
    expect(at('', true)).toBe('off');
    expect(at('?selftest=m0&onboarding=1')).toBe('fresh');
    expect(at('?onboarding=1', true)).toBe('fresh');
    expect(at('?onboarding=0')).toBe('off');
    expect(parseBootParams('?onboarding=1', true).onboarding).toBe(true);
    expect(parseBootParams('', true).onboarding).toBeNull();
    // Production builds read no parameter: once per browser.
    expect(parseBootParams('?onboarding=0', false).onboarding).toBeNull();
  });

  it('keeps a fresh mode in memory and an off mode nowhere', () => {
    expect(seenTipsFor('off')).toBeNull();
    const fresh = seenTipsFor('fresh')!;
    fresh.mark('controls');
    expect(seenTipsFor('fresh')!.has('controls')).toBe(false);
  });
});

describe('controls card', () => {
  it("lists every action with the keys of the player's layout", () => {
    const rows = controlRows(DEFAULT_BINDINGS, new KeyLabels('fr-FR'));
    const byLabel = new Map(rows.map((row) => [t(row.labelKey), row.keys]));
    expect(byLabel.get('Move')).toEqual(['Z', 'Q', 'S', 'D']);
    expect(byLabel.get('Look around')).toEqual(['Mouse']);
    expect(byLabel.get('Jump')).toEqual(['Space']);
    expect(byLabel.get('Mine and attack (hold)')).toEqual(['Left click']);
    expect(byLabel.get('Use, place, eat and drink')).toEqual(['Right click']);
    expect(byLabel.get('Bag and Logbook')).toEqual(['E', 'Tab']);
    expect(byLabel.get('Pause')).toEqual(['Esc']);
    expect(byLabel.get('Hotbar slot')).toEqual(['1–8', 'Wheel']);
    expect(controlRows(DEFAULT_BINDINGS, new KeyLabels('en-US'))[0]!.keys).toEqual([
      'W',
      'A',
      'S',
      'D',
    ]);
    expect(i18nMissing()).toEqual([]);
  });

  it('shows on the first launch, closes with Got it (starting play) and never shows again', () => {
    const seen = new SeenTips(null);
    const first = setup(seen);
    expect(first.card.hidden).toBe(false);
    expect(first.layer.childNodes.at(-1)).toBe(first.card);
    expect(cardRows(first.card)[0]).toEqual(['Move', 'Z', 'Q', 'S', 'D']);
    first.gotIt();
    expect(first.card.hidden).toBe(true);
    expect(first.requests).toHaveLength(1);
    expect(first.onboarding.seenTips()).toEqual(['controls']);
    // The next world of this browser opens without it.
    expect(setup(seen).card.hidden).toBe(true);
  });

  it('closes on Esc before the pause key can open the menu, without capturing the mouse', () => {
    const { card, requests, onboarding } = setup();
    let prevented = false;
    win.dispatch('keydown', { code: 'KeyE', preventDefault: () => (prevented = true) });
    expect(card.hidden).toBe(false);
    win.dispatch('keydown', { code: 'Escape', preventDefault: () => (prevented = true) });
    expect(prevented).toBe(true);
    expect(card.hidden).toBe(true);
    expect(requests).toEqual([]);
    expect(onboarding.seenTips()).toEqual(['controls']);
    // Closed, Esc is the pause key's again.
    prevented = false;
    win.dispatch('keydown', { code: 'Escape', preventDefault: () => (prevented = true) });
    expect(prevented).toBe(false);
    onboarding.dispose();
  });

  it('shows nothing when onboarding is off, and starts over with a fresh store', () => {
    const { card, onboarding, screens, tip } = setup(null);
    expect(card.hidden).toBe(true);
    screens.open = 'bag';
    onboarding.frame(0.1);
    expect(tip.hidden).toBe(true);
    expect(onboarding.dusk()).toBe(false);
    onboarding.start(new SeenTips(null));
    expect(card.hidden).toBe(false);
    onboarding.start(null);
    expect(card.hidden).toBe(true);
  });
});

describe('tips', () => {
  it('shows the bag tip the first time the bag is open, once, and not under the card', () => {
    const { onboarding, screens, tip, gotIt } = setup();
    screens.open = 'bag';
    onboarding.frame(0.1);
    expect(tip.hidden).toBe(true);
    gotIt();
    onboarding.frame(0.1);
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toBe(t('tip.bag'));
    onboarding.frame(TIP_SECONDS);
    expect(tip.hidden).toBe(true);
    screens.open = null;
    onboarding.frame(0.1);
    screens.open = 'bag';
    onboarding.frame(0.1);
    expect(tip.hidden).toBe(true);
    expect(onboarding.seenTips()).toEqual(['controls', 'bag']);
  });

  it("shows « Hold to mine » with the player's key when the local player starts mining", () => {
    const { onboarding, emit, tip, gotIt } = setup();
    gotIt();
    const mining = { type: 'mineProgress', playerId: 1, x: 0, y: 64, z: 0, stage: 0 };
    emit({ ...mining, playerId: 2 });
    emit({ ...mining, stage: 3 });
    emit({ ...mining, stage: -1 });
    expect(tip.hidden).toBe(true);
    emit(mining);
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toBe(t('tip.mine', { key: 'Left click' }));
    expect(tip.textContent).toContain('Hold to mine');
    onboarding.frame(TIP_SECONDS);
    emit(mining);
    expect(tip.hidden).toBe(true);
  });

  it('tells how to drink once thirst falls under the level health needs to regenerate', () => {
    const { onboarding, player, tip, gotIt } = setup();
    gotIt();
    const s = player.survival;
    s.thirst = b.health.regenFedAt;
    onboarding.frame(0.1);
    expect(tip.hidden).toBe(true);
    s.thirst = b.health.regenFedAt - 1;
    s.dead = true;
    onboarding.frame(0.1);
    expect(tip.hidden).toBe(true);
    s.dead = false;
    onboarding.frame(0.1);
    expect(tip.textContent).toBe(t('tip.drink', { key: 'Right click' }));
    expect(onboarding.seenTips()).toContain('drink');
  });

  it('takes the first dusk from the sunset banner, then leaves the banner alone', () => {
    const { onboarding, tip, gotIt } = setup();
    gotIt();
    expect(onboarding.dusk()).toBe(true);
    expect(tip.textContent).toBe(t('tip.dusk'));
    expect(onboarding.dusk()).toBe(false);
    expect(onboarding.seenTips()).toEqual(['controls', 'dusk']);
  });
});
