import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';

/** Temporary title overlay shown until the real menus exist (M7). */
export function titleOverlay(milestone: number, touchOnly: boolean): HTMLElement {
  return h(
    'section',
    { id: 'screen-title', class: 'title-overlay' },
    h('h1', { class: 'title' }, t('app.title')),
    h('p', { class: 'tagline' }, t('app.tagline')),
    h('p', { class: 'milestone' }, t('app.milestone', { n: milestone })),
    touchOnly ? h('p', { class: 'notice' }, t('error.touch.notice')) : null,
  );
}
