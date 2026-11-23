import { h } from '../h.ts';

/**
 * The name of the block under the crosshair, below the clock (docs « Interface »), with a hint
 * line: the tool tier it needs when the held one cannot harvest it, or how to use it (a bedroll).
 */
export class TargetLine {
  readonly element: HTMLElement;
  private readonly name: HTMLElement;
  private readonly hint: HTMLElement;

  constructor() {
    this.name = h('span', { class: 'target-name' });
    this.hint = h('span', { class: 'target-hint' });
    this.element = h('p', { id: 'hud-target', class: 'hud-target' }, this.name, this.hint);
    this.element.hidden = true;
    this.hint.hidden = true;
  }

  /** Translated text; a null name hides the line (the DOM is only touched by a change). */
  update(name: string | null, hint: string | null): void {
    const element = this.element;
    if (element.hidden !== (name === null)) element.hidden = name === null;
    if (name === null) return;
    if (this.name.textContent !== name) this.name.textContent = name;
    const line = hint ?? '';
    if (this.hint.textContent === line) return;
    this.hint.textContent = line;
    this.hint.hidden = hint === null;
  }
}
