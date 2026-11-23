import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';

/**
 * Stamina as an arc beside the crosshair (docs « Interface », centre): it empties as stamina is
 * spent, fades out once full again, and turns red while exhausted. CSS draws the arc from `--fill`.
 */
export class StaminaArc {
  readonly element: HTMLElement;
  private shown = Number.NaN;
  private exhausted = false;

  constructor() {
    this.element = h('div', {
      id: 'hud-stamina',
      class: 'stamina-arc full',
      attrs: { role: 'meter', 'aria-label': t('hud.stamina') },
    });
  }

  update(stamina: number, max: number, exhausted: boolean): void {
    const fill = Math.round((stamina / max) * 100) / 100;
    if (fill !== this.shown) {
      this.shown = fill;
      this.element.style.setProperty('--fill', String(fill));
      this.element.classList.toggle('full', fill >= 1);
    }
    if (exhausted !== this.exhausted) {
      this.exhausted = exhausted;
      this.element.classList.toggle('exhausted', exhausted);
    }
  }
}
