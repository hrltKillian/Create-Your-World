import { fmtDate } from '../../i18n/fmt.ts';
import { t } from '../../i18n/i18n.ts';
import type { WorldRecord } from '../../sim/storage.ts';
import { h } from '../h.ts';
import { menuButton, menuPanel } from './menuParts.ts';

export interface WorldsActions {
  play(id: string): void;
  exportWorld(id: string): void;
  /** Confirmed by the player on the card first. */
  deleteWorld(id: string): void;
  importFile(file: File): void;
  newWorld(): void;
  back(): void;
}

/**
 * The Worlds screen: a card per saved world (name, seed, last played) with Play, Export and
 * Delete (asked again on the card), then New world, Import and Back. Shows the storage used.
 */
export class WorldsScreen {
  readonly element: HTMLElement;
  private readonly actions: WorldsActions;
  private readonly list: HTMLElement;
  private readonly usage: HTMLElement;

  constructor(actions: WorldsActions) {
    this.actions = actions;
    this.list = h('ul', { class: 'world-list' });
    this.usage = h('p', { class: 'menu-small' });
    this.usage.hidden = true;
    const file = h('input', {
      class: 'visually-hidden',
      attrs: { type: 'file', accept: '.gz,application/gzip', tabindex: '-1' },
    });
    file.addEventListener('change', () => {
      const chosen = file.files?.[0];
      file.value = '';
      if (chosen) actions.importFile(chosen);
    });
    const create = menuButton('new-world', t('menu.newWorld'), () => actions.newWorld(), 'button');
    const load = menuButton('import', t('worlds.import'), () => file.click());
    const back = menuButton('back', t('menu.back'), () => actions.back());
    this.element = menuPanel(
      'screen-worlds',
      'worlds.title',
      this.list,
      this.usage,
      h('div', { class: 'menu-row' }, create, load, back, file),
    );
  }

  /** Shows the worlds, in this order. */
  show(worlds: readonly WorldRecord[]): void {
    if (worlds.length === 0)
      this.list.replaceChildren(h('li', { class: 'world-empty' }, t('worlds.empty')));
    else this.list.replaceChildren(...worlds.map((world) => this.card(world)));
  }

  /** The storage line (null: unknown, hidden). */
  setUsage(usage: string | null): void {
    this.usage.textContent = usage ?? '';
    this.usage.hidden = usage === null;
  }

  private card(world: WorldRecord): HTMLElement {
    const { id, name } = world;
    const actions = this.actions;
    const play = menuButton('play', t('worlds.play'), () => actions.play(id), 'button small');
    const save = menuButton(
      'export',
      t('worlds.export'),
      () => actions.exportWorld(id),
      'button ghost small',
    );
    const remove = menuButton(
      'delete',
      t('worlds.delete'),
      () => ask(true),
      'button ghost danger small',
    );
    const yes = menuButton(
      'confirm-delete',
      t('worlds.delete'),
      () => actions.deleteWorld(id),
      'button danger small',
    );
    const keep = menuButton('keep', t('worlds.keep'), () => ask(false), 'button ghost small');
    const buttons = h('div', { class: 'world-actions' }, play, save, remove);
    const question = h('p', null, t('worlds.confirmDelete', { name }));
    const confirm = h(
      'div',
      { class: 'world-confirm', attrs: { role: 'alertdialog' } },
      question,
      yes,
      keep,
    );
    confirm.hidden = true;
    /** Swaps the buttons for the question (focus on Keep: Enter does not delete by mistake). */
    const ask = (asking: boolean) => {
      buttons.hidden = asking;
      confirm.hidden = !asking;
      (asking ? keep : remove).focus();
    };
    const meta = [t('worlds.seed', { seed: world.seed })];
    // Records are shown as stored (not migrated): every field is checked before use.
    if (Number.isFinite(world.savedAt) && world.savedAt > 0)
      meta.push(t('worlds.lastPlayed', { date: fmtDate(world.savedAt) }));
    if (world.rules?.hostiles === false) meta.push(t('worlds.peaceful'));
    return h(
      'li',
      { class: 'world-card', attrs: { 'data-world': world.id } },
      h(
        'div',
        { class: 'world-info' },
        h('h3', { class: 'world-name' }, world.name),
        h('p', { class: 'world-meta' }, meta.join(' · ')),
      ),
      buttons,
      confirm,
    );
  }
}
