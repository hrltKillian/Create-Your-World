import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';
import { menuButton, menuPanel } from './menuParts.ts';

export interface PauseActions {
  resume(): void;
  settings(): void;
  saveAndQuit(): void;
  /** Confirmed by the player on the menu first. */
  quitWithoutSaving(): void;
}

/**
 * The pause menu (Esc, or the mouse released): Resume, Settings, Save & quit, and the save state.
 * When Save & quit fails, it says so and offers Retry and Quit without saving (asked again).
 */
export class PauseScreen {
  readonly element: HTMLElement;
  private readonly world: HTMLElement;
  private readonly status: HTMLElement;
  private readonly buttons: readonly HTMLButtonElement[];
  private readonly failed: HTMLElement;
  private readonly choices: HTMLElement;
  private readonly confirm: HTMLElement;

  constructor(actions: PauseActions) {
    this.world = h('p', { class: 'menu-small pause-world' });
    this.status = h('p', { class: 'menu-small pause-status', attrs: { role: 'status' } });
    const retry = menuButton('retry-save-quit', t('pause.retry'), () => actions.saveAndQuit());
    const giveUp = menuButton(
      'quit-without-saving',
      t('pause.quitWithoutSaving'),
      () => {
        this.ask(true);
        // Enter does not quit by mistake.
        keep.focus();
      },
      'button ghost danger',
    );
    const yes = menuButton(
      'confirm-quit-without-saving',
      t('pause.quitWithoutSaving'),
      () => actions.quitWithoutSaving(),
      'button danger',
    );
    const keep = menuButton('keep-playing', t('pause.keep'), () => {
      this.ask(false);
      giveUp.focus();
    });
    const menu = [
      menuButton('resume', t('pause.resume'), () => actions.resume(), 'button'),
      menuButton('settings', t('menu.settings'), () => actions.settings()),
      menuButton('save-quit', t('pause.saveQuit'), () => actions.saveAndQuit()),
    ];
    this.buttons = [...menu, retry, giveUp, yes, keep];
    this.choices = h('div', { class: 'menu-row' }, retry, giveUp);
    this.confirm = h(
      'div',
      { class: 'pause-confirm', attrs: { role: 'alertdialog' } },
      h('p', null, t('pause.confirmQuit')),
      h('div', { class: 'menu-row' }, yes, keep),
    );
    this.failed = h(
      'div',
      { class: 'pause-failed', attrs: { role: 'alert' } },
      h('p', null, t('pause.quitFailed')),
      this.choices,
      this.confirm,
    );
    this.setFailed(false);
    this.element = menuPanel(
      'screen-pause',
      'pause.title',
      this.world,
      h('nav', { class: 'menu-buttons' }, ...menu),
      this.status,
      this.failed,
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

  /** Shows (or hides) that Save & quit failed, with Retry and Quit without saving. */
  setFailed(failed: boolean): void {
    this.failed.hidden = !failed;
    this.ask(false);
  }

  /** Swaps Retry and Quit without saving for the question, and back. */
  private ask(asking: boolean): void {
    this.choices.hidden = asking;
    this.confirm.hidden = !asking;
  }
}
