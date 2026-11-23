import type { BalanceDef } from '../../content/schema.ts';
import { t } from '../../i18n/i18n.ts';
import type { SurvivalState } from '../../sim/survival.ts';
import { h } from '../h.ts';

/** Bubbles of the breath row (each one a fifth of the air). */
export const BREATH_BUBBLES = 5;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * A gauge drawn as a corked vial (docs « Interface »: vials, never hearts or drumsticks): the
 * liquid scales with the level, the value is written below, and it pulses when `alarm`.
 */
class Vial {
  readonly element: HTMLElement;
  private readonly value: HTMLElement;
  private readonly max: number;
  private readonly labelKey: string;
  private shown = Number.NaN;

  constructor(kind: string, max: number, labelKey: string) {
    this.max = max;
    this.labelKey = labelKey;
    this.value = h('span', { class: 'vial-value' });
    this.element = h(
      'div',
      { class: `vial vial-${kind}`, attrs: { role: 'meter' } },
      h('span', { class: 'vial-icon' }),
      h('span', { class: 'vial-glass' }, h('span', { class: 'vial-liquid' })),
      this.value,
    );
  }

  /** Shows a level (touches the DOM only when its rounded value or the alarm changes). */
  set(level: number, alarm: boolean): void {
    this.element.classList.toggle('alarm', alarm);
    const n = Math.round(level);
    if (n === this.shown) return;
    this.shown = n;
    this.element.style.setProperty('--fill', String(clamp01(n / this.max)));
    this.value.textContent = String(n);
    this.element.setAttribute('aria-label', t(this.labelKey, { n }));
  }
}

/**
 * The body temperature gauge (−limit…+limit, comfort in the middle) as a thermometer, with the
 * air the player feels (°C) and an arrow while the gauge drifts towards its target.
 */
class Thermometer {
  readonly element: HTMLElement;
  private readonly value: HTMLElement;
  private readonly limit: number;
  private shown = '';

  constructor(limit: number) {
    this.limit = limit;
    this.value = h('span', { class: 'vial-value' });
    this.element = h(
      'div',
      { class: 'thermo', attrs: { role: 'meter' } },
      h('span', { class: 'thermo-trend' }),
      h(
        'span',
        { class: 'thermo-glass' },
        h('span', { class: 'thermo-liquid' }),
        h('span', { class: 'thermo-mark' }),
      ),
      h('span', { class: 'thermo-bulb' }),
      this.value,
    );
  }

  /** `status`: −2 Freezing, −1 Cold, 0 none, 1 Hot, 2 Overheating (sim `thermalStatus`). */
  set(s: Readonly<SurvivalState>, status: number): void {
    const n = Math.round(s.temperature);
    const air = Math.round(s.ambient);
    const trend = s.target > s.temperature + 0.5 ? 1 : s.target < s.temperature - 0.5 ? -1 : 0;
    const key = `${n} ${air} ${trend} ${status}`;
    if (key === this.shown) return;
    this.shown = key;
    const el = this.element;
    el.style.setProperty('--fill', String(clamp01((n + this.limit) / (2 * this.limit))));
    el.classList.toggle('cold', status < 0);
    el.classList.toggle('hot', status > 0);
    el.classList.toggle('severe', status === 2 || status === -2);
    el.classList.toggle('rising', trend > 0);
    el.classList.toggle('falling', trend < 0);
    this.value.textContent = t('hud.celsius', { n: air });
    el.setAttribute('aria-label', t('hud.temperature', { n, c: air }));
  }
}

/** Air left with the head under water: a row of bubbles that shrink, shown only while short. */
class BreathRow {
  readonly element: HTMLElement;
  private readonly bubbles: HTMLElement[] = [];
  private shown = Number.NaN;

  constructor() {
    for (let i = 0; i < BREATH_BUBBLES; i++)
      this.bubbles.push(h('span', { class: 'breath-bubble' }));
    this.element = h(
      'div',
      { class: 'breath', attrs: { 'aria-label': t('hud.breath') } },
      ...this.bubbles,
    );
    this.element.hidden = true;
  }

  set(breath: number, max: number): void {
    const level = Math.round((breath / max) * BREATH_BUBBLES * 10) / 10;
    if (level === this.shown) return;
    this.shown = level;
    this.element.hidden = breath >= max;
    for (let i = 0; i < BREATH_BUBBLES; i++)
      this.bubbles[i]!.style.setProperty('--fill', String(clamp01(level - i)));
  }
}

/**
 * Bottom left of the HUD (docs « Interface »): vials of health, hunger and thirst with their
 * icons, the thermometer with its trend, toxicity while there is any, and the breath under water.
 * Every level comes from the player's gauges; thresholds from the pack's balance.
 */
export class Vitals {
  readonly element: HTMLElement;
  private readonly balance: BalanceDef;
  private readonly health: Vial;
  private readonly hunger: Vial;
  private readonly thirst: Vial;
  private readonly toxicity: Vial;
  private readonly thermo: Thermometer;
  private readonly breath = new BreathRow();

  constructor(balance: BalanceDef) {
    this.balance = balance;
    this.health = new Vial('health', balance.health.max, 'hud.health');
    this.hunger = new Vial('hunger', balance.hunger.max, 'hud.hunger');
    this.thirst = new Vial('thirst', balance.thirst.max, 'hud.thirst');
    this.toxicity = new Vial('toxicity', balance.toxicity.max, 'hud.toxicity');
    this.thermo = new Thermometer(balance.temperature.limit);
    this.toxicity.element.hidden = true;
    this.element = h(
      'div',
      { id: 'hud-vitals', class: 'hud-vitals', attrs: { 'aria-label': t('hud.vitals') } },
      this.breath.element,
      h(
        'div',
        { class: 'vitals-row' },
        this.health.element,
        this.hunger.element,
        this.thirst.element,
        this.thermo.element,
        this.toxicity.element,
      ),
    );
  }

  /** `status`: the thermal status (sim `thermalStatus`). */
  update(s: Readonly<SurvivalState>, status: number): void {
    const b = this.balance;
    this.health.set(s.health, s.health < b.health.lowAt);
    this.hunger.set(s.hunger, s.hunger < b.hunger.lowAt);
    this.thirst.set(s.thirst, s.thirst < b.thirst.lowAt);
    this.thermo.set(s, status);
    const clean = s.toxicity <= 0;
    if (this.toxicity.element.hidden !== clean) this.toxicity.element.hidden = clean;
    this.toxicity.set(s.toxicity, s.toxicity >= b.toxicity.nauseousAt);
    this.breath.set(s.breath, b.breath.seconds);
  }
}
