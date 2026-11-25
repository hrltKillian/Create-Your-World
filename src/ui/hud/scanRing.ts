import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';

/**
 * A worn scanner's progress as a ring around the crosshair (docs plan v2 « M17 »): it fills while
 * the scanner looks at a creature not studied yet and hides otherwise. CSS draws it from `--fill`.
 */
export class ScanRing {
  readonly element: HTMLElement;
  private shown = Number.NaN;

  constructor() {
    this.element = h('div', {
      id: 'hud-scan',
      class: 'scan-ring',
      attrs: { role: 'meter', 'aria-label': t('hud.scan') },
    });
    this.element.hidden = true;
  }

  /** The share of the scan done (0–1), or NaN to hide the ring. */
  update(progress: number): void {
    const fill = Number.isNaN(progress) ? Number.NaN : Math.round(progress * 100) / 100;
    if (fill === this.shown || (Number.isNaN(fill) && Number.isNaN(this.shown))) return;
    this.shown = fill;
    this.element.hidden = Number.isNaN(fill);
    if (!this.element.hidden) this.element.style.setProperty('--fill', String(fill));
  }
}
