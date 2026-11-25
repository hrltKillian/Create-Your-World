import type { BalanceDef } from '../../content/schema.ts';
import { h } from '../h.ts';
import { DeathScreen } from '../screens/death.ts';
import { AttackGauge } from './attackGauge.ts';
import { CombatMarks } from './combatMarks.ts';
import { Compass } from './compass.ts';
import { Flash } from './flash.ts';
import { PickupFeed } from './pickups.ts';
import { PinnedQuest } from './pinnedQuest.ts';
import { ScanRing } from './scanRing.ts';
import { StaminaArc } from './staminaArc.ts';
import { TargetLine } from './targetLine.ts';
import { Vignettes } from './vignettes.ts';
import { Vitals } from './vitals.ts';

/**
 * The survival HUD of a play session (docs « Interface », original layout): vignettes under
 * everything; vitals at the bottom left; the pickup messages on the left; the stamina arc, the
 * hit marker and the damage arcs around the crosshair; the compass, the clock and the target name
 * and the pinned quest at the top centre; the day's banners, the
 * biome's name on entering it and the sleep fade; and the death screen. Built once;
 * `app/HudBridge.ts` refreshes it.
 */
export class Hud {
  /** Everything but the death screen (no pointer events). */
  readonly element: HTMLElement;
  readonly vignettes = new Vignettes();
  readonly vitals: Vitals;
  readonly stamina = new StaminaArc();
  readonly scan = new ScanRing();
  readonly attack = new AttackGauge();
  readonly combat = new CombatMarks();
  readonly compass = new Compass();
  readonly clock: HTMLElement;
  readonly target = new TargetLine();
  readonly quest = new PinnedQuest();
  readonly banner = new Flash('hud-banner', 'hud-banner');
  readonly biome = new Flash('hud-biome', 'hud-biome');
  readonly pickups = new PickupFeed();
  readonly sleep = new Flash('hud-sleep', 'hud-sleep');
  readonly death: DeathScreen;

  constructor(balance: BalanceDef, onRespawn: () => void) {
    this.vitals = new Vitals(balance);
    this.clock = h('p', { id: 'hud-clock', class: 'hud-clock' });
    this.death = new DeathScreen(onRespawn);
    this.element = h(
      'div',
      { class: 'hud' },
      this.vignettes.element,
      h(
        'div',
        { class: 'hud-top' },
        this.compass.element,
        this.quest.element,
        this.clock,
        this.target.element,
      ),
      this.stamina.element,
      this.scan.element,
      this.attack.element,
      this.combat.element,
      this.vitals.element,
      this.pickups.element,
      this.banner.element,
      this.biome.element,
      this.sleep.element,
    );
  }

  /** The clock line (« 07:30 · Day 1 »). */
  setClock(text: string): void {
    if (this.clock.textContent !== text) this.clock.textContent = text;
  }
}
