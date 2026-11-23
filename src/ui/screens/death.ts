import { t } from '../../i18n/i18n.ts';
import type { DeathCause } from '../../sim/survival.ts';
import { h } from '../h.ts';
import { menuButton } from './menuParts.ts';

/**
 * The death screen (`#screen-death`, docs « Mort »): the cause (`death.cause.<cause>`), where the
 * belongings wait and where the player wakes, and Respawn (`data-action="respawn"`).
 */
export class DeathScreen {
  readonly element: HTMLElement;
  private readonly cause: HTMLElement;
  private readonly wake: HTMLElement;

  constructor(onRespawn: () => void) {
    this.cause = h('p', { class: 'death-cause' });
    this.wake = h('p', { class: 'death-note' });
    const respawn = menuButton('respawn', t('death.respawn'), onRespawn, 'button');
    this.element = h(
      'section',
      { id: 'screen-death', class: 'screen screen-death', attrs: { role: 'alertdialog' } },
      h('h2', { class: 'death-title' }, t('death.title')),
      this.cause,
      h('p', { class: 'death-note' }, t('death.pack')),
      this.wake,
      respawn,
    );
    this.element.hidden = true;
  }

  isOpen(): boolean {
    return !this.element.hidden;
  }

  /** Shows the screen for a death; `atBed`: the player wakes at a bedroll, else at the spawn. */
  show(cause: DeathCause | '', atBed: boolean): void {
    this.cause.textContent = t(`death.cause.${cause || 'unknown'}`);
    this.wake.textContent = t(atBed ? 'death.atBed' : 'death.atSpawn');
    this.element.hidden = false;
  }

  hide(): void {
    this.element.hidden = true;
  }
}
