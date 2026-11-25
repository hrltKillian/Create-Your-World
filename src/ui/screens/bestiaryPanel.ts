import type { BestiaryRow } from '../bestiary.ts';
import { h } from '../h.ts';

/**
 * The Bestiary page of the Bag (ui/bestiary.ts writes its rows): one card per creature of the
 * pack, rebuilt only when an entry changes. Cards carry `data-creature` and `data-level`.
 */
export class BestiaryPanel {
  readonly element = h('section', { class: 'bestiary' });
  private shown = '';

  update(rows: readonly BestiaryRow[]): void {
    const key = rows.map((row) => row.level).join(',');
    if (key === this.shown) return;
    this.shown = key;
    this.element.replaceChildren(
      ...rows.map((row) =>
        h(
          'article',
          {
            class: `bestiary-row level-${row.level}`,
            attrs: { 'data-creature': row.creature, 'data-level': String(row.level) },
          },
          h('h3', null, row.name),
          ...row.lines.map((line) => h('p', null, line)),
        ),
      ),
    );
  }
}
