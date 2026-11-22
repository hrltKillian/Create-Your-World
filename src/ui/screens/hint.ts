import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';

/** A one-line hint at the bottom of the screen. */
export function hintBar(key: string): HTMLElement {
  return h('p', { class: 'hint-bar' }, t(key));
}
