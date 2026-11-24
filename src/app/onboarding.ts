import { t } from '../i18n/i18n.ts';
import { type Action, HOTBAR_CODES } from '../input/bindings.ts';
import type { InputManager } from '../input/InputManager.ts';
import { SeenTips, type Tip } from '../platform/onboarding.ts';
import { browserStore } from '../platform/settings.ts';
import type { SimEvent } from '../sim/events.ts';
import { HudHint } from '../ui/hud/hudHint.ts';
import { type ControlRow, ControlsCard, TIP_SECONDS } from '../ui/onboarding.ts';
import type { BootParams } from './bootParams.ts';
import type { GameSession } from './GameSession.ts';
import type { InventoryScreen } from './inventoryUi.ts';

/**
 * Where the tips seen are kept: this browser's store (once per browser), a new one in memory
 * (`?onboarding=1`: everything shows again, for its own checks), or nowhere (off).
 */
export type OnboardingMode = 'browser' | 'fresh' | 'off';

/**
 * Onboarding never stands in automation's way: off under selftests, `?noLock`, `?skipMenu` and
 * WebDriver (Playwright: every context is a new browser), unless `?onboarding=` says otherwise.
 */
export function onboardingMode(params: BootParams, webdriver: boolean): OnboardingMode {
  if (params.onboarding !== null) return params.onboarding ? 'fresh' : 'off';
  const automated = params.selftest !== null || params.noLock || params.skipMenu || webdriver;
  return automated ? 'off' : 'browser';
}

/** The tips seen for a mode (null: onboarding is off). */
export function seenTipsFor(mode: OnboardingMode): SeenTips | null {
  if (mode === 'off') return null;
  return new SeenTips(mode === 'browser' ? browserStore() : null);
}

/** Labels of physical keys (`KeyLabels`: the browser's layout map, learned keys, a preset). */
interface Labels {
  label(code: string): string;
}

/** The actions of the card after « Move » and « Look around », each with all its keys. */
const ACTION_ROWS: readonly (readonly [string, Action])[] = [
  ['onboarding.jump', 'jump'],
  ['onboarding.sprint', 'sprint'],
  ['onboarding.crouch', 'crouch'],
  ['onboarding.primary', 'primary'],
  ['onboarding.secondary', 'secondary'],
  ['onboarding.bag', 'inventory'],
  ['onboarding.drop', 'drop'],
  ['onboarding.camera', 'camera'],
  ['onboarding.pause', 'pause'],
];
const MOVE: readonly Action[] = ['forward', 'left', 'back', 'right'];

/** The controls card's rows from the player's bindings, labelled as their keyboard prints them. */
export function controlRows(
  bindings: Readonly<Record<Action, readonly string[]>>,
  labels: Labels,
): ControlRow[] {
  const keysOf = (action: Action) => bindings[action].map((code) => labels.label(code));
  const first = labels.label(HOTBAR_CODES[0]!);
  const last = labels.label(HOTBAR_CODES.at(-1)!);
  return [
    { labelKey: 'onboarding.move', keys: MOVE.map((action) => keysOf(action)[0] ?? '') },
    { labelKey: 'onboarding.look', keys: [t('onboarding.mouse')] },
    ...ACTION_ROWS.map(([labelKey, action]) => ({ labelKey, keys: keysOf(action) })),
    {
      labelKey: 'onboarding.hotbar',
      keys: [t('onboarding.range', { first, last }), t('onboarding.wheel')],
    },
  ];
}

/** What the onboarding needs of the open screens (InventoryUi). */
interface Screens {
  screen(): InventoryScreen | null;
}

/**
 * The first launch's help (docs « Prise en main »): the controls card when a world opens, then a
 * tip line (`#hud-tip`) once per tip: the bag opened, mining started, thirst under the level health
 * needs to regenerate (`health.regenFedAt`), the first dusk (in place of the sunset banner:
 * HudBridge asks `dusk()`). Each is marked seen when shown (the card when dismissed); with no
 * tips store (automation) nothing shows.
 */
