import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';

/** Seconds a pickup line stays, the last FADE_SECONDS of them fading out. */
export const PICKUP_SECONDS = 4;
export const FADE_SECONDS = 0.6;
/** Most lines at once: a new item pushes the oldest line out. */
export const PICKUP_LINES = 5;

interface Line {
  readonly item: string;
  readonly element: HTMLElement;
  count: number;
  /** Seconds left on screen. */
  left: number;
}

/**
 * The pickup messages on the left of the HUD (docs « Interface »): « +3 Plant Fiber », newest at
 * the bottom. Picking up more of an item while its line shows adds to that line and keeps it up;
 * a line fades out (CSS opacity, class `fading`) and goes after PICKUP_SECONDS.
 */
export class PickupFeed {
  readonly element: HTMLElement;
  private readonly lines: Line[] = [];

  constructor() {
    this.element = h('ul', {
      id: 'hud-pickups',
      class: 'hud-pickups',
      attrs: { 'aria-label': t('hud.pickups'), 'aria-live': 'polite' },
    });
  }

  /** `count` of an item (`name`: its translated name) went into the bag. */
  add(item: string, name: string, count: number): void {
    let line = this.lines.find((l) => l.item === item);
    if (line) line.count += count;
    else {
      if (this.lines.length >= PICKUP_LINES) this.drop(0);
      line = { item, element: h('li', { class: 'pickup' }), count, left: 0 };
      this.lines.push(line);
      this.element.append(line.element);
    }
    line.left = PICKUP_SECONDS;
    line.element.classList.remove('fading');
    line.element.textContent = t('hud.pickup', { n: line.count, name });
  }

  /** Counts the lines down; call every frame (touches the DOM only when a line fades or goes). */
  frame(dt: number): void {
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const line = this.lines[i]!;
      const before = line.left;
      line.left -= dt;
      if (line.left <= 0) this.drop(i);
      else if (line.left <= FADE_SECONDS && before > FADE_SECONDS)
        line.element.classList.add('fading');
    }
  }

  private drop(index: number): void {
    this.lines[index]!.element.remove();
    this.lines.splice(index, 1);
  }
}
