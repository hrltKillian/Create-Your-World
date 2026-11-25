import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';
import type { QuestRow } from '../quests.ts';
import type { ScreenActions } from '../slotBoard.ts';

/**
 * The Quests page of the Bag (plan v3 « M21 », ui/quests.ts writes its rows): one card per quest
 * unlocked, with its hint, progress and rewards; a quest done has its « Claim » button
 * (`quest.claim`), an open one its « Pin » toggle (`quest.pin`, the compass and the line under
 * it). Rebuilt only when a row changes. Cards carry `data-quest` and `data-status`, buttons
 * `data-action="quest-claim"` or `"quest-pin"` (`aria-pressed`).
 */
export class QuestsPanel {
  readonly element = h('section', { class: 'quests' });
  private readonly actions: ScreenActions;
  /** The rows drawn last (null: none yet). */
  private shown: string | null = null;

  constructor(actions: ScreenActions) {
    this.actions = actions;
  }

  update(rows: readonly QuestRow[]): void {
    const key = rows.map((r) => `${r.quest}:${r.status}:${r.progress}:${r.pinned}`).join(',');
    if (key === this.shown) return;
    this.shown = key;
    if (rows.length === 0) {
      this.element.replaceChildren(h('p', { class: 'quests-empty' }, t('quests.empty')));
      return;
    }
    this.element.replaceChildren(...rows.map((row) => this.card(row)));
  }

  private card(row: QuestRow): HTMLElement {
    const lines = [h('p', { class: 'quest-hint' }, row.hint)];
    if (row.progress) lines.push(h('p', { class: 'quest-progress' }, row.progress));
    if (row.rewards)
      lines.push(h('p', { class: 'quest-rewards' }, t('quests.rewards', { items: row.rewards })));
    return h(
      'article',
      {
        class: `quest-row status-${row.status}`,
        attrs: { 'data-quest': row.quest, 'data-status': row.status },
      },
      h('h3', null, row.name),
      ...lines,
      this.button(row),
    );
  }

  private button(row: QuestRow): HTMLElement {
    if (row.status === 'claimed') return h('p', { class: 'quest-claimed' }, t('quests.claimed'));
    const claim = row.status === 'claim';
    const send = () => {
      this.actions.click();
      this.actions.send(
        claim
          ? { type: 'quest.claim', quest: row.quest }
          : { type: 'quest.pin', quest: row.pinned ? null : row.quest },
      );
    };
    return h(
      'button',
      {
        class: claim ? 'quest-claim' : 'quest-pin',
        attrs: {
          type: 'button',
          'data-action': claim ? 'quest-claim' : 'quest-pin',
          ...(claim ? {} : { 'aria-pressed': String(row.pinned) }),
        },
        on: { click: send },
      },
      t(claim ? 'quests.claim' : row.pinned ? 'quests.unpin' : 'quests.pin'),
    );
  }
}
