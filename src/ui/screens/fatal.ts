import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';

export function fatalScreen(detail: string): HTMLElement {
  return h(
    'section',
    { id: 'screen-fatal', class: 'screen screen-message' },
    h('h1', null, t('error.fatal.title')),
    h('p', null, t('error.fatal.intro')),
    h('pre', { class: 'detail' }, detail),
    h(
      'button',
      { class: 'button', on: { click: () => location.reload() } },
      t('error.fatal.reload'),
    ),
  );
}
