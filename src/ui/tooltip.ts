import { h } from './h.ts';
import { type InfoLine, lineElement, lineText } from './symbols.ts';

/**
 * Pixels from the pointer to the bubble: to its right, clear of the cursor (an arrow points up and
 * to the left from the pointer and runs about 20 pixels down and right; a hand about 16 to the
 * right); to its left when it flips, where no cursor stands.
 */
const RIGHT = 28;
const LEFT = 12;
/** The bubble's top, a little above the pointer: beside it, not under it. */
const RISE = 6;
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
  show(title: string, lines: readonly InfoLine[], x: number, y: number): void {
    const key = [title, ...lines.map(lineText)].join('\n');
    if (key !== this.shown) {
      this.shown = key;
      this.box.replaceChildren(
        h('strong', null, title),
        ...lines.map((line) => lineElement(line, 'tooltip-line')),
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
    const left = x + RIGHT + width > right ? Math.max(EDGE, x - LEFT - width) : x + RIGHT;
    const top = Math.max(EDGE, Math.min(y - RISE, bottom - height));
    this.place(left, top);
    // Whatever zoom the interface puts the anchor under, it lands where it is meant to: in
    // viewport pixels, measured (an anchor zoomed twice once sat far off the pointer).
    const at = this.element.getBoundingClientRect?.();
    if (at && left > EDGE && Math.abs(at.left - Math.round(left)) > 0.5) {
      const k = at.left / Math.round(left);
      this.place(left / k, top / k);
    }
  }

  private place(left: number, top: number): void {
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
