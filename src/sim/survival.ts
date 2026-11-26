import type { BalanceDef } from '../content/schema.ts';
import { hash32 } from '../core/hash.ts';
import { TICK_SECONDS, TICKS_PER_SECOND, ticksOf } from './clock.ts';
import { type Contact, sampleEnvironment, touch } from './environment.ts';
import { wearFilters } from './equipment.ts';
import type { SimEvent } from './events.ts';
import { eyeHeight } from './physics.ts';
import type { PlayerState } from './player.ts';
import { metabolismFactor } from './progression.ts';
import type { Simulation } from './Simulation.ts';
import { fallingOn } from './weather.ts';

/*
 * Survival gauges (docs « Survie »): health, hunger, thirst, temperature, toxicity and breath, the
 * damage they deal and the cause of a death. All rates come from the pack's balance; the gauges
 * move every tick (tick step 11), the environment they react to is sampled every
 * `climate.sampleSec` (environment.ts). No status changes another rule (plan v3 « M20 »): a gauge
 * only hurts when it is empty or extreme. Zero allocation per tick.
 */

/** What took a player's last health (the death screen shows `death.cause.<cause>`). */
export type DeathCause =
  | 'starvation'
  | 'dehydration'
  | 'cold'
  | 'heat'
  | 'toxicity'
  | 'drowning'
  | 'fall'
  | 'contact'
  | 'lava'
  | 'fire'
  | 'lightning'
  | 'creature';
export const DEATH_CAUSES: readonly DeathCause[] = [
  'starvation',
  'dehydration',
  'cold',
  'heat',
  'toxicity',
  'drowning',
  'fall',
  'contact',
  'lava',
  'fire',
  'lightning',
  'creature',
];

/** A player's survival state: plain data, hashed and saved whole. */
export interface SurvivalState {
  health: number;
  /** Largest health: the balance's plus vitality (sim/progression.ts `healthMax`). */
  healthMax: number;
  hunger: number;
  thirst: number;
  /** −limit…+limit; drifts towards `target`. */
  temperature: number;
  toxicity: number;
  /** Seconds of air left. */
  breath: number;
  /**
   * The reference game's hidden saturation (plan v3 « M30 »): spent before hunger, never above it;
   * and the exhaustion of the player's efforts, which takes from them `hunger.step` at a time.
   */
  saturation: number;
  exhaustion: number;
  /** Ticks towards the next regeneration or starvation blow (the reference game's food timer). */
  foodTicks: number;
  /** What hurt last: the cause of death once health is 0 ('' before any damage). */
  cause: DeathCause | '';
  /** The death was handled (sim/death.ts): the pack is left, the player waits to respawn. */
  dead: boolean;
  /** The last death left an Abandoned Pack (the death screen says so; false after a respawn). */
  packLeft: boolean;
  /** Takes no damage (`debug.god`); the gauges still move. */
  god: boolean;
  /** The last environment sample (environment.ts): felt °C and the gauge's target. */
  ambient: number;
  target: number;
  /** Toxicity per minute of the air (biome, filter mask). */
  airToxicity: number;
  /** Ticks before the next environment sample (1: the next tick). */
  sampleTicks: number;
  /** Ticks the player still burns (plan v3 « M29 »: lit by lava, put out by water; 0: not). */
  burnTicks: number;
}

/** Full gauges, comfortable, the environment sampled on the first tick. */
export function createSurvival(b: BalanceDef): SurvivalState {
  return {
    health: b.health.max,
    healthMax: b.health.max,
    hunger: b.hunger.max,
    thirst: b.thirst.max,
    temperature: 0,
    toxicity: 0,
    breath: b.breath.seconds,
    saturation: b.hunger.startSaturation,
    exhaustion: 0,
    foodTicks: 0,
    cause: '',
    dead: false,
    packLeft: false,
    god: false,
    ambient: b.climate.comfortMinC,
    target: 0,
    airToxicity: 0,
    sampleTicks: 1,
    burnTicks: 0,
  };
}

const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));

