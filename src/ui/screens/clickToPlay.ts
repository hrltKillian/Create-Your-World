import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';

/** Overlay asking for a click (Pointer Lock needs a user gesture). Shows the controls on its layout. */
export function clickToPlay(controls: string, onClick: () => void): HTMLElement {
  const title = h('p', { class: 'click-title' }, t('play.click'));
  const overlay = h(
    'section',
    { id: 'screen-click', class: 'screen screen-click', on: { click: onClick } },
    title,
    h('p', { class: 'click-controls' }, controls),
  );
  return overlay;
}

export function setClickToPlayResume(overlay: HTMLElement): void {
  const title = overlay.querySelector('.click-title');
  if (title) title.textContent = t('play.resume');
}

/** Replaces the controls line (labels improve once the keyboard layout map has loaded). */
export function setClickToPlayControls(overlay: HTMLElement, controls: string): void {
  const line = overlay.querySelector('.click-controls');
  if (line) line.textContent = controls;
}
