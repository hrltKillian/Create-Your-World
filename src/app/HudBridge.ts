import type { ObjectiveDef } from '../content/schema.ts';
import { t } from '../i18n/i18n.ts';
import type { InputManager } from '../input/InputManager.ts';
import { aboveHorizon, sunBearing } from '../render/Sky.ts';
import type { SimEvent } from '../sim/events.ts';
import { STAMINA } from '../sim/player.ts';
import { thermalStatus } from '../sim/survival.ts';
import { dayOf, hourOf } from '../sim/time.ts';
import { clockText } from '../ui/hud/clock.ts';
import { damageBearing } from '../ui/hud/combatMarks.ts';
import { bearingOf, headingOf, POINT_BEARINGS } from '../ui/hud/compass.ts';
import type { HudEffect } from '../ui/hud/effects.ts';
import { Hud } from '../ui/hud/hud.ts';
import { type Vignette, vignetteLevels } from '../ui/hud/vignettes.ts';
import type { GameSession } from './GameSession.ts';
import { BiomeWatch, hudEffects, targetText } from './hudModel.ts';
import type { InventoryUi } from './inventoryUi.ts';
import type { PlayGate } from './playGate.ts';

/** Seconds between two refreshes of the gauges, clock, target, objectives and effects (10 Hz). */
const REFRESH_SECONDS = 0.1;

/**
 * Keeps the survival HUD in step with the local player: the compass and the pickup lines every
 * frame, the rest at 10 Hz and at once after the player's objective, death and respawn events.
 * Shows the day's banners, the biome entered, the sleep fade, the objective lines, the items
 * picked up, the hit marker and the damage arcs, and runs the death screen: it takes the open
 * screen's place (the mouse stays free) and Respawn, a click, captures the mouse again. The screen
 * follows `survival.dead`, so a world saved dead opens on it.
 */
export class HudBridge {
  readonly hud: Hud;
  private readonly session: GameSession;
  private readonly input: InputManager;
  private readonly gate: PlayGate;
  private readonly inventory: InventoryUi;
  private elapsed = REFRESH_SECONDS;
  private objective: ObjectiveDef | null = null;
  /** The death screen holds the gate's screen (given back on Respawn). */
  private holdsScreen = false;
  /** Respawn was clicked: the screen stays shut while the simulation brings the player back. */
  private waking = false;
  private readonly biomes = new BiomeWatch();
  private readonly effects: HudEffect[] = [];
  private readonly levels: Record<Vignette, number> = {
    health: 0,
    cold: 0,
    heat: 0,
    toxicity: 0,
    water: 0,
  };
  private readonly targets = {
    sun: Number.NaN,
    moon: Number.NaN,
    objective: Number.NaN,
    graves: [] as number[],
  };

  /** `layer`: the world's play layer (the HUD goes under its overlays, the death screen over). */
  constructor(
    layer: HTMLElement,
    session: GameSession,
    input: InputManager,
    gate: PlayGate,
    inventory: InventoryUi,
  ) {
    this.session = session;
    this.input = input;
    this.gate = gate;
    this.inventory = inventory;
    const pack = session.host.view.registry.pack;
    this.hud = new Hud(pack.balance, pack.objectives ?? [], () => this.respawn());
    layer.prepend(this.hud.element);
    layer.append(this.hud.death.element);
    session.listeners.push((event) => this.onEvent(event));
  }

  /** Whether the death screen shows. */
  deathOpen(): boolean {
    return this.hud.death.isOpen();
  }

  frame(dt: number): void {
    this.elapsed += dt;
    if (this.elapsed >= REFRESH_SECONDS) {
      const elapsed = this.elapsed;
      this.elapsed = 0;
      this.refresh(elapsed);
    }
    this.hud.compass.update(headingOf(this.session.rig.yaw), this.targets);
    this.hud.pickups.frame(dt);
  }

  private onEvent(event: SimEvent): void {
    const hud = this.hud;
    const player = this.session.player;
    if (event.type === 'sunset') hud.banner.show(t('hud.sunset'));
    else if (event.type === 'nightSurvived')
      hud.banner.show(t('hud.nightSurvived', { n: event.night }));
    else if (event.type === 'creatureHurt' && event.attacker === player.id) hud.combat.hit();
    if (!('playerId' in event) || event.playerId !== player.playerId) return;
    switch (event.type) {
      case 'playerHurt': {
        const b = player.body;
        hud.combat.hurt(damageBearing(b.x, b.z, this.session.rig.yaw, event.x, event.z));
        break;
      }
      case 'objectiveDone': {
        const done = this.session.host.view.registry.pack.objectives?.find(
          (objective) => objective.key === event.objective,
        );
        if (done) this.inventory.hint.show(t('hud.objectiveDone', { name: t(done.textKey) }));
        this.elapsed = REFRESH_SECONDS;
        break;
      }
      case 'slept':
        hud.sleep.show(t('hud.slept'));
        break;
      case 'itemPickedUp': {
        const def = this.session.host.view.registry.item(event.item);
        if (def) hud.pickups.add(event.item, t(def.nameKey), event.count);
        break;
      }
      case 'died':
      case 'respawned':
        this.elapsed = REFRESH_SECONDS;
        break;
    }
  }

