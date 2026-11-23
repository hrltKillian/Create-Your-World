import type { BalanceDef, ObjectiveDef } from '../../content/schema.ts';
import { h } from '../h.ts';
import { DeathScreen } from '../screens/death.ts';
import { Compass } from './compass.ts';
import { EffectList } from './effects.ts';
import { Flash } from './flash.ts';
import { ObjectivesPanel } from './objectives.ts';
import { StaminaArc } from './staminaArc.ts';
import { TargetLine } from './targetLine.ts';
import { Vignettes } from './vignettes.ts';
import { Vitals } from './vitals.ts';

/**
 * The survival HUD of a play session (docs « Interface », original layout): vignettes under
 * everything; vitals at the bottom left; the stamina arc beside the crosshair; the compass, the
 * clock and the target name at the top centre; objectives at the top right; effects on the right;
 * the day's banners and the sleep fade; and the death screen. Built once; `app/HudBridge.ts`
 * refreshes it.
 */
export class Hud {
  /** Everything but the death screen (no pointer events). */
  readonly element: HTMLElement;
  readonly vignettes = new Vignettes();
  readonly vitals: Vitals;
  readonly stamina = new StaminaArc();
  readonly compass = new Compass();
  readonly clock: HTMLElement;
  readonly target = new TargetLine();
  readonly objectives: ObjectivesPanel;
  readonly effects = new EffectList();
  readonly banner = new Flash('hud-banner', 'hud-banner');
  readonly sleep = new Flash('hud-sleep', 'hud-sleep');
  readonly death: DeathScreen;

  constructor(balance: BalanceDef, objectives: readonly ObjectiveDef[], onRespawn: () => void) {
    this.vitals = new Vitals(balance);
    this.objectives = new ObjectivesPanel(objectives);
    this.clock = h('p', { id: 'hud-clock', class: 'hud-clock' });
    this.death = new DeathScreen(onRespawn);
    this.element = h(
      'div',
      { class: 'hud' },
      this.vignettes.element,
      h('div', { class: 'hud-top' }, this.compass.element, this.clock, this.target.element),
      this.stamina.element,
      this.vitals.element,
      h('div', { class: 'hud-right' }, this.objectives.element, this.effects.element),
      this.banner.element,
      this.sleep.element,
    );
  }

  /** The clock line (« 07:30 · Day 1 »). */
  setClock(text: string): void {
    if (this.clock.textContent !== text) this.clock.textContent = text;
  }
}
