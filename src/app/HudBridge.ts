import { STUDIED } from '../core/creatures.ts';
import { t } from '../i18n/i18n.ts';
import type { InputManager } from '../input/InputManager.ts';
import { aboveHorizon, sunBearing } from '../render/Sky.ts';
import { scannerOf } from '../sim/bestiary.ts';
import { ticksOf } from '../sim/clock.ts';
import type { SimEvent } from '../sim/events.ts';
import { attackGauge } from '../sim/melee.ts';
import { STAMINA } from '../sim/player.ts';
import { staminaMax } from '../sim/progression.ts';
import { thermalStatus } from '../sim/survival.ts';
import { dayOf, hourOf } from '../sim/time.ts';
import { creatureName } from '../ui/bestiary.ts';
import { clockText } from '../ui/hud/clock.ts';
import { damageBearing } from '../ui/hud/combatMarks.ts';
import { bearingOf, headingOf, POINT_BEARINGS } from '../ui/hud/compass.ts';
import { Hud } from '../ui/hud/hud.ts';
import { type Vignette, vignetteLevels } from '../ui/hud/vignettes.ts';
import { MINIMAP_RADIUS, WAYPOINT_PALETTE } from '../ui/map.ts';
import { questLine } from '../ui/quests.ts';
import type { GameSession } from './GameSession.ts';
import { BiomeWatch, targetText } from './hudModel.ts';
import type { InventoryUi } from './inventoryUi.ts';
import type { PlayGate } from './playGate.ts';

/** The onboarding's say on the sunset banner (app/onboarding.ts). */
interface DuskTip {
  /** The first dusk shows its tip in place of the banner: true when it did. */
  dusk(): boolean;
}

/** Seconds between two refreshes of the gauges, clock, target and pinned quest (10 Hz). */
const REFRESH_SECONDS = 0.1;