/** The survival gauges a debug command or a save may set, each kept within its range. */
export type Gauge = 'health' | 'hunger' | 'thirst' | 'temperature' | 'toxicity' | 'breath';

/** The top of each gauge's range: 0…top, the temperature −top…+top (the one range table). */
const GAUGE_TOP: Readonly<Record<Gauge, (b: BalanceDef, s: Readonly<SurvivalState>) => number>> = {
  health: (_, s) => s.healthMax,
  hunger: (b) => b.hunger.max,
  thirst: (b) => b.thirst.max,
  temperature: (b) => b.temperature.limit,
  toxicity: (b) => b.toxicity.max,
  breath: (b) => b.breath.seconds,
};
export const GAUGES = Object.keys(GAUGE_TOP) as readonly Gauge[];

/** A value of a gauge kept within its range (a player's: their largest health). */
export function clampGauge(
  gauge: Gauge,
  value: number,
  b: BalanceDef,
  s: Readonly<SurvivalState>,
): number {
  const top = GAUGE_TOP[gauge](b, s);
  return Math.max(gauge === 'temperature' ? -top : 0, Math.min(top, value));
}

/**
 * Adds to the gauges (negative amounts take away), each kept within its range: what food, drinks,
 * sips and a night's sleep do.
 */
export function adjustGauges(
  s: SurvivalState,
  b: BalanceDef,
  hunger: number,
  thirst: number,
  health: number,
  toxicity: number,
): void {
  s.hunger = clamp(s.hunger + hunger, b.hunger.max);
  s.saturation = Math.min(s.saturation, s.hunger);
  s.thirst = clamp(s.thirst + thirst, b.thirst.max);
  s.health = clamp(s.health + health, s.healthMax);
  s.toxicity = clamp(s.toxicity + toxicity, b.toxicity.max);
}

/** A food's hidden saturation, never above the hunger it leaves (plan v3 « M30 »). */
export function saturate(s: SurvivalState, amount: number): void {
  s.saturation = Math.min(s.hunger, s.saturation + Math.max(0, amount));
}

/** Adds the exhaustion of an effort (plan v3 « M30 »: sprinting, jumping, a blow, a block…). */
export function exhaust(s: SurvivalState, amount: number): void {
  if (amount > 0 && s.health > 0) s.exhaustion += amount;
}

/** Takes health for a cause (nothing once dead, nor while immune: `debug.god`). */
export function hurt(s: SurvivalState, amount: number, cause: DeathCause): void {
  if (amount <= 0 || s.health <= 0 || s.god) return;
  s.health = Math.max(0, s.health - amount);
  s.cause = cause;
}

/** Health a fall of `blocks` takes (docs « Joueur »: 6 per block beyond 3.5). */
export function fallDamage(blocks: number, b: BalanceDef): number {
  return Math.max(0, blocks - b.fall.safeBlocks) * b.fall.damagePerBlock;
}

/** The temperature gauge's band: ±1 from ±`mildAt` (the HUD warns), ±2 from ±`severeAt` (hurts). */
export function thermalStatus(temperature: number, b: BalanceDef): number {
  const t = b.temperature;
  if (temperature <= -t.severeAt) return -2;
  if (temperature <= -t.mildAt) return -1;
  if (temperature >= t.severeAt) return 2;
  if (temperature >= t.mildAt) return 1;
  return 0;
}

/** What a player does and touches this tick, besides the sampled environment. */
export interface Exposure extends Contact {
  /** The fire's length if lit now (drawn by stepSurvival within `fire.minSeconds`–`maxSeconds`). */
  fireTicks: number;
  sprinting: boolean;
  /** Factor on the hunger and thirst rates (the metabolism skill). */
  metabolism: number;
  /** The head is under a liquid. */
  underwater: boolean;
}

/** Moves `value` towards `target`: faster on the way back to 0, never past 0 on that way. */
function drift(value: number, target: number, b: BalanceDef, minutes: number): number {
  if (value === target) return value;
  const t = b.temperature;
  const up = target > value;
  const back = up ? value < 0 : value > 0;
  const step = (back ? t.backPerMin : t.awayPerMin) * minutes;
  const next = up ? Math.min(target, value + step) : Math.max(target, value - step);
  return back && (up ? next > 0 : next < 0) ? 0 : next;
}

