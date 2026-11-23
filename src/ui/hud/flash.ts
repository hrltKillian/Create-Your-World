import { h } from '../h.ts';

/**
 * A line that plays a CSS animation each time it is shown, then stays invisible: the banners of
 * the day (« The sun is setting… », « Night 1 survived ») and the fade of a night's sleep.
 */
export class Flash {
  readonly element: HTMLElement;
  private readonly text: HTMLElement;

  /** `className` styles it and names its animation (`<className>.play`). */
  constructor(id: string, className: string) {
    this.text = h('p', { class: 'flash-text' });
    this.element = h(
      'div',
      { id, class: `flash ${className}`, attrs: { role: 'status' } },
      this.text,
    );
  }

  show(text: string): void {
    this.text.textContent = text;
    const classes = this.element.classList;
    classes.remove('play');
    // Reading the layout restarts the animation when the class comes back.
    void this.element.offsetWidth;
    classes.add('play');
  }
}