/**
 * Keeps the survival HUD in step with the local player: the compass and the pickup lines every
 * frame, the rest (the minimap too) at 10 Hz and at once after the player's quest, death and respawn events.
 * Shows the day's banners (the first sunset's goes to the onboarding's dusk tip when it shows
 * one), the biome entered, the sleep fade, the quest messages and the pinned quest, the items
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
  private readonly tips: DuskTip | null;
  private elapsed = REFRESH_SECONDS;
  /** The death screen holds the gate's screen (given back on Respawn). */
  private holdsScreen = false;
  /** Respawn was clicked: the screen stays shut while the simulation brings the player back. */
  private waking = false;
  private readonly biomes = new BiomeWatch();
  /** The quest messages of this frame, shown together on one line (a chain done at once). */
  private readonly questLines: string[] = [];
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
    quest: Number.NaN,
    graves: [] as number[],
    waypoints: [] as number[],
    waypointColours: [] as string[],
  };

  /** `layer`: the world's play layer (the HUD goes under its overlays, the death screen over). */
  constructor(
    layer: HTMLElement,
    session: GameSession,
    input: InputManager,
    gate: PlayGate,
    inventory: InventoryUi,
    tips: DuskTip | null = null,
  ) {
    this.session = session;
    this.input = input;
    this.gate = gate;
    this.inventory = inventory;
    this.tips = tips;
    const pack = session.host.view.registry.pack;
    this.hud = new Hud(pack.balance, () => this.respawn());
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
    this.hud.attack.update(attackGauge(this.session.host.view.registry, this.session.player));
    this.hud.pickups.frame(dt);
    if (this.questLines.length > 0) {
      this.hud.questNews.show(this.questLines.join(' · '));
      this.questLines.length = 0;
    }
    this.hud.questNews.frame(dt);
  }

  private onEvent(event: SimEvent): void {
    const hud = this.hud;
    const player = this.session.player;
    if (event.type === 'sunset') {
      if (!this.tips?.dusk()) hud.banner.show(t('hud.sunset'));
    } else if (event.type === 'nightSurvived')
      hud.banner.show(t('hud.nightSurvived', { n: event.night }));
    else if (event.type === 'creatureHurt' && event.attacker === player.id) hud.combat.hit();
    if (!('playerId' in event) || event.playerId !== player.playerId) return;
    switch (event.type) {
      case 'playerHurt': {
        const b = player.body;
        hud.combat.hurt(damageBearing(b.x, b.z, this.session.rig.yaw, event.x, event.z));
        break;
      }
      case 'questUnlocked':
      case 'questDone':
      case 'questProgress': {
        const quest = this.questOf(event.quest);
        // The quests open from the start are no news: the Quests page lists them.
        if (!quest || (event.type === 'questUnlocked' && !quest.requires)) break;
        const name = t(quest.textKey);
        const text =
          event.type === 'questUnlocked'
            ? t('hud.questUnlocked', { name })
            : event.type === 'questProgress'
              ? questLine(quest, player.quests[quest.key])
              : t(event.already ? 'hud.questAlready' : 'hud.questDone', { name });
        this.questLines.push(text);
        this.elapsed = REFRESH_SECONDS;
        break;
      }
      case 'xpGained':
        this.questLines.push(t('hud.xp', { xp: event.xp }));
        break;
      case 'levelUp':
        this.questLines.push(t('hud.levelUp', { n: event.level }));
        break;
      case 'taskProgress': {
        const task = this.session.host.view.registry.pack.tasks?.find((d) => d.key === event.task);
        if (task && event.progress === task.counter.count)
          this.questLines.push(t('hud.taskDone', { name: t(task.textKey) }));
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
    hud.stamina.update(player.stamina, staminaMax(player, balance, STAMINA.max), player.exhausted);
    hud.vignettes.update(vignetteLevels(s, balance, player.body.headInWater, this.levels));
    const burning = s.burnTicks > 0 && !s.dead;
    if (hud.fire.hidden === burning) hud.fire.hidden = !burning;
    const ticks = view.time().ticks;
    const hour = hourOf(ticks);
    hud.setClock(clockText(hour, dayOf(ticks)));
    const pinned = player.pinned === null ? undefined : this.questOf(player.pinned);
    hud.quest.update(pinned ? questLine(pinned, player.quests[pinned.key]) : null);
    this.updateTarget();
    this.updateTargets(hour);
    this.updateBiome(dt);
    hud.map.update(this.inventory.maps.view(player, MINIMAP_RADIUS), this.input.keyLabel('map'));
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

  /**
   * The creature a worn scanner looks at (its name and state, the scan's ring), else the aimed
   * creature's name (« Unknown creature » before it is met) or the aimed block's name and hint
   * (nothing while dead).
   */
  private updateTarget(): void {
    const { hit, creature } = this.session.aim;
    const player = this.session.player;
    const view = this.session.host.view;
    const registry = view.registry;
    const scanner = scannerOf(registry, player);
    const scanned = scanner ? view.entities.get(player.scanId) : undefined;
    const level = (key: string) => player.bestiary[key] ?? 0;
    if (scanner && scanned?.kind === 'creature' && !player.survival.dead) {
      const def = registry.creature(scanned.creature)!;
      const studied = level(def.key) >= STUDIED;
      this.hud.scan.update(studied ? Number.NaN : player.scanTicks / ticksOf(scanner.seconds));
      this.hud.target.update(
        creatureName(def, level(def.key)),
        t('hud.creatureState', {
          health: Math.ceil(scanned.health),
          max: def.health,
          stamina: Math.floor(scanned.stamina),
          mode: t(`creature.mode.${scanned.mode}`),
        }),
      );
      return;
    }
    this.hud.scan.update(Number.NaN);
    if (player.survival.dead || (!creature && !hit.hit)) {
      this.hud.target.update(null, null);
      return;
    }
    if (creature) {
      const def = registry.creature(creature.creature)!;
      this.hud.target.update(creatureName(def, level(def.key)), null);
      return;
    }
    const stack = player.inventory[this.input.slot];
    const item = stack ? registry.itemId(stack.item) : -1;
    const line = targetText(registry, hit.state, item, this.input.keyLabel('secondary'));
    this.hud.target.update(line.name, line.hint);
  }

  /** A quest of the pack by key. */
  private questOf(key: string) {
    return this.session.host.view.registry.pack.quests?.find((quest) => quest.key === key);
  }

  /** Bearings of the sun or moon, the pinned quest's direction, the player's packs and waypoints. */
  private updateTargets(hour: number): void {
    const targets = this.targets;
    const sun = sunBearing(hour);
    targets.sun = aboveHorizon(hour, false) ? sun : Number.NaN;
    targets.moon = aboveHorizon(hour, true) ? sun + Math.PI : Number.NaN;
    const pinned = this.session.player.pinned;
    const point = pinned === null ? undefined : this.questOf(pinned)?.compass;
    targets.quest = point ? POINT_BEARINGS[point] : Number.NaN;
    const { body, graves } = this.session.player;
    targets.graves.length = graves.length;
    for (let i = 0; i < graves.length; i++) {
      const grave = graves[i]!;
      targets.graves[i] = bearingOf(grave.x + 0.5 - body.x, grave.z + 0.5 - body.z);
    }
    const waypoints = this.session.player.waypoints;
    targets.waypoints.length = waypoints.length;
    targets.waypointColours.length = waypoints.length;
    for (let i = 0; i < waypoints.length; i++) {
      const w = waypoints[i]!;
      targets.waypoints[i] = bearingOf(w.x + 0.5 - body.x, w.z + 0.5 - body.z);
      targets.waypointColours[i] = WAYPOINT_PALETTE[w.colour] ?? WAYPOINT_PALETTE[0];
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
    if (this.holdsScreen) this.gate.closeScreen();
    this.holdsScreen = false;
  }
}