/** One tick of the gauges, their damage and regeneration. */
export function stepGauges(s: SurvivalState, b: BalanceDef, e: Readonly<Exposure>): void {
  const minutes = TICK_SECONDS / 60;
  tire(s, b, e.metabolism);
  const thirst =
    b.thirst.perMin * (e.sprinting ? b.thirst.sprintFactor : 1) * e.metabolism * minutes;
  s.thirst = clamp(s.thirst - thirst, b.thirst.max);
  s.temperature = drift(s.temperature, s.target, b, minutes);
  const sources = s.airToxicity + e.toxicity;
  const toxicity = sources > 0 ? sources : -b.toxicity.decayPerMin;
  s.toxicity = clamp(s.toxicity + toxicity * minutes, b.toxicity.max);
  s.breath = e.underwater
    ? Math.max(0, s.breath - TICK_SECONDS)
    : Math.min(b.breath.seconds, s.breath + b.breath.refillPerSec * TICK_SECONDS);
  takeDamage(s, b, e, minutes);
  feed(s, b);
}

/**
 * The exhaustion gathered takes `hunger.step` at a time from the hidden saturation, else from
 * hunger (the metabolism skill makes each step cost less).
 */
function tire(s: SurvivalState, b: BalanceDef, metabolism: number): void {
  const h = b.hunger;
  while (s.exhaustion >= h.exhaustionPerStep) {
    s.exhaustion -= h.exhaustionPerStep;
    const step = h.step * metabolism;
    if (s.saturation > 0) s.saturation = Math.max(0, s.saturation - step);
    else s.hunger = Math.max(0, s.hunger - step);
  }
}

/** Damage over time of the empty or extreme gauges and of the blocks touched. */
function takeDamage(s: SurvivalState, b: BalanceDef, e: Readonly<Exposure>, minutes: number) {
  if (s.thirst === 0) hurt(s, b.thirst.emptyDamagePerMin * minutes, 'dehydration');
  const status = thermalStatus(s.temperature, b);
  if (status === -2 || status === 2)
    hurt(s, b.temperature.severeDamagePerMin * minutes, status < 0 ? 'cold' : 'heat');
  const t = b.toxicity;
  const poison =
    s.toxicity >= t.severeAt ? t.severePerMin : s.toxicity >= t.harmAt ? t.harmPerMin : 0;
  hurt(s, poison * minutes, 'toxicity');
  if (e.underwater && s.breath === 0) hurt(s, b.breath.drowningPerSec * TICK_SECONDS, 'drowning');
  hurt(s, e.damage * TICK_SECONDS, e.ignites ? e.burnCause : 'contact');
  burn(s, b, e);
}

/**
 * Fire (plan v3 « M29 »): lava lights it again every tick it is touched, so it lasts `fireTicks`
 * once out of it; water puts it out; it hurts each tick it burns.
 */
function burn(s: SurvivalState, b: BalanceDef, e: Readonly<Exposure>): void {
  if (e.ignites) s.burnTicks = e.fireTicks;
  else if (e.douses) s.burnTicks = 0;
  if (s.burnTicks <= 0) return;
  s.burnTicks--;
  hurt(s, b.fire.damagePerSec * TICK_SECONDS, 'fire');
}

/**
 * The reference game's food timer (plan v3 « M30 »): with full hunger and saturation left, health
 * comes back every `fastRegenSeconds`; with hunger from `regenHungerAt` (and enough water) every
 * `regenSeconds`, each heal tiring the player; starving at 0, it hurts every `starveSeconds`.
 */
