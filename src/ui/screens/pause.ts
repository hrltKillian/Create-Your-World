import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';
import { menuButton, menuPanel } from './menuParts.ts';

export interface PauseActions {
  resume(): void;
  settings(): void;
  saveAndQuit(): void;
}

/** The pause menu (Esc, or the mouse released): Resume, Settings, Save & quit, and the save state. */
export class PauseScreen {
  readonly element: HTMLElement;
  private readonly world: HTMLElement;
  private readonly status: HTMLElement;
  private readonly buttons: readonly HTMLButtonElement[];

  constructor(actions: PauseActions) {
    this.world = h('p', { class: 'menu-small pause-world' });
    this.status = h('p', { class: 'menu-small pause-status', attrs: { role: 'status' } });
    this.buttons = [
      menuButton('resume', t('pause.resume'), () => actions.resume(), 'button'),
      menuButton('settings', t('menu.settings'), () => actions.settings()),
      menuButton('save-quit', t('pause.saveQuit'), () => actions.saveAndQuit()),
    ];
    this.element = menuPanel(
      'screen-pause',
      'pause.title',
      this.world,
      h('nav', { class: 'menu-buttons' }, ...this.buttons),
      this.status,
    );
  }

  setWorld(name: string): void {
    this.world.textContent = name;
  }

  /** The save line (an i18n key; null: nothing to say). */
  setStatus(key: string | null): void {
    this.status.textContent = key === null ? '' : t(key);
  }

  /** While saving to quit: the buttons wait. */
  setBusy(busy: boolean): void {
    for (const button of this.buttons) button.disabled = busy;
  }
}
