import { h } from '../h.ts';

/**
 * The quest pinned from the Quests page (plan v3 « M21 »), one line under the compass: its name
 * and a counter's progress (ui/quests.ts `questLine`); hidden while none is pinned.
 */
export class PinnedQuest {
  readonly element = h('p', { id: 'hud-quest', class: 'hud-quest' });

  constructor() {
    this.element.hidden = true;
  }

  update(text: string | null): void {
    const hidden = text === null;
    if (this.element.hidden !== hidden) this.element.hidden = hidden;
    if (text !== null && this.element.textContent !== text) this.element.textContent = text;
  }
}
