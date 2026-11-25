import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';

/**
 * The attack gauge under the crosshair (plan v3 « M19 »): it shows while it fills again after a
 * swing and flashes once full (the next blow is a strong one), then hides. CSS draws its fill from
 * `--fill`.
 */
export class AttackGauge {
  readonly element: HTMLElement;
  private shown = 1;

  constructor() {
    this.element = h('div', {
      id: 'hud-attack',
      class: 'attack-gauge full',
      attrs: { role: 'meter', 'aria-label': t('hud.attack') },
    });
  }

  /** How full the gauge is (0–1). */
  update(fill: number): void {
    const value = Math.round(fill * 50) / 50;
    if (value === this.shown) return;
    if (value >= 1 && this.shown < 1) {
      // Full again: a flash (the animation restarts).
      this.element.classList.remove('ready');
      void this.element.offsetWidth;
      this.element.classList.add('ready');
    }
    this.shown = value;
    this.element.style.setProperty('--fill', String(value));
    this.element.classList.toggle('full', value >= 1);
  }
}
