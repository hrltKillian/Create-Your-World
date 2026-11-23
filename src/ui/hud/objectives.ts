import type { ObjectiveDef } from '../../content/schema.ts';
import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';

/** Where a player stands in the objectives chain. */
export interface ObjectiveProgress {
  /** The first objective of the chain not done yet; null once all are. */
  readonly current: ObjectiveDef | null;
  /** Objectives of the chain done (in any order). */
  readonly done: number;
  readonly total: number;
}

/** The current objective and the count done, from the chain and the keys the player has done. */
export function objectiveProgress(
  chain: readonly ObjectiveDef[],
  done: readonly string[],
): ObjectiveProgress {
  let current: ObjectiveDef | null = null;
  let count = 0;
  for (const objective of chain) {
    if (done.includes(objective.key)) count++;
    else current ??= objective;
  }
  return { current, done: count, total: chain.length };
}

/**
 * The objectives panel at the top right (docs « Interface »): the count done, the current
 * objective and its hint; a closing line once the chain is done. Hidden when the pack has none.
 */
export class ObjectivesPanel {
  readonly element: HTMLElement;
  private readonly chain: readonly ObjectiveDef[];
  private readonly heading: HTMLElement;
  private readonly text: HTMLElement;
  private readonly hint: HTMLElement;
  /** Keys done when the panel was last drawn (−1: never). */
  private shown = -1;
  private current: ObjectiveDef | null = null;

  constructor(chain: readonly ObjectiveDef[]) {
    this.chain = chain;
    this.heading = h('h2', { class: 'objectives-heading' });
    this.text = h('p', { class: 'objectives-text' });
    this.hint = h('p', { class: 'objectives-hint' });
    this.element = h(
      'section',
      { id: 'hud-objectives', class: 'hud-objectives' },
      this.heading,
      this.text,
      this.hint,
    );
    this.element.hidden = chain.length === 0;
  }

  /**
   * Redraws when the player has done more objectives (they only ever add up); returns the one
   * shown, the first not done yet (for its compass direction).
   */
  update(done: readonly string[]): ObjectiveDef | null {
    if (done.length === this.shown) return this.current;
    this.shown = done.length;
    const progress = objectiveProgress(this.chain, done);
    const current = progress.current;
    this.current = current;
    this.heading.textContent = t('hud.objectives', { done: progress.done, total: progress.total });
    this.text.textContent = current ? t(current.textKey) : t('hud.objectivesDone');
    const hint = current?.hintKey;
    this.hint.textContent = hint ? t(hint) : '';
    this.hint.hidden = !hint;
    this.element.classList.toggle('complete', !current);
    return current;
  }
}
