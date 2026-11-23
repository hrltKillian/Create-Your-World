import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';

/** Pieces shared by the menu screens. */

/** A menu button (secondary look by default); `action` names it for automation (`data-action`). */
export function menuButton(
  action: string,
  label: string,
  onClick: () => void,
  className = 'button secondary',
): HTMLButtonElement {
  return h(
    'button',
    { class: className, attrs: { type: 'button', 'data-action': action }, on: { click: onClick } },
    label,
  );
}

/** The panel a menu screen shows: its title, then its content. */
export function menuPanel(id: string, titleKey: string, ...content: HTMLElement[]): HTMLElement {
  return h(
    'section',
    { id, class: 'menu-screen' },
    h('div', { class: 'menu-panel' }, h('h2', { class: 'menu-heading' }, t(titleKey)), ...content),
  );
}

export interface Slider {
  readonly element: HTMLElement;
  set(value: number): void;
}

/** A range slider with its value shown beside it; `format` writes the value. */
export function slider(
  name: string,
  label: string,
  range: { readonly min: number; readonly max: number; readonly step: number },
  format: (value: number) => string,
  onInput: (value: number) => void,
): Slider {
  const output = h('output', { class: 'setting-value' });
  const input = h('input', {
    attrs: {
      type: 'range',
      name,
      min: String(range.min),
      max: String(range.max),
      step: String(range.step),
    },
  });
  const set = (value: number) => {
    input.value = String(value);
    output.textContent = format(value);
  };
  input.addEventListener('input', () => {
    const value = Number(input.value);
    output.textContent = format(value);
    onInput(value);
  });
  const element = h(
    'label',
    { class: 'setting setting-range' },
    h('span', { class: 'setting-label' }, label),
    input,
    output,
  );
  return { element, set };
}
