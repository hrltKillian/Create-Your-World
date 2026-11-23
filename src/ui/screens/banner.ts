import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';

/** « Saving unavailable » (IndexedDB cannot be used): worlds only live as long as the page. */
export function savingBanner(): HTMLElement {
  return h(
    'p',
    { id: 'banner-saving', class: 'banner', attrs: { role: 'status' } },
    t('save.unavailable'),
  );
}
