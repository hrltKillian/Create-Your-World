import { h } from '../h.ts';

/** Centre dot (hidden in third person). */
export function crosshair(): HTMLElement {
  return h('div', { id: 'crosshair', class: 'crosshair', attrs: { 'aria-hidden': 'true' } });
}
