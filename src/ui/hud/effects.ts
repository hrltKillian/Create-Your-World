import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';
import { durationText } from './clock.ts';

/**
 * Effects and statuses the HUD lists, most pressing first (i18n `effect.<key>`, style
 * `effect-<key>`).
 */
export const HUD_EFFECTS = [
  'drowning',
  'freezing',
  'overheating',
  'starving',
  'dehydrated',
  'poisoned',
  'cold',
  'hot',
  'nauseous',
  'hungry',
  'thirsty',
  'exhausted',
  'weakened',
  'untargeted',
  'sheltered',
  'covered',
] as const;
export type HudEffectKey = (typeof HUD_EFFECTS)[number];

export interface HudEffect {
  readonly key: HudEffectKey;
  /** Seconds left of a timed effect; null for a status that lasts while its cause does. */
  readonly seconds: number | null;
}

interface Row {
  readonly element: HTMLElement;
  readonly time: HTMLElement;
}

/**
 * The active effects on the right of the HUD (docs « Interface »): one chip per status or timed
 * effect, in the order given, with the time left of the timed ones. Rows are made once per key and
 * only reordered when the list changes.
 */
export class EffectList {
  readonly element: HTMLElement;
  private readonly rows = new Map<HudEffectKey, Row>();
  private order = '';

  constructor() {
    this.element = h('ul', {
      id: 'hud-effects',
      class: 'hud-effects',
      attrs: { 'aria-label': t('hud.effects') },
    });
  }

  update(effects: readonly HudEffect[]): void {
    const order = effects.map((e) => e.key).join(' ');
    if (order !== this.order) {
      this.order = order;
      this.element.replaceChildren(...effects.map((e) => this.row(e.key).element));
    }
    for (const effect of effects) {
      const time = this.row(effect.key).time;
      const text = effect.seconds === null ? '' : durationText(effect.seconds);
      if (time.textContent !== text) time.textContent = text;
    }
  }

  private row(key: HudEffectKey): Row {
    let row = this.rows.get(key);
    if (!row) {
      const time = h('span', { class: 'effect-time' });
      const element = h(
        'li',
        { class: `effect effect-${key}`, attrs: { 'data-effect': key } },
        h('span', { class: 'effect-name' }, t(`effect.${key}`)),
        time,
      );
      row = { element, time };
      this.rows.set(key, row);
    }
    return row;
  }
}
