import { h } from './h.ts';

/** Pixels between the pointer and the bubble. */
const GAP = 14;
/** Pixels kept free at the edges of the window. */
const EDGE = 6;

/**
 * The bubble a hovered item or recipe shows its name and description in (plan v3 « M28 »): over
 * the screen, beside the pointer and inside the window, so no panel grows or shrinks with it. The
 * anchor is placed in viewport pixels (it undoes the interface zoom like the cursor stack); the
 * bubble inside keeps the zoom.
 */
export class Tooltip {
  readonly element: HTMLElement;
  private readonly box: HTMLElement;
  private shown = '';
  private x = 0;
  private y = 0;

  constructor() {
    this.box = h('div', { class: 'tooltip', attrs: { role: 'tooltip' } });
    this.element = h('div', { class: 'tooltip-anchor' }, this.box);
    this.element.hidden = true;
  }

  /** Shows a title and its lines beside the pointer (viewport pixels). */
  show(title: string, lines: readonly string[], x: number, y: number): void {
    const key = [title, ...lines].join('\n');
    if (key !== this.shown) {
      this.shown = key;
      this.box.replaceChildren(
        h('strong', null, title),
        ...lines.map((line) => h('span', { class: 'tooltip-line' }, line)),
      );
    }
    this.element.hidden = false;
    this.move(x, y);
  }

  /** Follows the pointer, flipped to its left or above it near the window's edges. */
  move(x: number, y: number): void {
    this.x = x;
    this.y = y;
    if (this.element.hidden) return;
    const rect = this.box.getBoundingClientRect?.();
    const width = rect?.width ?? 0;
    const height = rect?.height ?? 0;
    const right = (globalThis.innerWidth ?? Number.POSITIVE_INFINITY) - EDGE;
    const bottom = (globalThis.innerHeight ?? Number.POSITIVE_INFINITY) - EDGE;
    const left = x + GAP + width > right ? Math.max(EDGE, x - GAP - width) : x + GAP;
    const top = y + GAP + height > bottom ? Math.max(EDGE, bottom - height) : y + GAP;
    this.element.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  hide(): void {
    this.element.hidden = true;
  }

  /** The text shown (tests): the title and the lines, one per line; '' while hidden. */
  text(): string {
    return this.element.hidden ? '' : this.shown;
  }

  /** Where the pointer was last. */
  pointer(): { readonly x: number; readonly y: number } {
    return { x: this.x, y: this.y };
  }
}
