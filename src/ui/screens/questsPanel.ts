import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';
import type { QuestRow, TaskRow } from '../quests.ts';
import type { ScreenActions } from '../slotBoard.ts';

/**
 * The Quests page of the Bag (plan v3 « M21 », « M22 », ui/quests.ts writes its rows): the player's
 * tasks first (claimed for XP, or one redrawn a day: `task.claim`, `task.reroll`), then a card per
 * quest unlocked, with its hint, progress and rewards; a quest done has its « Claim » button
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

  update(rows: readonly QuestRow[], tasks: readonly TaskRow[]): void {
    const key = JSON.stringify([rows, tasks]);
    if (key === this.shown) return;
    this.shown = key;
    const quests =
      rows.length === 0
        ? [h('p', { class: 'quests-empty' }, t('quests.empty'))]
        : rows.map((row) => this.card(row));
    const heading = (text: string) => h('h3', { class: 'quests-heading' }, text);
    this.element.replaceChildren(
      ...(tasks.length > 0
        ? [heading(t('quests.tasks')), ...tasks.map((row) => this.task(row))]
        : []),
      heading(t('quests.quests')),
      ...quests,
    );
  }

  /** A task's card: its progress and XP, « Claim » once done, else « New task » once a day. */
  private task(row: TaskRow): HTMLElement {
    const send = (type: 'task.claim' | 'task.reroll') => () => {
      this.actions.sound('button');
      this.actions.send({ type, index: row.index });
    };
    const button = h(
      'button',
      {
        class: row.done ? 'quest-claim' : 'quest-pin',
        attrs: { type: 'button', 'data-action': row.done ? 'task-claim' : 'task-reroll' },
        on: { click: send(row.done ? 'task.claim' : 'task.reroll') },
      },
      t(row.done ? 'quests.claim' : 'quests.reroll'),
    ) as HTMLButtonElement;
    button.disabled = !row.done && !row.canReroll;
    return h(
      'article',
      {
        class: `quest-row task-row status-${row.done ? 'claim' : 'open'}`,
        attrs: { 'data-task': row.task, 'data-index': String(row.index) },
      },
      h('h3', null, row.name),
      h('p', { class: 'quest-progress' }, row.progress),
      h('p', { class: 'quest-rewards' }, t('quests.rewards', { items: row.xp })),
      button,
    );
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
      this.actions.sound('button');
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
