import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';

/** `missing` lists capability ids (webgl2, moduleWorkers, pointerLock). */
export function unsupportedScreen(missing: readonly string[]): HTMLElement {
  return h(
    'section',
    { id: 'screen-unsupported', class: 'screen screen-message' },
    h('h1', null, t('error.unsupported.title')),
    h('p', null, t('error.unsupported.intro')),
    h('ul', null, ...missing.map((cap) => h('li', null, t(`error.unsupported.${cap}`)))),
    h('p', { class: 'hint' }, t('error.unsupported.hint')),
  );
}