function feed(s: SurvivalState, b: BalanceDef): void {
  const h = b.health;
  if (s.health <= 0) return;
  s.foodTicks++;
  // Our thirst joins the reference game's rule: no healing without water.
  const healing = s.health < s.healthMax && s.thirst >= h.regenThirstAt;
  if (healing && s.hunger >= b.hunger.max && s.saturation > 0) {
    if (s.foodTicks >= ticksOf(h.fastRegenSeconds)) heal(s, b);
  } else if (healing && s.hunger >= h.regenHungerAt) {
    if (s.foodTicks >= ticksOf(h.regenSeconds)) heal(s, b);
  } else if (s.hunger <= 0) {
    if (s.foodTicks >= ticksOf(b.hunger.starveSeconds)) {
      s.foodTicks = 0;
      hurt(s, b.hunger.starveDamage, 'starvation');
    }
  } else s.foodTicks = 0;
}

function heal(s: SurvivalState, b: BalanceDef): void {
  s.foodTicks = 0;
  s.health = Math.min(s.healthMax, s.health + b.health.regenAmount);
  exhaust(s, b.health.regenExhaustion);
}

/** Whether a block changed this tick (events from `first`) within `radius` blocks of a cell. */
function editedNear(
  out: readonly SimEvent[],
  first: number,
  x: number,
  y: number,
  z: number,
  radius: number,
): boolean {
  for (let i = first; i < out.length; i++) {
    const e = out[i]!;
    if (e.type !== 'blocksChanged') continue;
    const dx = Math.max(e.x0 - x, 0, x - e.x1);
    const dy = Math.max(e.y0 - y, 0, y - e.y1);
    const dz = Math.max(e.z0 - z, 0, z - e.z1);
    if (Math.max(dx, dy, dz) <= radius) return true;
  }
  return false;
}

const exposure: Exposure = {
  sprinting: false,
  metabolism: 1,
  underwater: false,
  toxicity: 0,
  damage: 0,
  ignites: false,
  burnCause: 'fire',
  douses: false,
  fireTicks: 0,
};

/** Salt of the fire lengths drawn. */
const FIRE_SALT = 0x46495245;

/** A fire's length in ticks for a player at this tick, within the balance's seconds. */
function fireTicks(sim: Simulation, player: PlayerState, b: BalanceDef): number {
  const min = ticksOf(b.fire.minSeconds);
  const span = ticksOf(b.fire.maxSeconds) - min + 1;
  return min + (hash32(sim.ctx.seedHash, sim.tick, player.playerId, FIRE_SALT) % span);
}

/**
 * Tick step 11 « Survie et environnement » for every living player in a loaded column. The
 * environment is sampled every `climate.sampleSec`, and again the tick after a block changed
 * nearby (this tick's `blocksChanged` events, from `first`: a fire lit or put out). A worn
 * filter wears every second it filters a toxic air.
 */
export function stepSurvival(sim: Simulation, out: SimEvent[], first: number): void {
  const b = sim.registry.pack.balance;
  for (const player of sim.players.values()) {
    const s = player.survival;
    if (s.health <= 0 || !sim.isActive(player)) continue;
    const body = player.body;
    if (--s.sampleTicks <= 0)
      s.sampleTicks = sampleEnvironment(sim, player) ? ticksOf(b.climate.sampleSec) : 1;
    const x = Math.floor(body.x);
    const y = Math.floor(body.y);
    const z = Math.floor(body.z);
    if (editedNear(out, first, x, y, z, b.climate.editRadius)) s.sampleTicks = 1;
    touch(sim.registry, sim.world, player, exposure);
    // Rain or snow falling on the player puts a fire out as water does (plan v3 « M34 »).
    if (!exposure.douses && s.burnTicks > 0) {
      const head = Math.floor(body.y + eyeHeight(body));
      exposure.douses = fallingOn(sim, x, head, z) !== 'none';
    }
    exposure.sprinting = player.sprinting;
    exposure.metabolism = metabolismFactor(player, b);
    exposure.underwater = body.headDrowns;
    exposure.fireTicks = exposure.ignites ? fireTicks(sim, player, b) : 0;
    stepGauges(s, b, exposure);
    if (sim.tick % TICKS_PER_SECOND === 0) wearFilters(sim.registry, player, out);
  }
}
