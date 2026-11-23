import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';

/** Seconds a hint stays on screen. */
export const HINT_SECONDS = 2.5;

/**
 * Text of a simulation hint (SimEvent `hint`): each parameter is itself an i18n key (pack names
 * such as the tier and the tool kind), translated before it fills the key's template.
 */
export function hintText(key: string, params: Readonly<Record<string, string>>): string {
  const names: Record<string, string> = {};
  for (const [name, value] of Object.entries(params)) names[name] = t(value);
  return t(key, names);
}

/** A short transient line at the top centre of the HUD (« Tool too weak: … »), gone after 2.5 s. */
export class HudHint {
  readonly element: HTMLElement;
  /** Seconds left on screen (0: hidden). */
  private left = 0;

  constructor() {
    this.element = h('p', { id: 'hud-hint', class: 'hud-hint', attrs: { role: 'status' } });
    this.element.hidden = true;
  }

  /** Shows a line (replacing the current one) for HINT_SECONDS. */
  show(text: string): void {
    if (this.element.textContent !== text) this.element.textContent = text;
    this.element.hidden = false;
    this.left = HINT_SECONDS;
  }

  /** Counts the time down; call every frame (touches the DOM only when the line goes). */
  frame(dt: number): void {
    if (this.left <= 0) return;
    this.left -= dt;
    if (this.left <= 0) this.element.hidden = true;
  }
}
