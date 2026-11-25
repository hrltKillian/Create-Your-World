import type { BalanceDef } from '../../content/schema.ts';
import { t } from '../../i18n/i18n.ts';
import type { SurvivalState } from '../../sim/survival.ts';
import { h } from '../h.ts';
import { type GaugeSymbol, ROW_ICONS, symbolCount } from '../symbols.ts';

export { ROW_ICONS };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * A gauge drawn as a row of symbols (plan v3 « M28 », the reference game's rows of icons with our
 * own symbols: never hearts or drumsticks), each full, half or empty: a level shows as soon as it
 * is above 0 (the last half rounds up). A symbol is always `unit` points (« M30 »): a gauge larger
 * than ROW_ICONS of them (health with vitality) has more, the extra ones on a row above. It pulses
 * when `alarm`.
 */
class IconRow {
  readonly element: HTMLElement;
  private readonly icons: HTMLElement[] = [];
  private readonly kind: GaugeSymbol;
  private readonly labelKey: string;
  /** Symbols and halves shown (NaN before the first update). */
  private count = Number.NaN;
  private shown = Number.NaN;

  constructor(kind: GaugeSymbol, labelKey: string) {
    this.kind = kind;
    this.labelKey = labelKey;
    this.element = h('div', { class: `icon-row row-${kind}`, attrs: { role: 'meter' } });
  }

  /**
   * Shows `level` out of `max`, `unit` points a symbol (a tenth of `max` by default); touches the
   * DOM only when the symbols, the halves or the alarm change.
   */
  set(level: number, max: number, alarm: boolean, unit = max / ROW_ICONS): void {
    this.element.classList.toggle('alarm', alarm);
    const count = Math.ceil(max / unit - 1e-9);
    const halves = Math.min(count * 2, Math.ceil(Math.max(0, level / unit) * 2 - 1e-9));
    if (halves === this.shown && count === this.count) return;
    if (count !== this.count) this.resize(count);
    this.shown = halves;
    for (let i = 0; i < count; i++)
      this.icons[i]!.style.setProperty('--fill', String(clamp01((halves - 2 * i) / 2)));
    this.element.setAttribute('aria-label', t(this.labelKey, { n: symbolCount(halves / 2) }));
  }

  private resize(count: number): void {
    this.count = count;
    while (this.icons.length < count) {
      const icon = h('span', { class: `stat-icon gauge-${this.kind}` });
      this.icons.push(icon);
      this.element.append(icon);
    }
    for (let i = 0; i < this.icons.length; i++) this.icons[i]!.hidden = i >= count;
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
    this.value = h('span', { class: 'thermo-value' });
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

  /** `status`: the temperature band, −2…2 (sim `thermalStatus`). */
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

/**
 * Over the hotbar (docs « Interface », plan v3 « M28 »): on the left health, the thermometer with
 * its trend and toxicity while there is any; on the right hunger, thirst and the breath under
 * water, those rows filling from the right. Every level comes from the player's gauges;
 * thresholds from the pack's balance.
 */
export class Vitals {
  readonly element: HTMLElement;
  private readonly balance: BalanceDef;
  private readonly health = new IconRow('health', 'hud.health');
  private readonly hunger = new IconRow('hunger', 'hud.hunger');
  private readonly thirst = new IconRow('thirst', 'hud.thirst');
  private readonly toxicity = new IconRow('toxicity', 'hud.toxicity');
  private readonly breath = new IconRow('breath', 'hud.breath');
  private readonly thermo: Thermometer;

  constructor(balance: BalanceDef) {
    this.balance = balance;
    this.thermo = new Thermometer(balance.temperature.limit);
    this.toxicity.element.hidden = true;
    this.breath.element.hidden = true;
    this.element = h(
      'div',
      { id: 'hud-vitals', class: 'hud-vitals', attrs: { 'aria-label': t('hud.vitals') } },
      h(
        'div',
        { class: 'vitals-side vitals-left' },
        this.toxicity.element,
        this.thermo.element,
        this.health.element,
      ),
      h(
        'div',
        { class: 'vitals-side vitals-right' },
        this.breath.element,
        this.thirst.element,
        this.hunger.element,
      ),
    );
  }

  /** `status`: the thermal status (sim `thermalStatus`). */
  update(s: Readonly<SurvivalState>, status: number): void {
    const b = this.balance;
    // A vital cell is a tenth of the base health: vitality adds cells (plan v3 « M30 »).
    this.health.set(s.health, s.healthMax, s.health < b.health.lowAt, b.health.max / ROW_ICONS);
    this.hunger.set(s.hunger, b.hunger.max, s.hunger < b.hunger.lowAt);
    this.thirst.set(s.thirst, b.thirst.max, s.thirst < b.thirst.lowAt);
    this.thermo.set(s, status);
    const clean = s.toxicity <= 0;
    if (this.toxicity.element.hidden !== clean) this.toxicity.element.hidden = clean;
    this.toxicity.set(s.toxicity, b.toxicity.max, s.toxicity >= b.toxicity.harmAt);
    // Hidden at full air, even when the halves shown did not change on the last refill.
    const full = s.breath >= b.breath.seconds;
    if (this.breath.element.hidden !== full) this.breath.element.hidden = full;
    this.breath.set(s.breath, b.breath.seconds, false);
  }
}