  /** `dt`: seconds since the last refresh. */
  private refresh(dt: number): void {
    const hud = this.hud;
    const view = this.session.host.view;
    const balance = view.registry.pack.balance;
    const player = this.session.player;
    const s = player.survival;
    hud.vitals.update(s, thermalStatus(s.temperature, balance));
    hud.stamina.update(player.stamina, STAMINA.max, player.exhausted);
    hud.vignettes.update(vignetteLevels(s, balance, player.body.headInWater, this.levels));
    hud.effects.update(hudEffects(player, balance, this.effects));
    const ticks = view.time().ticks;
    const hour = hourOf(ticks);
    hud.setClock(clockText(hour, dayOf(ticks)));
    this.objective = hud.objectives.update(player.objectives);
    this.updateTarget();
    this.updateTargets(hour);
    this.updateBiome(dt);
    this.syncDeath();
  }

  /** Shows the name of a biome the living player has just entered. */
  private updateBiome(dt: number): void {
    const player = this.session.player;
    if (player.survival.dead) return;
    const view = this.session.host.view;
    const { x, z } = player.body;
    const here = view.world.biomeAt(Math.floor(x), Math.floor(z));
    const entered = this.biomes.update(here, dt);
    const biome = entered < 0 ? undefined : view.gen.biomes[entered];
    if (biome) this.hud.biome.show(t(biome.def.nameKey));
  }

  /** The aimed block's name and hint (nothing while dead). */
  private updateTarget(): void {
    const hit = this.session.aim.hit;
    const player = this.session.player;
    if (!hit.hit || player.survival.dead) {
      this.hud.target.update(null, null);
      return;
    }
    const registry = this.session.host.view.registry;
    const stack = player.inventory[this.input.slot];
    const item = stack ? registry.itemId(stack.item) : -1;
    const line = targetText(registry, hit.state, item, this.input.keyLabel('secondary'));
    this.hud.target.update(line.name, line.hint);
  }

  /** Bearings of the sun or moon, the current objective's direction and the player's packs. */
  private updateTargets(hour: number): void {
    const targets = this.targets;
    const sun = sunBearing(hour);
    targets.sun = aboveHorizon(hour, false) ? sun : Number.NaN;
    targets.moon = aboveHorizon(hour, true) ? sun + Math.PI : Number.NaN;
    const point = this.objective?.compass;
    targets.objective = point ? POINT_BEARINGS[point] : Number.NaN;
    const { body, graves } = this.session.player;
    targets.graves.length = graves.length;
    for (let i = 0; i < graves.length; i++) {
      const grave = graves[i]!;
      targets.graves[i] = bearingOf(grave.x + 0.5 - body.x, grave.z + 0.5 - body.z);
    }
  }

  /**
   * Opens the death screen while the player is dead, and shuts it once they are back. While it
   * shows during play it holds the gate's screen (the mouse stays free for Respawn); shown while
   * paused (over the click-to-play overlay), it takes the gate once play resumes.
   */
  private syncDeath(): void {
    const dead = this.session.player.survival.dead;
    if (!dead) this.waking = false;
    const open = this.hud.death.isOpen();
    if (dead && !open && !this.waking) this.openDeath();
    else if (!dead && open) this.closeDeath();
    if (this.hud.death.isOpen() && !this.holdsScreen && this.gate.canOpenScreen()) {
      this.holdsScreen = true;
      this.gate.openScreen();
    }
  }

  /**
   * Shows the death screen in place of the open bag, chest or station, whose gate it keeps; also
   * when the death already closed a chest or station but left the gate's screen open
   * (InventoryUi), so Respawn captures the mouse again.
   */
  private openDeath(): void {
    this.holdsScreen = this.inventory.screen() !== null || this.gate.screenIsOpen();
    this.inventory.hideScreen();
    const { survival, respawn } = this.session.player;
    this.hud.death.show(survival.cause, respawn !== null, survival.packLeft);
  }

  /** Respawn (a click: it may capture the mouse again). */
  private respawn(): void {
    this.waking = true;
    this.session.host.send({ type: 'player.respawn' });
    this.closeDeath();
  }

  private closeDeath(): void {
    this.hud.death.hide();
    if (this.holdsScreen) this.gate.closeScreen(true);
    this.holdsScreen = false;
  }
}
