import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';

export interface DebugLine {
  /** i18n key of the label. */
  readonly label: string;
  readonly value: string;
}

/** Developer panel (toggled with F3, Backquote or IntlBackslash). */
export class DebugOverlay {
  readonly element: HTMLElement;
  private readonly body: HTMLElement;
  private readonly values = new Map<string, HTMLElement>();
  private visible: boolean;

  constructor(visible: boolean) {
    this.body = h('dl', { class: 'debug-body' });
    this.element = h(
      'aside',
      { id: 'debug-overlay', class: 'debug-overlay' },
      h('h2', null, t('debug.title')),
      this.body,
    );
    this.visible = visible;
    this.element.hidden = !visible;
  }

  isVisible(): boolean {
    return this.visible;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.element.hidden = !this.visible;
  }

  setLines(lines: readonly DebugLine[]): void {
    if (!this.visible) return;
    for (const line of lines) {
      let value = this.values.get(line.label);
      if (!value) {
        value = h('dd');
        this.values.set(line.label, value);
        this.body.append(h('dt', null, t(line.label)), value);
      }
      if (value.textContent !== line.value) value.textContent = line.value;
    }
  }
}
