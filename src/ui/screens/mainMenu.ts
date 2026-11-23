import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';
import { menuButton } from './menuParts.ts';

export interface MainMenuActions {
  /** « Continue » (the last world played) or « Play » (no world yet: the New world screen). */
  play(): void;
  worlds(): void;
  settings(): void;
}

/** The main menu: the game's name over the first button, Worlds and Settings. */
export class MainMenu {
  readonly element: HTMLElement;
  private readonly playLabel: HTMLElement;
  private readonly playWorld: HTMLElement;

  constructor(actions: MainMenuActions, touchOnly: boolean) {
    this.playLabel = h('span', null, t('menu.play'));
    this.playWorld = h('span', { class: 'menu-sub' });
    const worlds = menuButton('worlds', t('menu.worlds'), () => actions.worlds());
    const settings = menuButton('settings', t('menu.settings'), () => actions.settings());
    this.element = h(
      'section',
      { id: 'screen-main', class: 'menu-screen menu-main' },
      h(
        'header',
        { class: 'menu-brand' },
        h('div', { class: 'menu-mark', attrs: { 'aria-hidden': 'true' } }),
        h('h1', { class: 'menu-title' }, t('app.title')),
        h('p', { class: 'menu-tagline' }, t('app.tagline')),
      ),
      h(
        'nav',
        { class: 'menu-buttons' },
        h(
          'button',
          {
            class: 'button menu-play',
            attrs: { type: 'button', 'data-action': 'play' },
            on: { click: () => actions.play() },
          },
          this.playLabel,
          this.playWorld,
        ),
        worlds,
        settings,
      ),
      touchOnly ? h('p', { class: 'menu-notice-touch' }, t('error.touch.notice')) : null,
    );
  }

  /** The world « Continue » opens, by name; null when there is none (the button says Play). */
  setContinue(name: string | null): void {
    this.playLabel.textContent = t(name === null ? 'menu.play' : 'menu.continue');
    this.playWorld.textContent = name ?? '';
    this.playWorld.hidden = name === null;
  }
}
