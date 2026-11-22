import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';

/** Overlay shown while the area around the camera is generated and meshed. */
export function loadingScreen(): HTMLElement {
  return h(
    'section',
    { id: 'screen-loading', class: 'screen screen-loading' },
    h('div', { class: 'spinner', attrs: { 'aria-hidden': 'true' } }),
    h('p', null, t('loading.world')),
  );
}