export class Onboarding {
  readonly card: ControlsCard;
  readonly tip = new HudHint('hud-tip', TIP_SECONDS);
  private readonly session: GameSession;
  private readonly input: InputManager;
  private readonly screens: Screens;
  private readonly thirstAt: number;
  private seen: SeenTips | null = null;

  /** `layer`: the world's play layer (the tip and the card go over its screens). */
  constructor(
    layer: HTMLElement,
    session: GameSession,
    input: InputManager,
    screens: Screens,
    layoutLoaded: Promise<void>,
    seen: SeenTips | null,
  ) {
    this.session = session;
    this.input = input;
    this.screens = screens;
    this.thirstAt = session.host.view.registry.pack.balance.health.regenFedAt;
    this.card = new ControlsCard(() => this.dismiss(true));
    layer.append(this.tip.element, this.card.element);
    session.listeners.push((event) => this.onEvent(event));
    window.addEventListener('keydown', this.onKeyDown, true);
    // The layout map gives better labels once loaded.
    void layoutLoaded.then(() => {
      if (this.card.isOpen()) this.card.setRows(this.rows());
    });
    this.start(seen);
  }

  /**
   * Starts over with a tips store (null: off): the card shows unless it was seen. Automation
   * starts a fresh one in memory to check the tips, and turns them off again.
   */
  start(seen: SeenTips | null): void {
    this.seen = seen;
    this.tip.element.hidden = true;
    if (seen && !seen.has('controls')) this.card.show(this.rows());
    else this.card.hide();
  }

  /** Whether the card and the tips may show (a tips store is in use). */
  isOn(): boolean {
    return this.seen !== null;
  }

  /** The tips seen so far (empty when off). */
  seenTips(): Tip[] {
    return this.seen?.list() ?? [];
  }

  /** The polled tips (the bag, thirst) and the tip line's time; call every frame. */
  frame(dt: number): void {
    this.tip.frame(dt);
    const seen = this.seen;
    if (!seen || this.card.isOpen()) return;
    if (!seen.has('bag') && this.screens.screen() === 'bag') this.show('bag');
    const s = this.session.player.survival;
    if (!seen.has('drink') && !s.dead && s.thirst < this.thirstAt) this.show('drink');
  }

  /** The sun sets: the first time, the dusk tip shows; true when it did (no sunset banner then). */
  dusk(): boolean {
    return this.show('dusk');
  }

  /** The world closes. */
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
  }

  private onEvent(event: SimEvent): void {
    if (event.type !== 'mineProgress' || event.stage !== 0) return;
    if (event.playerId === this.session.player.playerId) this.show('mine');
  }

  /** Shows a tip the first time; false when it was seen (or onboarding is off). */
  private show(tip: Exclude<Tip, 'controls'>): boolean {
    if (!this.seen?.mark(tip)) return false;
    this.tip.show(this.tipText(tip));
    return true;
  }

  private tipText(tip: Exclude<Tip, 'controls'>): string {
    switch (tip) {
      case 'bag':
        return t('tip.bag');
      case 'mine':
        return t('tip.mine', { key: this.input.keyLabel('primary') });
      case 'drink':
        return t('tip.drink', { key: this.input.keyLabel('secondary') });
      case 'dusk':
        return t('tip.dusk');
    }
  }

  private rows(): ControlRow[] {
    return controlRows(this.input.bindings, this.input.labels);
  }

  /** « Got it » (a click: it may capture the mouse and start play) or Esc closes the card. */
  private dismiss(play: boolean): void {
    this.card.hide();
    this.seen?.mark('controls');
    if (play) this.input.pointer?.request();
  }

  /** Esc closes the card before it would open the pause menu (a capture listener runs first). */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.card.isOpen() || !this.input.bindings.pause.includes(event.code)) return;
    event.preventDefault();
    this.dismiss(false);
  };
}
