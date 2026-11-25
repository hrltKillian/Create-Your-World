import { h } from '../h.ts';
import type { ScreenActions } from '../slotBoard.ts';
import type { SkillRow, StatusView } from '../status.ts';
import { lineElement } from '../symbols.ts';

/** Class of a line's element. */
const RULE_TEXT = 'skill-rule-text';
/**
 * The Status page of the Bag (plan v3 « M22 », ui/status.ts writes it): the level and its XP, the
 * points left, then a row per skill with its rule and a « + » that spends a point
 * (`skill.spend`, `data-action="skill-spend"`, `data-skill`). Rebuilt only when it changes.
 */
export class StatusPanel {
  readonly element = h('section', { class: 'status' });
  private readonly actions: ScreenActions;
  /** The view drawn last (null: none yet). */
  private shown: string | null = null;

  constructor(actions: ScreenActions) {
    this.actions = actions;
  }

  update(view: StatusView): void {
    const key = JSON.stringify(view);
    if (key === this.shown) return;
    this.shown = key;
    this.element.replaceChildren(
      h('h3', { class: 'status-level' }, view.level),
      h('p', { class: 'status-xp' }, view.xp),
      h('p', { class: 'status-points' }, view.pointsLeft),
      ...view.skills.map((row) => this.row(row)),
    );
  }

  private row(row: SkillRow): HTMLElement {
    const spend = h(
      'button',
      {
        class: 'skill-spend',
        attrs: { type: 'button', 'data-action': 'skill-spend', 'data-skill': row.skill },
        on: {
          click: () => {
            this.actions.click();
            this.actions.send({ type: 'skill.spend', skill: row.skill });
          },
        },
      },
      '+',
    ) as HTMLButtonElement;
    spend.disabled = !row.canSpend;
    return h(
      'article',
      { class: 'skill-row', attrs: { 'data-skill': row.skill } },
      h('h4', null, row.name, h('span', { class: 'skill-points' }, row.points)),
      h('p', { class: 'skill-rule' }, lineElement(row.rule, RULE_TEXT)),
      spend,
    );
  }
}
